import { randomBytes } from 'crypto';
import { writeFile } from 'fs/promises';
import { join } from 'path';
import { createArchive } from './archive';
import { exportConfigs } from './config-files';
import { createPool } from './db/pool';
import { exportDatabase } from './db/export';
import { ensureDir } from './fs-utils';
import { writeChecksums, writeManifest } from './manifest';
import { createMinioClient, minioObjectStore } from './minio/client';
import { exportObjects } from './minio/export';
import { MinioBackupStore } from './storage/minio-store';
import type { BackupConfig, BackupManifest } from './types';

export interface CreateBackupOptions {
  backupDir: string;
  includeSecrets: boolean;
  upload: boolean;
  id?: string;
}

export interface CreateBackupDeps {
  config: BackupConfig;
  exportDatabase: typeof exportDatabase;
  exportObjects: typeof exportObjects;
  exportConfigs: typeof exportConfigs;
  writeJsonFile: (path: string, value: unknown) => Promise<void>;
  connect?: () => Promise<{ client: any; release: () => void }>;
}

export function makeBackupId(now = new Date()): string {
  const stamp = now.toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
  return `${stamp}-${randomBytes(3).toString('hex')}`;
}

export async function createBackup(
  options: CreateBackupOptions,
  deps: CreateBackupDeps
): Promise<{ id: string; archivePath: string; manifest: BackupManifest }> {
  const id = options.id ?? makeBackupId();
  const root = join(options.backupDir, id);
  const pkg = join(root, 'package');
  await ensureDir(pkg);

  const connect = deps.connect ?? (async () => {
    const pool = createPool(deps.config.db);
    const client = await pool.connect();
    return {
      client,
      release: () => {
        client.release();
        void pool.end();
      },
    };
  });
  const connection = await connect();
  let dbResult;
  try {
    dbResult = await deps.exportDatabase(connection.client, join(pkg, 'db'));
  } finally {
    connection.release();
  }

  const objects = await deps.exportObjects(
    minioObjectStore(createMinioClient(deps.config.minio)),
    deps.config.minio.buckets,
    join(pkg, 'minio')
  );
  const configs = await deps.exportConfigs(deps.config.sseDir, join(pkg, 'files'), {
    includeSecrets: options.includeSecrets,
  });

  const rows = dbResult.tables.reduce((sum, table) => sum + table.rows, 0);
  const manifest: BackupManifest = {
    formatVersion: 1,
    id,
    createdAt: new Date().toISOString(),
    schemaVersion: dbResult.schema.schemaVersion,
    database: { serverVersion: dbResult.schema.serverVersion, name: deps.config.db.database },
    tables: dbResult.tables,
    objects,
    configs,
    containsSecrets: configs.some((item) => item.sensitive),
    counts: { tables: dbResult.tables.length, rows, objects: objects.length },
  };

  await deps.writeJsonFile(join(pkg, 'db', '_schema.json'), dbResult.schema);
  writeManifest(pkg, manifest);
  writeChecksums(pkg);

  const archivePath = join(root, `${id}.tar.gz`);
  await createArchive(pkg, archivePath);

  if (options.upload) {
    await new MinioBackupStore(
      createMinioClient(deps.config.minio),
      deps.config.minioBackupBucket,
      deps.config.minioBackupPrefix
    ).upload(id, archivePath);
  }

  return { id, archivePath, manifest };
}

export const defaultCreateBackupDeps = {
  exportDatabase,
  exportObjects,
  exportConfigs,
  writeJsonFile: async (path: string, value: unknown) => {
    await writeFile(path, JSON.stringify(value, null, 2));
  },
};
