import { createClient } from './db/pool';
import type { BackupDatabaseConfig } from './types';

const LOCK_KEY = 727002;

export async function withBackupLock<T>(
  config: BackupDatabaseConfig,
  fn: () => Promise<T>
): Promise<T> {
  const client = createClient(config);
  await client.connect();
  try {
    const { rows } = await client.query('SELECT pg_try_advisory_lock($1) AS ok', [LOCK_KEY]);
    if (!rows[0].ok) throw new Error('BACKUP_BUSY');
    try {
      return await fn();
    } finally {
      await client.query('SELECT pg_advisory_unlock($1)', [LOCK_KEY]);
    }
  } finally {
    await client.end();
  }
}
