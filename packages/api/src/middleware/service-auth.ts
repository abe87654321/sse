import { createHash, timingSafeEqual } from 'crypto';
import { Request, Response, NextFunction } from 'express';

const warned = new Set<string>();

function sha256(value: string): Buffer {
  return createHash('sha256').update(value, 'utf8').digest();
}

function safeEqual(a: string, b: string): boolean {
  return timingSafeEqual(sha256(a), sha256(b));
}

function headerValue(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

function configuredToken(envNames: string[]): { envName: string; token: string } | null {
  for (const envName of envNames) {
    const token = process.env[envName];
    if (token && token.trim() !== '') return { envName, token };
  }
  return null;
}

/**
 * Router-level authentication for service-to-service provisioning endpoints
 * (SCIM, MDM webhooks). Accepts `Authorization: Bearer <token>` or
 * `X-Service-Token: <token>`.
 *
 * In production an unset token is a hard failure (503) because these endpoints
 * can create users. Outside production it is allowed with a warning so local
 * development and tests keep working.
 */
export function serviceTokenAuth(...envNames: string[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const configured = configuredToken(envNames);

    if (!configured) {
      const label = envNames.join('/');
      if (process.env.NODE_ENV === 'production') {
        res.status(503).json({
          error: {
            code: 'SERVICE_TOKEN_NOT_CONFIGURED',
            message: `服务令牌未配置（${label}），已拒绝请求`,
          },
        });
        return;
      }
      if (!warned.has(label)) {
        warned.add(label);
        console.warn(`[service-auth] ${label} 未配置，非生产环境放行`);
      }
      next();
      return;
    }

    const authorization = req.headers.authorization;
    const bearer =
      typeof authorization === 'string' && authorization.startsWith('Bearer ')
        ? authorization.slice(7)
        : undefined;
    const provided = bearer || headerValue(req.headers['x-service-token']);

    if (!provided || !safeEqual(provided, configured.token)) {
      res.status(401).json({
        error: { code: 'UNAUTHORIZED', message: '无效的服务令牌' },
      });
      return;
    }

    next();
  };
}
