import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { restoreBackup } from '../restore';
import { listRestoreRecords, writeRestoreRecord } from '../restore-records';

test('restores to a drill database and MinIO prefix, then verifies', async () => {
  const root = mkdtempSync(join(tmpdir(), 'sse-restore-'));
  const pkg = join(root, 'package');
  mkdirSync(join(pkg, 'db'), { recursive: true });
  mkdirSync(join(pkg, 'minio', 'avatars'), { recursive: true });
  writeFileSync(join(pkg, 'db', 'users.jsonl'), '{"id":"u1"}\n');
  writeFileSync(join(pkg, 'db', '_schema.json'), JSON.stringify({
    schemaVersion: '024',
    serverVersion: '16',
    tables: [{
      name: 'users',
      columns: [{ name: 'id', ordinal: 1, dataType: 'uuid', udtName: 'uuid', nullable: false, default: null }],
    }],
  }));
  writeFileSync(join(pkg, 'minio', 'avatars', 'u1.png'), 'png');
  writeFileSync(join(pkg, 'manifest.json'), JSON.stringify({
    formatVersion: 1,
    id: 'b1',
    schemaVersion: '024',
    tables: [{ name: 'users', rows: 1, columns: ['id'], sha256: '' }],
    objects: [{ bucket: 'avatars', key: 'u1.png', size: 3, sha256: '' }],
    configs: [],
  }));

  const calls: string[] = [];
  const result = await restoreBackup(
    { from: pkg, targetDb: 'sse_drill_b1', targetMinioPrefix: 'drills/b1/', dryRun: false },
    {
      liveDatabase: 'sse',
      backupDir: root,
      buckets: ['avatars'],
      objectStore: {} as any,
      createAdminClient: () => ({
        connect: async () => undefined,
        query: async (sql: string) => { calls.push(sql); return { rows: [] }; },
        end: async () => undefined,
      }),
      createTargetPool: () => ({
        connect: async () => ({
          query: async (sql: string) => { calls.push(sql); return { rows: [] }; },
          release: () => undefined,
        }),
        end: async () => undefined,
      }),
      applyMigrations: async () => ['024'],
      readSchema: async () => ({
        schemaVersion: '024',
        serverVersion: '16',
        tables: [{
          name: 'users',
          columns: [{ name: 'id', ordinal: 1, dataType: 'uuid', udtName: 'uuid', nullable: false, default: null }],
        }],
      }),
      importTables: async () => ({ users: 1 }),
      dropForeignKeys: async () => [],
      restoreForeignKeys: async () => undefined,
      uploadObjects: async () => undefined,
      verifyRestore: async () => ({
        ok: true,
        failures: [],
        tables: [],
        objects: [],
        links: { expected: 0, matched: 0 },
      }),
      dropTargetDatabase: async () => undefined,
      writeRestoreRecord,
      restoreConfigs: async (_source: string, target: string) => {
        mkdirSync(target, { recursive: true });
        writeFileSync(join(target, '.keep'), '');
        return [];
      },
    }
  );

  expect(result.ok).toBe(true);
  expect(calls.some((sql) => sql.includes('CREATE DATABASE "sse_drill_b1"'))).toBe(true);
  expect(existsSync(join(root, 'restores'))).toBe(true);
  expect(listRestoreRecords(root)[0]).toMatchObject({
    backupId: 'b1',
    targetDb: 'sse_drill_b1',
    status: 'active',
  });
});
