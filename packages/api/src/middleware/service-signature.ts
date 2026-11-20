import { createHash, createHmac, timingSafeEqual } from 'crypto';
import type { Request, Response, NextFunction } from 'express';
import { auditIdentityEvent } from '../services/identity-audit';

export interface SignatureAuthOptions {
  source: string;
  secretEnv: string | string[];
  toleranceSeconds?: number;
  now?: () => number;
}

const DEFAULT_TOLERANCE_SECONDS = 300;
const seenSignatures = new Map<string, number>();
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

function configuredSecret(envNames: string[]): { envName: string; secret: string } | null {
  for (const envName of envNames) {
    const secret = process.env[envName];
    if (secret && secret.trim() !== '') return { envName, secret };
  }
  return null;
}

export function captureRawBody(req: Request, _res: Response, buf: Buffer): void {
  (req as Request & { rawBody?: Buffer }).rawBody = buf;
}

export function computeServiceSignature(
  secret: string,
  input: { timestamp: string; method: string; url: string; body: string }
): string {
  const payload = [
    input.timestamp,
    input.method.toUpperCase(),
    input.url,
    input.body,
  ].join('\n');
  return createHmac('sha256', secret).update(payload, 'utf8').digest('hex');
}

function reject(
  req: Request,
  res: Response,
  source: string,
  status: number,
  code: string,
  message: string,
  reason: string
): void {
  auditIdentityEvent({
    source,
    action: 'authenticate',
    outcome: 'rejected',
    reason,
    ip: req.ip,
  });
  res.status(status).json({ error: { code, message } });
}

export function serviceSignatureAuth(options: SignatureAuthOptions) {
  const envNames = Array.isArray(options.secretEnv) ? options.secretEnv : [options.secretEnv];
  const label = envNames.join('/');
  const toleranceSeconds =
    options.toleranceSeconds ??
    (Number(process.env.SERVICE_SIGNATURE_TOLERANCE_SECONDS) || DEFAULT_TOLERANCE_SECONDS);
  const now = options.now ?? (() => Math.floor(Date.now() / 1000));

  return (req: Request, res: Response, next: NextFunction): void => {
    const configured = configuredSecret(envNames);

    if (!configured) {
      if (process.env.NODE_ENV === 'production') {
        res.status(503).json({
          error: {
            code: 'SIGNING_SECRET_NOT_CONFIGURED',
            message: `请求签名密钥未配置（${label}），已拒绝请求`,
          },
        });
        return;
      }
      if (!warned.has(label)) {
        warned.add(label);
        console.warn(`[service-signature] ${label} 未配置，非生产环境跳过签名校验`);
      }
      next();
      return;
    }

    const timestamp = headerValue(req.headers['x-timestamp']);
    const signature = headerValue(req.headers['x-signature']);

    if (!timestamp || !signature || !/^\d+$/.test(timestamp)) {
      reject(req, res, options.source, 401, 'INVALID_SIGNATURE', '缺少或无效的请求签名', 'missing_headers');
      return;
    }

    const timestampSeconds = Number(timestamp);
    if (Math.abs(now() - timestampSeconds) > toleranceSeconds) {
      reject(req, res, options.source, 401, 'STALE_SIGNATURE', '请求签名已过期', 'stale_timestamp');
      return;
    }

    const rawBody = (req as Request & { rawBody?: Buffer }).rawBody;
    const body = rawBody ? rawBody.toString('utf8') : '';
    const expected = computeServiceSignature(configured.secret, {
      timestamp,
      method: req.method,
      url: req.originalUrl,
      body,
    });

    if (!safeEqual(signature, expected)) {
      reject(req, res, options.source, 401, 'INVALID_SIGNATURE', '请求签名无效', 'bad_signature');
      return;
    }

    const replayKey = `${options.source}:${signature}`;
    const expiresAt = seenSignatures.get(replayKey);
    if (expiresAt && expiresAt > now()) {
      reject(req, res, options.source, 401, 'REPLAY_DETECTED', '检测到重复的请求签名', 'replay');
      return;
    }

    for (const [key, expiry] of seenSignatures) {
      if (expiry <= now()) seenSignatures.delete(key);
    }
    seenSignatures.set(replayKey, now() + toleranceSeconds);

    next();
  };
}
