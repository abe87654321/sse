import express from 'express';
import cors from 'cors';
import { authRoutes } from './routes/auth';
import { expenseRoutes } from './routes/expenses';
import { approvalRoutes } from './routes/approvals';
import { statisticsRoutes } from './routes/statistics';
import { adminRoutes } from './routes/admin';
import { errorHandler } from './middleware/error';

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '10mb' }));

app.use('/auth', authRoutes);
app.use('/expenses', expenseRoutes);
app.use('/approvals', approvalRoutes);
app.use('/statistics', statisticsRoutes);
app.use('/admin', adminRoutes);

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.use(errorHandler);

app.listen(PORT, () => {
  console.log(`[SSE API] 服务启动成功，端口: ${PORT}`);
});

export default app;
