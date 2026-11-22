import { mkdtempSync, existsSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { createBackup } from '../backup';

test('creates package, manifest, checksums and archive', async () => {
  const root = mkdtempSync(join(tmpdir(), 'sse-backup-job-'));
  const result = await createBackup(
    { backupDir: root, includeSecrets: false, upload: false, id: 'b1' },
    {
      config: {
        db: { host: 'x', port: 1, database: 'sse', user: 'u', password: 'p' },
        minio: { endPoint: 'x', port: 1, useSSL: false, accessKey: 'a', secretKey: 's', buckets: [] },
        sseDir: root,
        backupDir: root,
        minioBackupBucket: 'backups',
        minioBackupPrefix: 'sse/',
      },
      exportDatabase: async () => ({
        schema: { schemaVersion: '024', serverVersion: '16', tables: [] },
        tables: [{ name: 'users', rows: 1, columns: ['id'], sha256: 'a'.repeat(64) }],
      }),
      exportObjects: async (store: any) => {
        expect(typeof store.listObjects).toBe('function');
        expect(typeof store.getObject).toBe('function');
        return [];
      },
      exportConfigs: async () => [],
      writeJsonFile: async () => undefined,
      connect: async () => ({ client: {}, release: () => undefined }),
    }
  );
  expect(result.id).toBe('b1');
  expect(existsSync(result.archivePath)).toBe(true);
  const manifest = JSON.parse(readFileSync(join(root, 'b1', 'package', 'manifest.json'), 'utf-8'));
  expect(manifest.schemaVersion).toBe('024');
  expect(manifest.counts).toEqual({ tables: 1, rows: 1, objects: 0 });
});
