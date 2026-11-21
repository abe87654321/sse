import { Router, Request, Response, NextFunction } from 'express';
import { PgReportSnapshotRepo } from '@sse/db';
import { authMiddleware } from '@sse/auth';
import { requireRole } from '../middleware/rbac';
import { UserRole } from '@sse/shared';
import { AppError } from '../middleware/error';

const router = Router();
const snapshotRepo = new PgReportSnapshotRepo();

function asyncWrap(fn: (req: Request, res: Response, next: NextFunction) => Promise<void>) {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

function parseDate(value: unknown, label: string): string | undefined {
  if (value === undefined || value === '') return undefined;
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) {
    throw new AppError(400, 'INVALID_PARAMS', `${label} 时间格式无效`);
  }
  return value;
}

function parseBoolean(value: unknown): boolean | undefined {
  if (value === undefined || value === '') return undefined;
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw new AppError(400, 'INVALID_PARAMS', 'legacy 参数无效');
}

router.use(authMiddleware);
router.use(requireRole(UserRole.ADMIN));

router.get(
  '/',
  asyncWrap(async (req, res) => {
    const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200);
    const offset = Math.max(Number(req.query.offset) || 0, 0);
    const stringParam = (value: unknown): string | undefined =>
      typeof value === 'string' && value !== '' ? value : undefined;

    const { items, total } = await snapshotRepo.query({
      reportId: stringParam(req.query.reportId),
      snapshotType: stringParam(req.query.snapshotType),
      legacy: parseBoolean(req.query.legacy),
      from: parseDate(req.query.from, 'from'),
      to: parseDate(req.query.to, 'to'),
      limit,
      offset,
    });

    res.json({ items, total, limit, offset });
  })
);

router.get(
  '/:id',
  asyncWrap(async (req, res) => {
    const detail = await snapshotRepo.findDetailById(req.params.id);
    if (!detail) throw new AppError(404, 'NOT_FOUND', '快照不存在');
    res.json(detail);
  })
);

export { router as adminSnapshotRoutes };
