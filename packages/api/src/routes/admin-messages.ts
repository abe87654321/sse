import { Router, Request, Response, NextFunction } from 'express';
import { PgNotificationRepo, PgUserRepo, pool } from '@sse/db';
import { authMiddleware } from '@sse/auth';
import { requireRole } from '../middleware/rbac';
import { UserRole } from '@sse/shared';
import { AppError } from '../middleware/error';

const router = Router();
const repo = new PgNotificationRepo();
const userRepo = new PgUserRepo();

function asyncWrap(fn: (req: Request, res: Response, next: NextFunction) => Promise<void>) {
  return (req: Request, res: Response, next: NextFunction) => { Promise.resolve(fn(req, res, next)).catch(next); };
}

router.use(authMiddleware);
router.use(requireRole(UserRole.ADMIN));

router.get('/', asyncWrap(async (req, res) => {
  const status = req.query.status as string | undefined;
  const messages = await repo.findSystemMessages(status);
  res.json(messages);
}));

router.get('/:id', asyncWrap(async (req, res) => {
  const msg = await repo.findSystemMessageById(req.params.id);
  if (!msg) throw new AppError(404, 'NOT_FOUND', '消息不存在');
  res.json(msg);
}));

router.post('/', asyncWrap(async (req, res) => {
  const { title, body, body_ai, target_roles, target_user_ids, delivery_channels, send_now } = req.body;
  if (!title || !body) throw new AppError(400, 'INVALID_PARAMS', '标题和正文不能为空');

  const msg = await repo.createSystemMessage({
    title, body,
    body_ai: body_ai || undefined,
    target_roles: target_roles || [],
    target_user_ids: target_user_ids || [],
    sender_id: req.user!.userId,
    delivery_channels: delivery_channels || [],
    status: send_now ? 'sent' : 'draft',
  });

  if (send_now) {
    const targetUsers = await resolveTargetUsers(target_roles || [], target_user_ids || []);
    const { NotificationEngine } = await import('@sse/notifications');
    const { NotificationService, DevSmsProvider, DevEmailProvider, createSmsProvider, createEmailProvider } = await import('@sse/notifications');
    const smsProvider = process.env.SMS_PROVIDER === 'dev' || process.env.SMS_PROVIDER === 'log' || !process.env.SMS_PROVIDER ? new DevSmsProvider() : createSmsProvider();
    const emailProvider = process.env.EMAIL_PROVIDER === 'dev' || process.env.EMAIL_PROVIDER === 'log' || !process.env.EMAIL_PROVIDER ? new DevEmailProvider() : createEmailProvider();
    const engine = new NotificationEngine(repo, userRepo, new NotificationService(smsProvider, emailProvider));
    const finalBody = body_ai || body;
    await engine.sendBatch(targetUsers, 'broadcast', title, finalBody, (delivery_channels || []).filter((c: string) => c === 'sms' || c === 'email') as ('sms' | 'email')[]);
  }

  res.status(201).json(msg);
}));

router.put('/:id', asyncWrap(async (req, res) => {
  const msg = await repo.findSystemMessageById(req.params.id);
  if (!msg) throw new AppError(404, 'NOT_FOUND', '消息不存在');
  if (msg.status === 'sent') throw new AppError(400, 'INVALID_PARAMS', '已发送的消息不可编辑');
  await repo.updateSystemMessage(req.params.id, req.body);
  res.json({ message: '更新成功' });
}));

router.post('/:id/send', asyncWrap(async (req, res) => {
  const msg = await repo.findSystemMessageById(req.params.id);
  if (!msg) throw new AppError(404, 'NOT_FOUND', '消息不存在');
  if (msg.status === 'sent') throw new AppError(400, 'INVALID_PARAMS', '消息已发送');

  const targetUsers = await resolveTargetUsers(msg.target_roles || [], msg.target_user_ids || []);
  const { NotificationEngine } = await import('@sse/notifications');
  const { NotificationService, DevSmsProvider, DevEmailProvider, createSmsProvider, createEmailProvider } = await import('@sse/notifications');
  const smsProvider = process.env.SMS_PROVIDER === 'dev' || process.env.SMS_PROVIDER === 'log' || !process.env.SMS_PROVIDER ? new DevSmsProvider() : createSmsProvider();
  const emailProvider = process.env.EMAIL_PROVIDER === 'dev' || process.env.EMAIL_PROVIDER === 'log' || !process.env.EMAIL_PROVIDER ? new DevEmailProvider() : createEmailProvider();
  const engine = new NotificationEngine(repo, userRepo, new NotificationService(smsProvider, emailProvider));
  const finalBody = msg.body_ai || msg.body;
  await engine.sendBatch(targetUsers, 'broadcast', msg.title, finalBody, (msg.delivery_channels || []).filter((c: string) => c === 'sms' || c === 'email') as ('sms' | 'email')[]);

  await repo.updateSystemMessage(msg.id, { status: 'sent' });
  res.json({ message: '发送成功', sent_to: targetUsers.length });
}));

router.delete('/:id', asyncWrap(async (req, res) => {
  await repo.deleteSystemMessage(req.params.id);
  res.json({ message: '已删除' });
}));

async function resolveTargetUsers(roles: string[], userIds: string[]): Promise<string[]> {
  const userIdSet = new Set<string>();
  if (roles && roles.length > 0) {
    const { rows } = await pool.query('SELECT id FROM users WHERE role = ANY($1)', [roles]);
    rows.forEach((r: any) => userIdSet.add(r.id));
  }
  if (userIds && userIds.length > 0) {
    userIds.forEach(id => userIdSet.add(id));
  }
  return Array.from(userIdSet);
}

export { router as adminMessageRoutes };
