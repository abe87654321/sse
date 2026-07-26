import { Router, Request, Response, NextFunction } from 'express';
import { pool } from '@sse/db';
import { authMiddleware } from '@sse/auth';
import { AppError } from '../middleware/error';

const router = Router();

function asyncWrap(fn: (req: Request, res: Response, next: NextFunction) => Promise<void>) {
  return (req: Request, res: Response, next: NextFunction) => { Promise.resolve(fn(req, res, next)).catch(next); };
}

router.use(authMiddleware);

router.get('/notify-prefs', asyncWrap(async (req, res) => {
  const { rows } = await pool.query('SELECT notify_prefs FROM users WHERE id = $1', [req.user!.userId]);
  res.json(rows[0]?.notify_prefs || { sms: {}, email: {}, broadcast: true, in_app: {} });
}));

router.put('/notify-prefs', asyncWrap(async (req, res) => {
  const { notify_prefs } = req.body;
  if (!notify_prefs) throw new AppError(400, 'INVALID_PARAMS', '请提供 notify_prefs');
  await pool.query('UPDATE users SET notify_prefs = $1 WHERE id = $2', [JSON.stringify(notify_prefs), req.user!.userId]);
  res.json({ message: '通知偏好已更新' });
}));

router.get('/search', asyncWrap(async (req, res) => {
  const q = (req.query.q as string)?.trim();
  const role = (req.query.role as string)?.trim();

  if (role) {
    const { rows } = await pool.query(
      "SELECT id, name, phone, department, role FROM users WHERE status = 'active' AND role = $1 ORDER BY name",
      [role]
    );
    res.json(rows);
    return;
  }

  if (q) {
    const { rows } = await pool.query(
      "SELECT id, name, phone, department, role FROM users WHERE status = 'active' AND (name ILIKE $1 OR phone ILIKE $1) ORDER BY name LIMIT 20",
      [`%${q}%`]
    );
    res.json(rows);
  } else {
    const { rows } = await pool.query(
      "SELECT id, name, phone, department, role FROM users WHERE status = 'active' ORDER BY name LIMIT 50"
    );
    res.json(rows);
  }
}));

export { router as userRoutes };
