import { resolve } from 'path';
import type { BackupConfig, BackupConfigOverrides } from './types';

function num(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function loadBackupConfig(overrides: BackupConfigOverrides = {}): BackupConfig {
  const env = overrides.env ?? process.env;
  const database = env.DB_NAME || 'sse';
  if (!/^[A-Za-z0-9_.-]+$/.test(database)) throw new Error('DB_NAME 含有非法字符');
  return {
    db: {
      host: env.DB_HOST || 'localhost',
      port: num(env.DB_PORT, 5433),
      database,
      user: env.DB_USER || 'sse',
      password: env.DB_PASSWORD || 'sse_dev',
    },
    minio: {
      endPoint: env.MINIO_ENDPOINT || 'localhost',
      port: num(env.MINIO_PORT, 9002),
      useSSL: env.MINIO_USE_SSL === '1' || env.MINIO_USE_SSL === 'true',
      accessKey: env.MINIO_ACCESS_KEY || 'minioadmin',
      secretKey: env.MINIO_SECRET_KEY || 'minioadmin',
      buckets: (env.MINIO_BUCKETS || 'invoices,payment-receipts,avatars')
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean),
    },
    sseDir: resolve(env.SSE_DIR || process.cwd()),
    backupDir: resolve(overrides.backupDir || env.BACKUP_DIR || 'backups'),
    minioBackupBucket: env.MINIO_BACKUP_BUCKET || 'backups',
    minioBackupPrefix: env.MINIO_BACKUP_PREFIX || 'sse/',
  };
}
