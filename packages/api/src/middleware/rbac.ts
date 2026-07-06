import { Request, Response, NextFunction } from 'express';
import { AppError } from './error';

export function requireRole(...roles: string[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) {
      throw new AppError(401, 'UNAUTHORIZED', '未认证');
    }
    if (!roles.includes(req.user.role)) {
      throw new AppError(403, 'UNAUTHORIZED', '权限不足');
    }
    next();
  };
}
