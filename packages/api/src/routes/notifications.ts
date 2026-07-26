import { Router, Request, Response, NextFunction } from 'express';
import { PgNotificationRepo } from '@sse/db';
import { authMiddleware } from '@sse/auth';
import { AppError } from '../middleware/error';

const router = Router();
const repo = new PgNotificationRepo();

function asyncWrap(fn: (req: Request, res: Response, next: NextFunction) => Promise<void>) {
  return (req: Request, res: Response, next: NextFunction) => { Promise.resolve(fn(req, res, next)).catch(next); };
}

router.use(authMiddleware);

router.get('/', asyncWrap(async (req, res) => {
  const page = Number(req.query.page) || 1;
  const pageSize = Number(req.query.pageSize) || 20;
  const result = await repo.findByUserId(req.user!.userId, page, pageSize);
  res.json({ results: result.results, total: result.total, page, pageSize });
}));

router.get('/unread-count', asyncWrap(async (req, res) => {
  const count = await repo.countUnread(req.user!.userId);
  res.json({ count });
}));

router.put('/:id/read', asyncWrap(async (req, res) => {
  const n = await repo.findById(req.params.id);
  if (!n || n.user_id !== req.user!.userId) throw new AppError(404, 'NOT_FOUND', '通知不存在');
  await repo.markRead(req.params.id);
  res.json({ message: '已标记已读' });
}));

router.put('/read-all', asyncWrap(async (req, res) => {
  await repo.markAllRead(req.user!.userId);
  res.json({ message: '全部已读' });
}));

export { router as notificationRoutes };
