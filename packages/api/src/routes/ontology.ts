import { Router, Request, Response, NextFunction } from 'express';
import { OntologyEngine, scopeGraphForUser } from '@sse/ontology';
import { authMiddleware } from '@sse/auth';
import { UserRole } from '@sse/shared';
import { AppError } from '../middleware/error';
import { PgUserRepo, pool } from '@sse/db';
import { getEngine } from './ontology-helpers';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

const router = Router();

function asyncWrap(fn: (req: Request, res: Response, next: NextFunction) => Promise<void>) {
  return (req: Request, res: Response, next: NextFunction) => { Promise.resolve(fn(req, res, next)).catch(next); };
}

router.use(authMiddleware);

function scopedGraph(req: Request) {
  return scopeGraphForUser(getEngine().store.getGraph(), {
    role: req.user!.role,
    userId: req.user!.userId,
    department: req.user!.department,
  });
}

function assertOntologyAdmin(role: string) {
  if (role !== UserRole.ADMIN) {
    throw new AppError(403, 'UNAUTHORIZED', '仅管理员可修改本体数据');
  }
}

function assertOntologyManager(role: string) {
  if (role !== UserRole.ADMIN && role !== UserRole.FINANCE) {
    throw new AppError(403, 'UNAUTHORIZED', '仅管理员和财务可执行该操作');
  }
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
  assertOntologyAdmin(req.user!.role);
  const store = getEngine().store;
  await getEngine().mapper.syncAll();
  const warnings = store.validateGraph();
  const graph = scopedGraph(req);
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
  const nodes = scopedGraph(req).nodes
    .filter(node => node.type === type)
    .map(node => ({ uri: node.id, properties: node.properties }));
  res.json(nodes);
}));

router.post('/from-text', asyncWrap(async (req, res) => {
  assertOntologyAdmin(req.user!.role);
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
  const graph = scopedGraph(req);
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
  const graph = scopedGraph(req);
  await attachAvatars(graph);
  res.json(graph);
}));

router.put('/entity', asyncWrap(async (req, res) => {
  assertOntologyAdmin(req.user!.role);
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
  assertOntologyAdmin(req.user!.role);
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
  assertOntologyAdmin(req.user!.role);
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
  assertOntologyAdmin(req.user!.role);
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

router.post('/reason', asyncWrap(async (req, res) => {
  assertOntologyManager(req.user!.role);
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
  assertOntologyManager(req.user!.role);
  const { query } = req.body ?? {};
  if (!query || typeof query !== 'string') throw new AppError(400, 'INVALID_PARAMS', '请提供 query');

  if (process.env.ONTOLOGY_V2 !== 'on' && process.env.ONTOLOGY_V2 !== 'shadow') {
    const store = getEngine().store;
    const { executeSparql } = await import('@sse/ontology');
    const results = executeSparql(store.getStore(), query);
    res.json({ results, count: results.length });
    return;
  }

  const { assertReadOnlySparql, capResults, getGraphStore } = await import('@sse/ontology');
  try {
    assertReadOnlySparql(query);
  } catch (err: any) {
    throw new AppError(400, 'INVALID_SPARQL', err?.message || 'SPARQL 查询无效');
  }

  const maxResults = Math.max(1, Number(process.env.ONTOLOGY_SPARQL_MAX_RESULTS) || 1000);
  const timeoutMs = Math.max(1, Number(process.env.ONTOLOGY_SPARQL_TIMEOUT_MS) || 1500);
  const result = await getGraphStore().query(capResults(query, maxResults), { timeoutMs });

  if (result.kind === 'select') {
    res.json({ results: result.rows, count: result.rows.length });
    return;
  }
  res.json({ results: result });
}));

router.post('/query-expense-status', asyncWrap(async (req, res) => {
  const { query } = req.body;
  if (!query) throw new AppError(400, 'INVALID_PARAMS', '请提供 query');

  let parsed: any = {};
  try {
    const extractor = getEngine().extractor;
    const extractPrompt = `从查询中提取报销筛选条件，仅输出JSON: { "name": "申请人姓名或null", "status": "pending/approved/rejected/paid或null", "keyword": "关键词或null" }\n查询: "${query}"`;
    const raw = await extractor.analyzeText(query, extractPrompt);
    const m = raw.match(/\{[\s\S]*\}/);
    if (m) parsed = JSON.parse(m[0]);
  } catch { /* 解析失败时用空过滤条件 */ }

  const { userId, role, department } = req.user!;
  const values: any[] = [];
  let sql = `SELECT er.id, er.serial_no, er.title, er.total_amount, er.status, er.submitted_at, u.name as applicant_name
             FROM expense_reports er JOIN users u ON u.id = er.user_id WHERE 1=1`;
  let idx = 1;

  if (role !== 'admin' && role !== 'finance') {
    if (role === 'dept_approver' && department) {
      sql += ` AND u.department = $${idx++}`;
      values.push(department);
    } else {
      sql += ` AND er.user_id = $${idx++}`;
      values.push(userId);
    }
  }
  if (parsed.name) { sql += ` AND u.name ILIKE $${idx++}`; values.push(`%${parsed.name}%`); }
  if (parsed.status) { sql += ` AND er.status = $${idx++}`; values.push(parsed.status); }
  if (parsed.keyword) { sql += ` AND (er.title ILIKE $${idx++} OR er.serial_no ILIKE $${idx++})`; values.push(`%${parsed.keyword}%`, `%${parsed.keyword}%`); }
  sql += ' ORDER BY er.submitted_at DESC LIMIT 20';

  const { rows } = await pool.query(sql, values);

  let summary = '';
  try {
    const summaryPrompt = `查询"${query}"的情况，用简洁中文总结:\n${JSON.stringify(rows, null, 2)}`;
    summary = await getEngine().extractor.analyzeText(JSON.stringify(rows), summaryPrompt);
  } catch { /* LLM 失败时返回原始数据 */ }

  res.json({ summary, results: rows, count: rows.length });
}));

export { router as ontologyRoutes };
