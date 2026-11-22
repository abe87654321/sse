import { Router, Request, Response, NextFunction } from 'express';
import { authMiddleware } from '@sse/auth';
import { loadBackupConfig } from '@sse/backup';
import { UserRole } from '@sse/shared';
import { requireRole } from '../middleware/rbac';
import { AppError } from '../middleware/error';
import { auditFromRequest } from '../services/audit';
import { getBackupService } from '../services/backup-service';

const router = Router();

function asyncWrap(fn: (req: Request, res: Response, next: NextFunction) => Promise<void>) {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

router.use(authMiddleware);
router.use(requireRole(UserRole.ADMIN));

router.get(
  '/',
  asyncWrap(async (req, res) => {
    const location = req.query.location === 'minio' ? 'minio' : 'local';
    res.json({ items: await getBackupService().listBackups(location) });
  })
);

router.post(
  '/',
  asyncWrap(async (req, res) => {
    const job = await getBackupService().startCreate(
      {
        includeSecrets: Boolean(req.body?.includeSecrets),
        upload: Boolean(req.body?.upload),
      },
      { userId: req.user!.userId, role: req.user!.role }
    );
    await auditFromRequest(req, {
      source: 'api',
      action: 'backup.create',
      entityType: 'backup',
      entityId: job.id,
      outcome: 'success',
      details: {
        includeSecrets: Boolean(req.body?.includeSecrets),
        upload: Boolean(req.body?.upload),
      },
    });
    res.status(202).json(job);
  })
);

router.get('/jobs', asyncWrap(async (_req, res) => {
  res.json({ items: getBackupService().list() });
}));

router.get(
  '/jobs/:jobId',
  asyncWrap(async (req, res) => {
    const job = getBackupService().get(req.params.jobId);
    if (!job) throw new AppError(404, 'NOT_FOUND', '任务不存在');
    res.json(job);
  })
);

router.get('/drills', asyncWrap(async (_req, res) => {
  res.json({ items: getBackupService().listDrills() });
}));

router.post(
  '/drills/:restoreId/cleanup',
  asyncWrap(async (req, res) => {
    if (process.env.BACKUP_RESTORE_ENABLED !== 'true') {
      throw new AppError(403, 'RESTORE_DISABLED', '恢复功能未启用');
    }
    const { targetDb, targetMinioPrefix, confirm } = req.body ?? {};
    if (!targetDb) throw new AppError(400, 'INVALID_PARAMS', 'targetDb 必填');
    if (confirm !== `CLEANUP ${targetDb}`) {
      throw new AppError(400, 'CONFIRM_REQUIRED', '确认短语不正确');
    }
    if (targetDb === (loadBackupConfig().db.database)) {
      throw new AppError(400, 'TARGET_IS_LIVE_DB', '不能清除当前数据库');
    }
    const job = await getBackupService().startDrillCleanup(
      {
        restoreId: req.params.restoreId,
        targetDb,
        targetMinioPrefix: targetMinioPrefix || '',
        confirm,
      },
      { userId: req.user!.userId, role: req.user!.role }
    );
    await auditFromRequest(req, {
      source: 'api',
      action: 'backup.drill_cleanup',
      entityType: 'backup',
      entityId: req.params.restoreId,
      outcome: 'success',
      details: { targetDb, targetMinioPrefix, jobId: job.id },
    });
    res.status(202).json(job);
  })
);

router.get(
  '/:id/download',
  asyncWrap(async (req, res) => {
    await getBackupService().download(req.params.id, res);
    await auditFromRequest(req, {
      source: 'api',
      action: 'backup.download',
      entityType: 'backup',
      entityId: req.params.id,
      outcome: 'success',
    });
  })
);

router.post(
  '/:id/verify',
  asyncWrap(async (req, res) => {
    const job = await getBackupService().startVerify(req.params.id, {
      userId: req.user!.userId,
      role: req.user!.role,
    });
    await auditFromRequest(req, {
      source: 'api',
      action: 'backup.verify',
      entityType: 'backup',
      entityId: req.params.id,
      outcome: 'success',
      details: { jobId: job.id },
    });
    res.status(202).json(job);
  })
);

router.post(
  '/:id/upload',
  asyncWrap(async (req, res) => {
    await getBackupService().upload(req.params.id);
    await auditFromRequest(req, {
      source: 'api',
      action: 'backup.upload',
      entityType: 'backup',
      entityId: req.params.id,
      outcome: 'success',
    });
    res.json({ ok: true });
  })
);

router.post(
  '/:id/restore',
  asyncWrap(async (req, res) => {
    if (process.env.BACKUP_RESTORE_ENABLED !== 'true') {
      throw new AppError(403, 'RESTORE_DISABLED', '恢复功能未启用');
    }
    const { targetDb, targetMinioPrefix, dryRun, confirm } = req.body ?? {};
    if (confirm !== `RESTORE ${req.params.id}`) {
      throw new AppError(400, 'CONFIRM_REQUIRED', '确认短语不正确');
    }
    if (!targetDb) throw new AppError(400, 'INVALID_PARAMS', 'targetDb 必填');
    if (targetDb === (loadBackupConfig().db.database)) {
      throw new AppError(400, 'TARGET_IS_LIVE_DB', '不能恢复到当前数据库');
    }

    const job = await getBackupService().startRestore(
      {
        from: req.params.id,
        targetDb,
        targetMinioPrefix: targetMinioPrefix || `drills/${req.params.id}/`,
        dryRun: Boolean(dryRun),
      },
      { userId: req.user!.userId, role: req.user!.role }
    );
    await auditFromRequest(req, {
      source: 'api',
      action: 'backup.restore',
      entityType: 'backup',
      entityId: req.params.id,
      outcome: 'success',
      details: { targetDb, targetMinioPrefix, dryRun: Boolean(dryRun), jobId: job.id },
    });
    res.status(202).json(job);
  })
);

router.delete(
  '/:id',
  asyncWrap(async (req, res) => {
    await getBackupService().remove(req.params.id);
    await auditFromRequest(req, {
      source: 'api',
      action: 'backup.delete',
      entityType: 'backup',
      entityId: req.params.id,
      outcome: 'success',
    });
    res.json({ ok: true });
  })
);

export { router as adminBackupRoutes };
