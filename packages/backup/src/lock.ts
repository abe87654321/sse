import { createClient } from './db/pool';
import type { BackupDatabaseConfig } from './types';

const LOCK_KEY = 727002;

export interface BackupLock {
  release(): Promise<void>;
}

export async function acquireBackupLock(
  config: BackupDatabaseConfig
): Promise<BackupLock> {
  const client = createClient(config);
  await client.connect();
  const { rows } = await client.query('SELECT pg_try_advisory_lock($1) AS ok', [LOCK_KEY]);
  if (!rows[0].ok) {
    await client.end();
    throw new Error('BACKUP_BUSY');
  }
  return {
    async release() {
      try {
        await client.query('SELECT pg_advisory_unlock($1)', [LOCK_KEY]);
      } finally {
        await client.end();
      }
    },
  };
}

export async function withBackupLock<T>(
  config: BackupDatabaseConfig,
  fn: () => Promise<T>
): Promise<T> {
  const lock = await acquireBackupLock(config);
  try {
    return await fn();
  } finally {
    await lock.release();
  }
}
