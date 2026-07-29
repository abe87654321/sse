import { Router, Request, Response, NextFunction } from 'express';
import { OntologyEngine } from '@sse/ontology';
import { authMiddleware } from '@sse/auth';
import { UserRole } from '@sse/shared';
import { AppError } from '../middleware/error';
import { PgUserRepo } from '@sse/db';
import { getEngine } from './ontology-helpers';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

const router = Router();

function asyncWrap(fn: (req: Request, res: Response, next: NextFunction) => Promise<void>) {
  return (req: Request, res: Response, next: NextFunction) => { Promise.resolve(fn(req, res, next)).catch(next); };
}

router.use(authMiddleware);

function filterGraph(graph: { nodes: any[]; edges: any[] }, role: string, userId: string, department: string) {
  if (role === UserRole.ADMIN || role === UserRole.FINANCE) return graph;

  const keepNodes = new Set<string>();

  if (role === UserRole.DEPT_APPROVER && department) {
    for (const node of graph.nodes) {
      const label = (node.label || '').toLowerCase();
      const nodeDept = (node.properties?.department || '').toLowerCase();
      if (label === department.toLowerCase() || nodeDept === department.toLowerCase()) {
        keepNodes.add(node.id);
      }
    }
    // BFS one hop from department nodes
    for (const edge of graph.edges) {
      if (keepNodes.has(edge.from)) keepNodes.add(edge.to);
      if (keepNodes.has(edge.to)) keepNodes.add(edge.from);
    }
  } else {
    // Employee: find own person node
    for (const node of graph.nodes) {
      if (node.id.includes(userId)) {
        keepNodes.add(node.id);
        break;
      }
    }
    if (keepNodes.size === 0) {
      // fallback: try matching by label containing user's name pattern
      for (const node of graph.nodes) {
        if (node.type === 'Person') keepNodes.add(node.id);
      }
    }
    // BFS two hops from owned nodes
    for (let hop = 0; hop < 2; hop++) {
      for (const edge of graph.edges) {
        if (keepNodes.has(edge.from)) keepNodes.add(edge.to);
        if (keepNodes.has(edge.to)) keepNodes.add(edge.from);
      }
    }
  }

  return {
    nodes: graph.nodes.filter((n: any) => keepNodes.has(n.id)),
    edges: graph.edges.filter((e: any) => keepNodes.has(e.from) && keepNodes.has(e.to)),
  };
}

async function attachAvatars(graph: { nodes: any[]; edges: any[] }): Promise<void> {
  const userRepo = new PgUserRepo();
  for (const node of graph.nodes) {
    if (node.type !== 'Person') continue;
    const p = node.properties || {};
    const userId = p.userId || p.externalId;
    if (!userId) continue;
    try {
      const user = await userRepo.findById(userId);
      if (user?.avatarUrl) {
        node.properties = { ...node.properties, avatarUrl: user.avatarUrl };
      }
    } catch { /* best effort */ }
  }
}

router.post('/submit-from-text', asyncWrap(async (req, res) => {
  const { text } = req.body;
  if (!text) throw new AppError(400, 'INVALID_PARAMS', '请提供 text');
  const result = await getEngine().submitFromText(text, req.user!.userId, req.headers.authorization?.split(' ')[1] || '');
  res.json(result);
}));

router.get('/sync', asyncWrap(async (req, res) => {
  const store = getEngine().store;
  await getEngine().mapper.syncAll();
  const warnings = store.validateGraph();
  const graph = filterGraph(store.getGraph(), req.user!.role, req.user!.userId, req.user!.department);
  try { await store.saveToDb(); } catch { /* best effort */ }
  try {
    const dir = join(process.cwd(), 'data', 'ontology');
    const fs = await import('fs');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    await store.saveToTurtle(join(dir, 'sse.owl'));
  } catch { /* best effort */ }
  await attachAvatars(graph);
  res.json({ message: '本体同步完成', warnings, graph });
}));

router.get('/query', asyncWrap(async (req, res) => {
  const type = req.query.type as string;
  if (!type) throw new AppError(400, 'INVALID_PARAMS', '请提供 type 参数');
  const result = getEngine().store.queryByType(type);
  const g = { nodes: result, edges: [] as any[] };
  await attachAvatars(g);
  res.json(g.nodes);
}));

router.post('/from-text', asyncWrap(async (req, res) => {
  const { text } = req.body;
  if (!text) throw new AppError(400, 'INVALID_PARAMS', '请提供 text 描述');

  let extraction;
  try {
    extraction = await getEngine().extractor.extractGraph(text);
  } catch (err: any) {
    res.status(503).json({ error: { code: 'AI_SERVICE_UNAVAILABLE', message: err.message || 'AI 模型调用失败' } });
    return;
  }

  const store = getEngine().store;
  const baseUri = 'https://sse.local/';

  for (const entity of extraction.entities) {
    const uri = entity.uri.includes('://') ? entity.uri : `${baseUri}${entity.uri}`;
    store.addEntity(uri, entity.type, entity.properties);
  }

  for (const rel of extraction.relations) {
    const fromUri = rel.from.includes('://') ? rel.from : `${baseUri}${rel.from}`;
    const toUri = rel.to.includes('://') ? rel.to : `${baseUri}${rel.to}`;
    store.addRelation(fromUri, rel.predicate, toUri);
  }

  const warnings = store.validateGraph();
  const graph = filterGraph(store.getGraph(), req.user!.role, req.user!.userId, req.user!.department);
  try { await store.saveToDb(); } catch { /* best effort */ }
  try {
    const dir = join(process.cwd(), 'data', 'ontology');
    const fs = await import('fs');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    await store.saveToTurtle(join(dir, 'sse.owl'));
  } catch { /* best effort */ }

  await attachAvatars({ nodes: extraction.entities, edges: extraction.relations });
  res.json({ entities_added: extraction.entities.length, relations_added: extraction.relations.length, warnings, graph });
}));

router.get('/graph', asyncWrap(async (req, res) => {
  const graph = filterGraph(getEngine().store.getGraph(), req.user!.role, req.user!.userId, req.user!.department);
  await attachAvatars(graph);
  res.json(graph);
}));

router.put('/entity', asyncWrap(async (req, res) => {
  const { uri, type, properties } = req.body;
  if (!uri || !type) throw new AppError(400, 'INVALID_PARAMS', '请提供 uri 和 type');
  const store = getEngine().store;
  store.deleteEntity(uri);
  store.addEntity(uri, type, properties || {});
  try {
    const dir = join(process.cwd(), 'data', 'ontology');
    const fs = await import('fs');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    await store.saveToTurtle(join(dir, 'sse.owl'));
    await store.saveToDb();
  } catch { /* best effort */ }
  res.json({ message: '实体已保存', uri });
}));

router.delete('/entity', asyncWrap(async (req, res) => {
  const uri = req.query.uri as string;
  if (!uri) throw new AppError(400, 'INVALID_PARAMS', '请提供 uri 参数');
  const store = getEngine().store;
  store.deleteEntity(uri);
  try {
    const dir = join(process.cwd(), 'data', 'ontology');
    const fs = await import('fs');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    await store.saveToTurtle(join(dir, 'sse.owl'));
    await store.saveToDb();
  } catch { /* best effort */ }
  res.json({ message: '实体已删除' });
}));

router.post('/relation', asyncWrap(async (req, res) => {
  const { from, to, predicate } = req.body;
  if (!from || !to || !predicate) throw new AppError(400, 'INVALID_PARAMS', '请提供 from、to 和 predicate');
  const store = getEngine().store;
  store.addRelation(from, predicate, to);
  try {
    const dir = join(process.cwd(), 'data', 'ontology');
    const fs = await import('fs');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    await store.saveToTurtle(join(dir, 'sse.owl'));
    await store.saveToDb();
  } catch { /* best effort */ }
  res.json({ message: '关系已添加', from, predicate, to });
}));

router.delete('/relation', asyncWrap(async (req, res) => {
  const { from, to, predicate } = req.body;
  if (!from || !to || !predicate) throw new AppError(400, 'INVALID_PARAMS', '请提供 from、to 和 predicate');
  const store = getEngine().store;
  store.deleteRelation(from, predicate, to);
  try {
    const dir = join(process.cwd(), 'data', 'ontology');
    const fs = await import('fs');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    await store.saveToTurtle(join(dir, 'sse.owl'));
    await store.saveToDb();
  } catch { /* best effort */ }
  res.json({ message: '关系已删除' });
}));

router.post('/reason', asyncWrap(async (_req, res) => {
  const store = getEngine().store;
  const { Reasoner } = await import('@sse/ontology');
  const { PgReasoningRuleRepo } = await import('@sse/db');
  const reasoner = new Reasoner(store);
  const repo = new PgReasoningRuleRepo();
  const rules = await repo.findActive();
  const newTriples = reasoner.apply(rules);
  try { await store.saveToDb(); } catch { /* best effort */ }
  res.json({ message: `推理完成，新增 ${newTriples} 条三元组`, newTriples });
}));

router.post('/sparql', asyncWrap(async (req, res) => {
  const { role } = req.user!;
  if (role !== 'admin' && role !== 'finance') {
    throw new AppError(403, 'UNAUTHORIZED', '仅管理员和财务可执行 SPARQL 查询');
  }
  const { query } = req.body;
  if (!query) throw new AppError(400, 'INVALID_PARAMS', '请提供 query');
  const store = getEngine().store;
  const { executeSparql } = await import('@sse/ontology');
  const results = executeSparql(store.getStore(), query);
  res.json({ results, count: results.length });
}));

export { router as ontologyRoutes };
