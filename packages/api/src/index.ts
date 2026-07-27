import { config } from 'dotenv';
import { resolve, join } from 'path';
config({ path: resolve(__dirname, '..', '..', '..', '.env') });
import { readFileSync, existsSync } from 'fs';
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
import { ontologyRoutes } from './routes/ontology';
import { OntologyEngine } from '@sse/ontology';
import { scimRoutes } from './routes/scim';
import { webhookRoutes } from './routes/webhook';
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
app.use('/ontology', ontologyRoutes);
app.use('/scim', scimRoutes);
app.use('/webhook', webhookRoutes);

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

async function initOntology() {
  const CONFIG_PATH = join(process.cwd(), 'ai-config.json');
  const defaults = {
    fillEngine: {
      endpoint: process.env.AI_ENDPOINT || 'http://localhost:11434/v1/chat/completions',
      model: process.env.AI_MODEL || 'llama3.2-vision',
    },
  };
  let cfg = defaults;
  try {
    if (existsSync(CONFIG_PATH)) {
      const saved = JSON.parse(readFileSync(CONFIG_PATH, 'utf-8'));
      cfg = { ...defaults, fillEngine: { ...defaults.fillEngine, ...(saved.fillEngine || {}) } };
    }
  } catch { /* use defaults */ }
  const engine = new OntologyEngine(cfg.fillEngine.endpoint, cfg.fillEngine.model);
  try {
    await engine.store.loadFromDb();
    console.log('[Ontology] 已从数据库恢复本体');
  } catch (e: any) {
    console.log('[Ontology] 数据库无历史本体:', e.message);
  }
  try {
    const turtlePath = join(process.cwd(), 'data', 'ontology', 'sse.owl');
    if (existsSync(turtlePath)) {
      await engine.store.loadFromTurtle(turtlePath);
      console.log('[Ontology] 已从 Turtle 文件恢复本体');
    }
  } catch { /* file may not exist yet */ }
}

const server = app.listen(PORT, '0.0.0.0', async () => {
  await initOntology();
  console.log(`[SSE API] 服务启动成功，端口: ${PORT}`);
  startScheduler();
});

process.on('SIGTERM', () => shutdown(server));
process.on('SIGINT', () => shutdown(server));
