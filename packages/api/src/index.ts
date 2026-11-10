import { config } from 'dotenv';
import { resolve, join } from 'path';
config({ path: resolve(__dirname, '..', '..', '..', '.env') });
import { existsSync } from 'fs';
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
import { ontologyV2Routes, ontologyV2UnavailableRoutes } from './routes/ontology-v2';
import { getEngine } from './routes/ontology-helpers';
import { scimRoutes } from './routes/scim';
import { webhookRoutes } from './routes/webhook';
import { errorHandler } from './middleware/error';
import { buildOpenApiDocument } from './openapi';
import { processPendingPaymentReceipts } from './services/payment-receipt-verifier';

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
const ontologyV2Enabled = process.env.ONTOLOGY_V2 === 'on' || process.env.ONTOLOGY_V2 === 'shadow';
if (ontologyV2Enabled) app.use('/ontology', ontologyV2Routes);
app.use('/ontology', ontologyRoutes);
if (!ontologyV2Enabled) app.use('/ontology', ontologyV2UnavailableRoutes);
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

// OpenAPI 3.1 spec for agents/frameworks that consume REST instead of MCP.
app.get('/openapi.json', (_req, res) => {
  res.json(buildOpenApiDocument());
});
app.get('/openapi', (_req, res) => {
  res.redirect('/openapi.json');
});

app.use(errorHandler);

let schedulerInstance: { start: () => void; stop: () => void } | null = null;
let paymentReceiptTimer: NodeJS.Timeout | null = null;

async function startScheduler() {
  try {
    const { PgApprovalRecordRepo, PgUserRepo, PgExpenseRepo } = await import('@sse/db');
    const { ApprovalReminderScheduler, createNotificationEngine } = await import('@sse/notifications');

    schedulerInstance = new ApprovalReminderScheduler(
      new PgApprovalRecordRepo(),
      new PgUserRepo(),
      new PgExpenseRepo(),
      createNotificationEngine(),
    );

    schedulerInstance.start();
    console.log('[SSE] 审批提醒调度器已启动（每15分钟检查一次）');
  } catch (err) {
    console.warn('[SSE] 审批提醒调度器启动失败（可能数据库未连接）:', err);
  }
}

async function shutdown(server: Server) {
  console.log('[SSE] 正在关闭服务...');
  if (schedulerInstance) schedulerInstance.stop();
  if (paymentReceiptTimer) {
    clearInterval(paymentReceiptTimer);
    paymentReceiptTimer = null;
  }
  try {
    const { stopOntologyProjector } = await import('./services/ontology-projector');
    await stopOntologyProjector();
  } catch (err) {
    console.warn('[Ontology] 投影器关闭失败', err);
  }
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
  const engine = getEngine();
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
  if (process.env.ONTOLOGY_V2 === 'on' || process.env.ONTOLOGY_V2 === 'shadow') {
    const { startOntologyProjector } = await import('./services/ontology-projector');
    await startOntologyProjector();
  }
  console.log(`[SSE API] 服务启动成功，端口: ${PORT}`);
  startScheduler();
  processPendingPaymentReceipts().catch((err) => {
    console.warn('[SSE] 打款回单待核对扫描失败:', err);
  });
  paymentReceiptTimer = setInterval(() => {
    processPendingPaymentReceipts().catch((err) => {
      console.warn('[SSE] 打款回单待核对扫描失败:', err);
    });
  }, 5 * 60 * 1000);
  paymentReceiptTimer.unref?.();
});

process.on('SIGTERM', () => { void shutdown(server); });
process.on('SIGINT', () => { void shutdown(server); });
