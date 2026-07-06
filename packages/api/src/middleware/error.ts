import { Request, Response, NextFunction } from 'express';

export interface HttpError extends Error {
  status?: number;
  code?: string;
}

export function errorHandler(
  err: HttpError,
  _req: Request,
  res: Response,
  _next: NextFunction
): void {
  console.error('[API Error]', err.message, err.stack);

  const status = err.status || 500;
  const code = err.code || 'INTERNAL_ERROR';
  const message = status === 500 ? '服务器内部错误' : err.message;

  res.status(status).json({
    error: { code, message },
  });
}

export class AppError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string
  ) {
    super(message);
    this.name = 'AppError';
  }
}
