import { Router, Request, Response, NextFunction } from 'express';
import { PgUserRepo } from '@sse/db';
import { signToken, signRefreshToken, verifyRefreshToken, authMiddleware } from '@sse/auth';
import { AppError } from '../middleware/error';
import { pool } from '@sse/db';
import { uploadAvatar } from '../middleware/upload';
import { MinioStorage } from '../storage/minio-storage';

const router = Router();
const userRepo = new PgUserRepo();

function asyncWrap(fn: (req: Request, res: Response, next: NextFunction) => Promise<void>) {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

router.post(
  '/login',
  asyncWrap(async (req, res) => {
    const { phone, password } = req.body;

    if (!phone || !password) {
      throw new AppError(400, 'INVALID_PARAMS', '手机号和密码不能为空');
    }

    const user = await userRepo.findByPhone(phone);
    if (!user) {
      throw new AppError(401, 'UNAUTHORIZED', '手机号或密码错误');
    }

    if (user.status !== 'active') {
      throw new AppError(403, 'UNAUTHORIZED', '账号已被禁用');
    }

    const accessToken = signToken({
      userId: user.id,
      role: user.role,
      department: user.department,
    });
    const refreshToken = signRefreshToken(user.id);

    res.json({
      accessToken,
      refreshToken,
      user: {
        id: user.id,
        name: user.name,
        phone: user.phone,
        email: user.email,
        department: user.department,
        role: user.role,
        avatarUrl: user.avatarUrl,
      },
    });
  })
);

router.post(
  '/refresh',
  asyncWrap(async (req, res) => {
    const { refreshToken } = req.body;

    if (!refreshToken) {
      throw new AppError(400, 'INVALID_PARAMS', 'refreshToken 不能为空');
    }

    const userId = verifyRefreshToken(refreshToken);
    if (!userId) {
      throw new AppError(401, 'UNAUTHORIZED', 'invalid grant');
    }

    const user = await userRepo.findById(userId);
    if (!user) {
      throw new AppError(401, 'UNAUTHORIZED', '用户不存在');
    }

    const accessToken = signToken({
      userId: user.id,
      role: user.role,
      department: user.department,
    });

    res.json({ accessToken });
  })
);

router.get(
  '/profile/avatar',
  asyncWrap(async (req, res) => {
    const targetUserId = (req.query.userId as string) || '';
    if (!targetUserId) throw new AppError(400, 'INVALID_PARAMS', '缺少 userId');

    const user = await userRepo.findById(targetUserId);
    if (!user?.avatarUrl) throw new AppError(404, 'NOT_FOUND', '未上传头像');

    const minio = new MinioStorage();
    try {
      const data = await minio.getObject(user.avatarUrl, 'avatars');
      const ext = user.avatarUrl.split('.').pop()?.toLowerCase();
      const mime = ext === 'png' ? 'image/png' : 'image/jpeg';
      res.setHeader('Content-Type', mime);
      res.setHeader('Cache-Control', 'public, max-age=3600');
      res.send(data);
    } catch {
      throw new AppError(404, 'NOT_FOUND', '头像文件不存在');
    }
  })
);

router.use(authMiddleware);

router.get(
  '/profile',
  asyncWrap(async (req, res) => {
    const user = await userRepo.findById(req.user!.userId);
    if (!user) throw new AppError(404, 'NOT_FOUND', '用户不存在');
    res.json({
      id: user.id, name: user.name, phone: user.phone, email: user.email,
      department: user.department, role: user.role, avatarUrl: user.avatarUrl,
    });
  })
);

router.put(
  '/profile',
  asyncWrap(async (req, res) => {
    const { name, email } = req.body;
    const updates: string[] = [];
    const values: any[] = [];
    let i = 1;
    if (name !== undefined) { updates.push(`name = $${i++}`); values.push(name); }
    if (email !== undefined) { updates.push(`email = $${i++}`); values.push(email); }
    if (updates.length === 0) throw new AppError(400, 'INVALID_PARAMS', '无可修改的字段');
    values.push(req.user!.userId);
    await pool.query(`UPDATE users SET ${updates.join(', ')} WHERE id = $${i}`, values);
    res.json({ message: '更新成功' });
  })
);

router.post(
  '/profile/avatar',
  uploadAvatar.single('file'),
  asyncWrap(async (req, res) => {
    if (!req.file) throw new AppError(400, 'INVALID_PARAMS', '请选择图片');

    const minio = new MinioStorage();
    const ext = req.file.originalname.split('.').pop()?.toLowerCase() || 'png';
    const storageKey = `avatars/${req.user!.userId}_${Date.now()}.${ext}`;

    await minio.upload(storageKey, 'avatars', req.file.buffer,
      ext === 'png' ? 'image/png' : 'image/jpeg');

    await userRepo.updateAvatar(req.user!.userId, storageKey);

    res.json({ message: '头像上传成功', avatarUrl: storageKey });
  })
);

router.put(
  '/password',
  asyncWrap(async (req, res) => {
    const { oldPassword, newPassword } = req.body;
    if (!newPassword || newPassword.length < 6) throw new AppError(400, 'INVALID_PARAMS', '新密码至少6位');
    await pool.query('UPDATE users SET password_hash = $1 WHERE id = $2', [newPassword, req.user!.userId]);
    res.json({ message: '密码修改成功' });
  })
);

export { router as authRoutes };
