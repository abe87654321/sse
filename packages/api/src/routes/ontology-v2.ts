import { Router, Request, Response, NextFunction } from 'express';
import { authMiddleware, resolveDataScope } from '@sse/auth';
import {
  GRAPH,
  INST,
  InvalidQueryError,
  RDF_TYPE,
  SnapshotRepo,
  explainReport,
  findAnomalies,
  getGraphStore,
  getLastShadowReport,
  getPool,
  getQueryService,
  impactAnalysis,
  reportUri as buildReportUri,
  sparqlIri,
  sparqlString,
  sse,
  validateExpense,
} from '@sse/ontology';
import { requireRole } from '../middleware/rbac';
import { AppError } from '../middleware/error';
import { persistGraphSnapshot } from '../services/ontology-projector';
import { getEngine } from './ontology-helpers';

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

function graphStore() {
  try {
    return getGraphStore();
  } catch {
    throw new AppError(503, 'ONTOLOGY_V2_UNAVAILABLE', '本体图尚未初始化');
  }
}

function graphPool() {
  try {
    return getPool();
  } catch {
    return undefined;
  }
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined;
}

function optionalNumber(value: unknown): number | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function queryParam(value: unknown): string | undefined {
  if (Array.isArray(value)) return typeof value[0] === 'string' ? value[0] : undefined;
  return typeof value === 'string' ? value : undefined;
}

/**
 * `codes` accepts either repeated query params (`?codes=a&codes=b`) or a single
 * comma-separated value (`?codes=a,b`).
 */
function parseCodes(value: unknown): string[] | undefined {
  const raw = Array.isArray(value) ? value : value === undefined || value === null ? [] : [value];
  const codes = raw
    .filter((item): item is string => typeof item === 'string')
    .flatMap((item) => item.split(','))
    .map((item) => item.trim())
    .filter((item) => item !== '');
  return codes.length > 0 ? [...new Set(codes)] : undefined;
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

const MANUAL_GRAPH_NAMES = [GRAPH.tbox, GRAPH.data, GRAPH.inferred, GRAPH.history, GRAPH.manual];
const LOCAL_NAME = /^[A-Za-z][A-Za-z0-9_]*$/;

function requiredString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new AppError(400, 'INVALID_PARAMS', `请提供 ${label}`);
  }
  return value.trim();
}

function normalizeEntityIri(value: unknown, label = 'uri'): string {
  const raw = requiredString(value, label);
  if (!raw.includes('://')) return `${INST}${raw.replace(/^\/+/, '')}`;
  return raw;
}

function iriTerm(value: unknown, label: string): string {
  try {
    return sparqlIri(normalizeEntityIri(value, label));
  } catch {
    throw new AppError(400, 'INVALID_PARAMS', `${label} 必须是 https://sse.local/ 下的绝对 IRI`);
  }
}

function typeTerm(value: unknown): string {
  const raw = requiredString(value, 'type');
  if (raw.includes('://')) {
    try {
      return sparqlIri(raw);
    } catch {
      throw new AppError(400, 'INVALID_PARAMS', '类型 IRI 必须位于 https://sse.local/ 命名空间');
    }
  }
  if (!LOCAL_NAME.test(raw)) {
    throw new AppError(400, 'INVALID_PARAMS', '类型名无效');
  }
  return `<${sse(raw)}>`;
}

function predicateTerm(value: unknown): string {
  const raw = requiredString(value, 'predicate');
  if (raw.includes('://')) {
    try {
      return sparqlIri(raw);
    } catch {
      throw new AppError(400, 'INVALID_PARAMS', '谓词 IRI 必须位于 https://sse.local/ 命名空间');
    }
  }
  if (!LOCAL_NAME.test(raw)) {
    throw new AppError(400, 'INVALID_PARAMS', '谓词名无效');
  }
  return `<${sse(raw)}>`;
}

function propertyTriples(subject: string, properties: unknown): string[] {
  if (properties === undefined || properties === null) return [];
  if (typeof properties !== 'object' || Array.isArray(properties)) {
    throw new AppError(400, 'INVALID_PARAMS', 'properties 必须是对象');
  }
  const triples: string[] = [];
  for (const [key, value] of Object.entries(properties as Record<string, unknown>)) {
    if (value === undefined || value === null) continue;
    triples.push(`${subject} ${predicateTerm(key)} ${sparqlString(String(value))} .`);
  }
  return triples;
}

export interface ManualPersistence {
  persisted: boolean;
}

/**
 * Serialize manual snapshots against the projector's drain when the pool
 * supports connections. The projector uses a try-lock too, so this never blocks
 * it; it just avoids dumping while a batch is being applied.
 */
async function withManualSnapshotLock<T>(
  pool: any,
  fn: (db: any | undefined) => Promise<T>,
): Promise<T> {
  if (typeof pool?.connect !== 'function') return fn(undefined);
  let client: any;
  try {
    client = await pool.connect();
  } catch {
    return fn(undefined);
  }
  try {
    await client.query('BEGIN');
    const lock = await client.query('SELECT pg_try_advisory_xact_lock(728001) AS ok');
    if (!lock.rows[0]?.ok) {
      await client.query('ROLLBACK');
      const unlocked = client;
      client = undefined;
      unlocked.release();
      return fn(undefined);
    }
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    if (client) await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    if (client) client.release();
  }
}

/**
 * Manual writes bypass the outbox, so persist the graph snapshot immediately.
 * The watermark is read before the dump: a watermark behind the dump is safe
 * (idempotent replay), while one ahead would lose outbox rows.
 * The in-memory write always stands; the returned flag only reports whether it
 * reached the DB.
 */
async function persistManualSnapshot(): Promise<ManualPersistence> {
  const store = graphStore();
  const pool = graphPool();
  if (!pool) {
    const nquads = await store.dump(MANUAL_GRAPH_NAMES);
    store.checkpoint(nquads);
    console.error('[ontology] manual snapshot not persisted: graph pool unavailable');
    return { persisted: false };
  }
  try {
    await withManualSnapshotLock(pool, (db) => {
      const target = db ?? pool;
      return persistGraphSnapshot({
        store,
        pool: target,
        snapshots: new SnapshotRepo(target),
        graphNames: MANUAL_GRAPH_NAMES,
      });
    });
    return { persisted: true };
  } catch (err: any) {
    console.error(`[ontology] manual snapshot persistence failed: ${err?.message ?? err}`);
    return { persisted: false };
  }
}

router.use(authMiddleware);

router.get('/status', asyncWrap(async (req, res) => {
  const status = await queryService().status();
  const shadow = getLastShadowReport();
  const isAdmin = req.user!.role === 'admin';

  // Raw projector errors can contain row values or database details. Only
  // admins get the message; other callers get a null marker.
  const safeStatus = isAdmin
    ? status
    : { ...status, outbox: { ...status.outbox, lastError: null } };

  // Shadow comparisons contain record IDs and whitelisted values. Expose them
  // only to admins; every other caller gets the same status without the diff.
  if (shadow && isAdmin) {
    res.json({
      ...safeStatus,
      shadow: {
        equal: shadow.equal,
        differences: shadow.differences,
        checkedAt: shadow.checkedAt,
      },
    });
    return;
  }

  res.json(safeStatus);
}));

router.get('/schema', asyncWrap(async (_req, res) => {
  res.json(await queryService().schema());
}));

router.get('/graph', asyncWrap(async (req, res) => {
  const { nodes, edges } = await queryService().graph(toScope(req));
  const typeCounts: Record<string, number> = {};
  for (const node of nodes) {
    typeCounts[node.type] = (typeCounts[node.type] || 0) + 1;
  }
  res.json({
    summary: {
      total_nodes: nodes.length,
      total_edges: edges.length,
      type_counts: typeCounts,
    },
    graph: { nodes, edges },
  });
}));

router.put('/entity', requireRole('admin'), asyncWrap(async (req, res) => {
  const body = req.body ?? {};
  const subject = iriTerm(body.uri, 'uri');
  const type = typeTerm(body.type);
  const triples = [`${subject} <${RDF_TYPE}> ${type} .`, ...propertyTriples(subject, body.properties)];

  const store = graphStore();
  await store.update(`DELETE WHERE { GRAPH <${GRAPH.manual}> { ${subject} ?p ?o } }`);
  await store.update(`INSERT DATA { GRAPH <${GRAPH.manual}> { ${triples.join('\n')} } }`);
  const { persisted } = await persistManualSnapshot();

  res.json({ message: '实体已保存到 urn:sse:manual', uri: normalizeEntityIri(body.uri), persisted });
}));

router.delete('/entity', requireRole('admin'), asyncWrap(async (req, res) => {
  const body = req.body ?? {};
  const rawUri = body.uri ?? req.query.uri;
  const subject = iriTerm(rawUri, 'uri');

  const store = graphStore();
  await store.update(`DELETE WHERE { GRAPH <${GRAPH.manual}> { ${subject} ?p ?o } }`);
  await store.update(`DELETE WHERE { GRAPH <${GRAPH.manual}> { ?s ?p ${subject} } }`);
  const { persisted } = await persistManualSnapshot();

  res.json({ message: '实体已从 urn:sse:manual 删除', uri: normalizeEntityIri(rawUri), persisted });
}));

router.post('/relation', requireRole('admin'), asyncWrap(async (req, res) => {
  const body = req.body ?? {};
  const from = iriTerm(body.from, 'from');
  const predicate = predicateTerm(body.predicate);
  const to = iriTerm(body.to, 'to');

  await graphStore().update(
    `INSERT DATA { GRAPH <${GRAPH.manual}> { ${from} ${predicate} ${to} . } }`,
  );
  const { persisted } = await persistManualSnapshot();

  res.json({ message: '关系已保存到 urn:sse:manual', persisted });
}));

router.delete('/relation', requireRole('admin'), asyncWrap(async (req, res) => {
  const body = req.body ?? {};
  const from = iriTerm(body.from, 'from');
  const predicate = predicateTerm(body.predicate);
  const to = iriTerm(body.to, 'to');

  await graphStore().update(
    `DELETE DATA { GRAPH <${GRAPH.manual}> { ${from} ${predicate} ${to} . } }`,
  );
  const { persisted } = await persistManualSnapshot();

  res.json({ message: '关系已从 urn:sse:manual 删除', persisted });
}));

router.post('/from-text', requireRole('admin'), asyncWrap(async (req, res) => {
  const text = requiredString(req.body?.text, 'text');

  let extraction;
  try {
    extraction = await getEngine().extractor.extractGraph(text);
  } catch (err: any) {
    res.status(503).json({
      error: { code: 'AI_SERVICE_UNAVAILABLE', message: err?.message || 'AI 模型调用失败' },
    });
    return;
  }

  const triples: string[] = [];
  const entities = extraction.entities ?? [];
  const relations = extraction.relations ?? [];
  for (const entity of entities) {
    const subject = iriTerm(entity.uri, 'uri');
    triples.push(`${subject} <${RDF_TYPE}> ${typeTerm(entity.type)} .`);
    triples.push(...propertyTriples(subject, entity.properties));
  }
  for (const relation of relations) {
    triples.push(
      `${iriTerm(relation.from, 'from')} ${predicateTerm(relation.predicate)} ${iriTerm(relation.to, 'to')} .`,
    );
  }

  let persisted = true;
  if (triples.length > 0) {
    await graphStore().update(
      `INSERT DATA { GRAPH <${GRAPH.manual}> { ${triples.join('\n')} } }`,
    );
    persisted = (await persistManualSnapshot()).persisted;
  }

  res.json({ entities_added: entities.length, relations_added: relations.length, persisted });
}));

router.get('/entities', asyncWrap(async (req, res) => {
  const type = queryParam(req.query.type);
  const explicitPageSize = queryParam(req.query.page_size ?? req.query.pageSize);
  const result = await queryService().listEntities({
    type,
    status: queryParam(req.query.status),
    department: queryParam(req.query.department),
    q: queryParam(req.query.q),
    page: pageNumber(req.query.page),
    // The legacy `type` shape returned every match; only apply pagination when
    // the caller explicitly asks for it.
    pageSize: type && explicitPageSize === undefined ? 1000 : pageSize(explicitPageSize),
    scope: toScope(req),
  });

  if (type) {
    res.json(result.results.map((entity) => ({ uri: entity.uri, properties: entity.properties })));
    return;
  }
  res.json(result);
}));

router.get('/entities/:uri(*)/network', asyncWrap(async (req, res) => {
  const uri = entityUri(req);
  const rawDepth = Number(req.query.depth);
  const depth = Number.isFinite(rawDepth) ? rawDepth : 2;
  const scope = toScope(req);
  // Out-of-scope roots are indistinguishable from missing entities, mirroring
  // the legacy graph scope behavior instead of returning an empty network.
  if (!(await queryService().isInScope(uri, scope))) {
    throw new AppError(404, 'NOT_FOUND', '实体不存在或无权访问');
  }
  res.json(await queryService().network(uri, {
    depth,
    direction: direction(req.query.direction),
    scope,
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

router.post('/validate', asyncWrap(async (req, res) => {
  const body = req.body ?? {};
  const amount = optionalNumber(body.amount);
  if (amount === undefined || amount <= 0) {
    throw new AppError(400, 'INVALID_PARAMS', '请提供有效的 amount');
  }

  res.json(await validateExpense(
    graphStore(),
    {
      amount,
      category_id: optionalString(body.category_id ?? body.categoryId),
      category_name: optionalString(body.category_name ?? body.categoryName),
      report_id: optionalString(body.report_id ?? body.reportId),
    },
    toScope(req),
    graphPool(),
  ));
}));

router.post('/explain', asyncWrap(async (req, res) => {
  const body = req.body ?? {};
  const raw = optionalString(body.report_uri ?? body.reportUri ?? body.uri ?? body.report_id ?? body.reportId);
  if (!raw) {
    throw new AppError(400, 'INVALID_PARAMS', '请提供 report_uri 或 report_id');
  }

  const explanation = await explainReport(graphStore(), buildReportUri(raw), toScope(req));
  if (!explanation) throw new AppError(404, 'NOT_FOUND', '报销单不存在或无权访问');
  res.json(explanation);
}));

router.post('/impact', asyncWrap(async (req, res) => {
  const body = req.body ?? {};
  res.json(await impactAnalysis(
    graphStore(),
    {
      rule_id: optionalString(body.rule_id ?? body.ruleId),
      category_id: optionalString(body.category_id ?? body.categoryId),
      department: optionalString(body.department),
      min_amount: optionalNumber(body.min_amount ?? body.minAmount),
      max_amount: optionalNumber(body.max_amount ?? body.maxAmount),
      amount_delta: optionalNumber(body.amount_delta ?? body.amountDelta),
      limit: optionalNumber(body.limit),
    },
    toScope(req),
  ));
}));

router.get('/anomalies', asyncWrap(async (req, res) => {
  const limit = optionalNumber(req.query.limit) ?? 500;
  res.json(await findAnomalies(graphStore(), {
    limit,
    codes: parseCodes(req.query.codes),
    scope: toScope(req),
  }));
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
