import { Router, Request, Response, NextFunction } from 'express';
import { PgUserRepo } from '@sse/db';
import { signToken, signRefreshToken, verifyRefreshToken } from '@sse/auth';
import { AppError } from '../middleware/error';

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

export { router as authRoutes };
