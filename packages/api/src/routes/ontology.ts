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

export { router as ontologyRoutes };
