import { Router, Request, Response, NextFunction } from 'express';
import { authMiddleware } from '@sse/auth';
import { requireRole } from '../middleware/rbac';
import { AppError } from '../middleware/error';

const router = Router();

function asyncWrap(fn: (req: Request, res: Response, next: NextFunction) => Promise<void>) {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

router.use(authMiddleware);

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

export { router as ontologyV2Routes };
