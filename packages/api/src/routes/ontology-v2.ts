import { Router, Request, Response, NextFunction } from 'express';
import { authMiddleware, resolveDataScope } from '@sse/auth';
import { getQueryService, InvalidQueryError } from '@sse/ontology';
import { requireRole } from '../middleware/rbac';
import { AppError } from '../middleware/error';

const router = Router();

function asyncWrap(fn: (req: Request, res: Response, next: NextFunction) => Promise<void>) {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch((err) => {
      if (err instanceof InvalidQueryError) {
        next(new AppError(400, 'INVALID_PARAMS', err.message));
        return;
      }
      next(err);
    });
  };
}

function queryService() {
  try {
    return getQueryService();
  } catch {
    throw new AppError(503, 'ONTOLOGY_V2_UNAVAILABLE', '本体查询服务尚未初始化');
  }
}

function toScope(req: Request) {
  return resolveDataScope({
    role: req.user!.role,
    userId: req.user!.userId,
    department: req.user!.department,
  });
}

function queryParam(value: unknown): string | undefined {
  if (Array.isArray(value)) return typeof value[0] === 'string' ? value[0] : undefined;
  return typeof value === 'string' ? value : undefined;
}

function pageNumber(value: unknown): number {
  const page = Math.floor(Number(value));
  return Number.isFinite(page) && page > 0 ? page : 1;
}

function pageSize(value: unknown): number {
  const size = Math.floor(Number(value));
  return Number.isFinite(size) && size > 0 ? Math.min(100, size) : 20;
}

function direction(value: unknown): 'both' | 'out' | 'in' {
  return value === 'out' || value === 'in' ? value : 'both';
}

function entityUri(req: Request): string {
  const raw = req.params.uri;
  if (!raw.includes('%')) return raw;
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

router.use(authMiddleware);

router.get('/status', asyncWrap(async (_req, res) => {
  res.json(await queryService().status());
}));

router.get('/schema', asyncWrap(async (_req, res) => {
  res.json(await queryService().schema());
}));

router.get('/entities', asyncWrap(async (req, res) => {
  const type = queryParam(req.query.type);
  const result = await queryService().listEntities({
    type,
    status: queryParam(req.query.status),
    department: queryParam(req.query.department),
    q: queryParam(req.query.q),
    page: pageNumber(req.query.page),
    pageSize: pageSize(req.query.page_size ?? req.query.pageSize),
    scope: toScope(req),
  });

  if (type) {
    res.json(result.results.map((entity) => ({ uri: entity.uri, properties: entity.properties })));
    return;
  }
  res.json(result);
}));

router.get('/entities/:uri(*)/network', asyncWrap(async (req, res) => {
  const rawDepth = Number(req.query.depth);
  const depth = Number.isFinite(rawDepth) ? rawDepth : 2;
  res.json(await queryService().network(entityUri(req), {
    depth,
    direction: direction(req.query.direction),
    scope: toScope(req),
  }));
}));

router.get('/entities/:uri(*)', asyncWrap(async (req, res) => {
  const entity = await queryService().getEntity(entityUri(req), toScope(req));
  if (!entity) throw new AppError(404, 'NOT_FOUND', '实体不存在或无权访问');
  res.json(entity);
}));

router.post('/query', asyncWrap(async (req, res) => {
  const body = req.body ?? {};
  const scope = toScope(req);
  const type = typeof body.type === 'string' ? body.type : undefined;
  const page = pageNumber(body.page);
  const size = pageSize(body.pageSize ?? body.page_size);

  if (type) {
    res.json(await queryService().listEntities({
      type,
      status: typeof body.status === 'string' ? body.status : undefined,
      department: typeof body.department === 'string' ? body.department : undefined,
      q: typeof body.q === 'string' ? body.q : undefined,
      page,
      pageSize: size,
      scope,
    }));
    return;
  }

  res.json(await queryService().searchReports({
    status: typeof body.status === 'string' ? body.status : undefined,
    department: typeof body.department === 'string' ? body.department : undefined,
    q: typeof body.q === 'string' ? body.q : undefined,
    page,
    pageSize: size,
    scope,
  }));
}));

router.post('/validate', asyncWrap(async () => {
  throw new AppError(501, 'NOT_IMPLEMENTED', '本体校验将在 Phase 4 提供');
}));

router.post('/explain', asyncWrap(async () => {
  throw new AppError(501, 'NOT_IMPLEMENTED', '本体解释将在 Phase 4 提供');
}));

router.post('/impact', asyncWrap(async () => {
  throw new AppError(501, 'NOT_IMPLEMENTED', '影响分析将在 Phase 4 提供');
}));

router.get('/anomalies', asyncWrap(async (_req, res) => {
  res.json([]);
}));

router.post('/reconcile', requireRole('admin'), asyncWrap(async (_req, res) => {
  const { startReconcileJob } = await import('@sse/ontology');
  const job = startReconcileJob();
  res.status(202).json({ job_id: job.id, state: job.state });
}));

router.get('/reconcile/:jobId', requireRole('admin'), asyncWrap(async (req, res) => {
  const { getReconcileJob } = await import('@sse/ontology');
  const job = getReconcileJob(req.params.jobId);
  if (!job) throw new AppError(404, 'NOT_FOUND', '任务不存在');
  res.json(job);
}));

/**
 * Mounted after the legacy routes when ONTOLOGY_V2 is disabled so that v2-only
 * endpoints fail with a clear 503 instead of falling through to a 404/500.
 */
const V2_ROUTES: Array<[string, RegExp]> = [
  ['GET', /^\/status\/?$/],
  ['GET', /^\/schema\/?$/],
  ['GET', /^\/entities(?:\/.*)?\/?$/],
  ['GET', /^\/anomalies\/?$/],
  ['POST', /^\/query\/?$/],
  ['POST', /^\/(?:validate|explain|impact)\/?$/],
  ['POST', /^\/reconcile\/?$/],
  ['GET', /^\/reconcile\/[^/]+\/?$/],
];

export const ontologyV2UnavailableRoutes = Router();

ontologyV2UnavailableRoutes.use((req, res, next) => {
  const matches = V2_ROUTES.some(([method, pattern]) => req.method === method && pattern.test(req.path));
  if (!matches) {
    next();
    return;
  }
  res.status(503).json({
    error: {
      code: 'ONTOLOGY_V2_UNAVAILABLE',
      message: '本体查询服务未启用（设置 ONTOLOGY_V2=on|shadow）',
    },
  });
});

export { router as ontologyV2Routes };
