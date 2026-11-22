import { createClient } from './db/pool';
import { dropTargetDatabase, validateTargetDatabase } from './db/target';
import { markRestoreRecordDeleted } from './restore-records';
import { createMinioClient, minioObjectStore } from './minio/client';
import type { BackupConfig } from './types';

export interface CleanupDrillOptions {
  targetDb: string;
  targetMinioPrefix: string;
  confirm: string;
  restoreId?: string;
}

export interface CleanupDrillDeps {
  liveDatabase: string;
  backupDir: string;
  buckets: string[];
  createAdminPool: () => any;
  dropTargetDatabase: (admin: any, target: string) => Promise<void>;
  objectTarget: { removePrefix(bucket: string, prefix: string): Promise<void> };
}

export async function cleanupDrill(options: CleanupDrillOptions, deps: CleanupDrillDeps) {
  validateTargetDatabase(options.targetDb, deps.liveDatabase);
  if (options.confirm !== `CLEANUP ${options.targetDb}`) {
    throw new Error('CONFIRM_REQUIRED');
  }
  if (!options.targetMinioPrefix) {
    throw new Error('PREFIX_REQUIRED');
  }

  const admin = deps.createAdminPool();
  try {
    if (admin.connect) await admin.connect();
    await deps.dropTargetDatabase(admin, options.targetDb);
    for (const bucket of deps.buckets) {
      await deps.objectTarget.removePrefix(bucket, options.targetMinioPrefix);
    }
    if (options.restoreId) {
      markRestoreRecordDeleted(deps.backupDir, options.restoreId);
    }
    return {
      ok: true,
      targetDb: options.targetDb,
      targetMinioPrefix: options.targetMinioPrefix,
    };
  } finally {
    if (admin.end) await admin.end();
  }
}

export function defaultCleanupDeps(config: BackupConfig): CleanupDrillDeps {
  return {
    liveDatabase: config.db.database,
    backupDir: config.backupDir,
    buckets: config.minio.buckets,
    createAdminPool: () => createClient(config.db, 'postgres'),
    dropTargetDatabase,
    objectTarget: minioObjectStore(createMinioClient(config.minio)),
  };
}
