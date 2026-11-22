import { readFile } from 'fs/promises';
import { join } from 'path';
import { applyMigrations } from '@sse/db';
import { readManifest } from './manifest';
import { planImport, importPackageTables } from './db/import';
import { dropForeignKeys, restoreForeignKeys } from './db/constraints';
import {
  dropTargetDatabase,
  ensureTargetDatabase,
  validateTargetDatabase,
} from './db/target';
import { readDatabaseSchema } from './db/schema';
import { createClient, createPool } from './db/pool';
import { createMinioClient, minioObjectStore, type ObjectStore } from './minio/client';
import { cleanupObjects, uploadObjects } from './minio/import';
import { restoreConfigs } from './config-files';
import { markRestoreRecordDeleted, writeRestoreRecord } from './restore-records';
import { verifyRestore } from './restore-verify';
import { ensureDir } from './fs-utils';
import type { BackupConfig } from './types';

export interface RestoreOptions {
  from: string;
  targetDb: string;
  targetMinioPrefix: string;
  dryRun: boolean;
}

export interface RestoreDeps {
  liveDatabase: string;
  backupDir: string;
  buckets: string[];
  objectStore: ObjectStore;
  createAdminClient: () => any;
  createTargetPool: (targetDb: string) => any;
  applyMigrations: typeof applyMigrations;
  readSchema: typeof readDatabaseSchema;
  importTables: typeof importPackageTables;
  dropForeignKeys: typeof dropForeignKeys;
  restoreForeignKeys: typeof restoreForeignKeys;
  uploadObjects: typeof uploadObjects;
  verifyRestore: typeof verifyRestore;
  dropTargetDatabase: typeof dropTargetDatabase;
  writeRestoreRecord: typeof writeRestoreRecord;
  restoreConfigs: typeof restoreConfigs;
}

export async function restoreBackup(options: RestoreOptions, deps: RestoreDeps) {
  validateTargetDatabase(options.targetDb, deps.liveDatabase);
  const manifest = readManifest(options.from);
  if (options.dryRun) return { ok: true, dryRun: true, manifest };

  const admin = deps.createAdminClient();
  let target: any;
  let record: any;
  let created = false;
  try {
    if (admin.connect) await admin.connect();
    await ensureTargetDatabase(admin, options.targetDb);
    created = true;

    target = deps.createTargetPool(options.targetDb);
    const client = await target.connect();
    try {
      await deps.applyMigrations(client);
      const targetSchema = await deps.readSchema(client);
      const sourceSchema = JSON.parse(
        await readFile(join(options.from, 'db', '_schema.json'), 'utf-8')
      );
      const plan = planImport(sourceSchema, targetSchema);
      await client.query('BEGIN');
      const fks = await deps.dropForeignKeys(client);
      await deps.importTables(client, join(options.from, 'db'), plan.tables);
      await deps.restoreForeignKeys(client, fks);
      await client.query('COMMIT');
    } catch (error) {
      try {
        await client.query('ROLLBACK');
      } catch {
        /* transaction may already be gone */
      }
      throw error;
    } finally {
      client.release();
    }

    await deps.uploadObjects(deps.objectStore, options.from, manifest, options.targetMinioPrefix);

    record = deps.writeRestoreRecord(deps.backupDir, {
      backupId: manifest.id,
      targetDb: options.targetDb,
      targetMinioPrefix: options.targetMinioPrefix,
    });
    const filesDir = join(deps.backupDir, 'restores', record.id, 'files');
    await ensureDir(filesDir);
    const configs = await deps.restoreConfigs(join(options.from, 'files'), filesDir);

    const verification = await deps.verifyRestore({
      pool: target,
      objectStore: deps.objectStore,
      prefix: options.targetMinioPrefix,
      manifest,
    });
    if (!verification.ok) {
      throw new Error(`RESTORE_VERIFY_FAILED ${verification.failures.join(', ')}`);
    }

    return {
      ok: true,
      manifest,
      verification,
      restoreId: record.id,
      configs,
    };
  } catch (error) {
    if (created) await deps.dropTargetDatabase(admin, options.targetDb);
    await cleanupObjects(deps.objectStore, manifest, options.targetMinioPrefix);
    if (record) markRestoreRecordDeleted(deps.backupDir, record.id);
    throw error;
  } finally {
    if (target?.end) await target.end();
    if (admin.end) await admin.end();
  }
}

export function defaultRestoreDeps(config: BackupConfig): RestoreDeps {
  const objectStore = minioObjectStore(createMinioClient(config.minio));
  return {
    liveDatabase: config.db.database,
    backupDir: config.backupDir,
    buckets: config.minio.buckets,
    objectStore,
    createAdminClient: () => createClient(config.db, 'postgres'),
    createTargetPool: (targetDb: string) =>
      createPool({ ...config.db, database: targetDb }),
    applyMigrations,
    readSchema: readDatabaseSchema,
    importTables: importPackageTables,
    dropForeignKeys,
    restoreForeignKeys,
    uploadObjects,
    verifyRestore,
    dropTargetDatabase,
    writeRestoreRecord,
    restoreConfigs,
  };
}
