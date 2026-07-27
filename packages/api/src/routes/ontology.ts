import { Router, Request, Response, NextFunction } from 'express';
import { OntologyEngine } from '@sse/ontology';
import { authMiddleware } from '@sse/auth';
import { AppError } from '../middleware/error';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

const router = Router();
const CONFIG_PATH = join(process.cwd(), 'ai-config.json');

function loadAiConfig() {
  const defaults = { fillEngine: { endpoint: 'http://localhost:11434/v1/chat/completions', model: 'llama3.1:8b' } };
  try { if (existsSync(CONFIG_PATH)) { const saved = JSON.parse(readFileSync(CONFIG_PATH, 'utf-8')); return { ...defaults, fillEngine: { ...defaults.fillEngine, ...(saved.fillEngine || {}) } }; } } catch { /* use defaults */ }
  return defaults;
}

let engine: OntologyEngine;

function getEngine(): OntologyEngine {
  if (!engine) {
    const cfg = loadAiConfig();
    engine = new OntologyEngine(cfg.fillEngine.endpoint, cfg.fillEngine.model);
  }
  return engine;
}

function asyncWrap(fn: (req: Request, res: Response, next: NextFunction) => Promise<void>) {
  return (req: Request, res: Response, next: NextFunction) => { Promise.resolve(fn(req, res, next)).catch(next); };
}

router.use(authMiddleware);

router.post('/submit-from-text', asyncWrap(async (req, res) => {
  const { text } = req.body;
  if (!text) throw new AppError(400, 'INVALID_PARAMS', '请提供 text');
  const result = await getEngine().submitFromText(text, req.user!.userId, req.headers.authorization?.split(' ')[1] || '');
  res.json(result);
}));

router.get('/sync', asyncWrap(async (_req, res) => {
  await getEngine().mapper.syncAll();
  res.json({ message: '本体同步完成' });
}));

router.get('/query', asyncWrap(async (req, res) => {
  const type = req.query.type as string;
  if (!type) throw new AppError(400, 'INVALID_PARAMS', '请提供 type 参数');
  res.json(getEngine().store.queryByType(type));
}));

router.post('/from-text', asyncWrap(async (req, res) => {
  const { text } = req.body;
  if (!text) throw new AppError(400, 'INVALID_PARAMS', '请提供 text 描述');

  const extraction = await getEngine().extractor.extractGraph(text);

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

  const graph = store.getGraph();
  res.json({ entities_added: extraction.entities.length, relations_added: extraction.relations.length, graph });
}));

router.get('/graph', asyncWrap(async (_req, res) => {
  const graph = getEngine().store.getGraph();
  res.json(graph);
}));

router.put('/entity', asyncWrap(async (req, res) => {
  const { uri, type, properties } = req.body;
  if (!uri || !type) throw new AppError(400, 'INVALID_PARAMS', '请提供 uri 和 type');
  const store = getEngine().store;
  store.deleteEntity(uri);
  store.addEntity(uri, type, properties || {});
  res.json({ message: '实体已保存', uri });
}));

router.delete('/entity', asyncWrap(async (req, res) => {
  const uri = req.query.uri as string;
  if (!uri) throw new AppError(400, 'INVALID_PARAMS', '请提供 uri 参数');
  getEngine().store.deleteEntity(uri);
  res.json({ message: '实体已删除' });
}));

router.post('/relation', asyncWrap(async (req, res) => {
  const { from, to, predicate } = req.body;
  if (!from || !to || !predicate) throw new AppError(400, 'INVALID_PARAMS', '请提供 from、to 和 predicate');
  getEngine().store.addRelation(from, predicate, to);
  res.json({ message: '关系已添加', from, predicate, to });
}));

router.delete('/relation', asyncWrap(async (req, res) => {
  const { from, to, predicate } = req.body;
  if (!from || !to || !predicate) throw new AppError(400, 'INVALID_PARAMS', '请提供 from、to 和 predicate');
  getEngine().store.deleteRelation(from, predicate, to);
  res.json({ message: '关系已删除' });
}));

export { router as ontologyRoutes };
