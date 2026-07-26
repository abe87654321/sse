import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(__dirname, '..', '..', '..', '.env') });
import express from 'express';
import cors from 'cors';
import type { Server } from 'http';
import { authRoutes } from './routes/auth';
import { expenseRoutes } from './routes/expenses';
import { approvalRoutes } from './routes/approvals';
import { statisticsRoutes } from './routes/statistics';
import { adminRoutes } from './routes/admin';
import { aiRoutes } from './routes/ai';
import { notificationRoutes } from './routes/notifications';
import { userRoutes } from './routes/user';
import { adminMessageRoutes } from './routes/admin-messages';
import { errorHandler } from './middleware/error';

const app = express();
const PORT = Number(process.env.PORT) || 3000;

app.use(cors());
app.use(express.json({ limit: '10mb' }));

app.use('/auth', authRoutes);
app.use('/expenses', expenseRoutes);
app.use('/approvals', approvalRoutes);
app.use('/statistics', statisticsRoutes);
app.use('/admin', adminRoutes);
app.use('/ai', aiRoutes);
app.use('/notifications', notificationRoutes);
app.use('/user', userRoutes);
app.use('/admin/messages', adminMessageRoutes);

app.get('/categories', async (_req, res, next) => {
  try {
    const { pool } = await import('@sse/db');
    const { rows } = await pool.query('SELECT id, name FROM expense_categories ORDER BY name');
    res.json(rows);
  } catch (e) { next(e); }
});

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.use(errorHandler);

let schedulerInstance: { start: () => void; stop: () => void } | null = null;

async function startScheduler() {
  try {
    const { PgApprovalRecordRepo, PgNotificationLogRepo, PgUserRepo, PgExpenseRepo } = await import('@sse/db');
    const { NotificationService, ApprovalReminderScheduler } = await import('@sse/notifications');

    const smsProvider = !process.env.SMS_PROVIDER || process.env.SMS_PROVIDER === 'dev' || process.env.SMS_PROVIDER === 'log'
      ? new (await import('@sse/notifications')).DevSmsProvider()
      : (await import('@sse/notifications')).createSmsProvider();
    const emailProvider = !process.env.EMAIL_PROVIDER || process.env.EMAIL_PROVIDER === 'dev' || process.env.EMAIL_PROVIDER === 'log'
      ? new (await import('@sse/notifications')).DevEmailProvider()
      : (await import('@sse/notifications')).createEmailProvider();

    const notificationService = new NotificationService(smsProvider, emailProvider);

    schedulerInstance = new ApprovalReminderScheduler(
      new PgApprovalRecordRepo(),
      new PgNotificationLogRepo(),
      new PgUserRepo(),
      new PgExpenseRepo(),
      notificationService,
    );

    schedulerInstance.start();
    console.log('[SSE] 审批提醒调度器已启动（每15分钟检查一次）');
  } catch (err) {
    console.warn('[SSE] 审批提醒调度器启动失败（可能数据库未连接）:', err);
  }
}

function shutdown(server: Server) {
  console.log('[SSE] 正在关闭服务...');
  if (schedulerInstance) schedulerInstance.stop();
  server.close(() => {
    console.log('[SSE] 服务已关闭');
    process.exit(0);
  });
  setTimeout(() => {
    console.log('[SSE] 强制退出');
    process.exit(1);
  }, 5000);
}

const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`[SSE API] 服务启动成功，端口: ${PORT}`);
  startScheduler();
});

process.on('SIGTERM', () => shutdown(server));
process.on('SIGINT', () => shutdown(server));
