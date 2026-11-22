import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { cleanupDrill } from '../drill-cleanup';
import { writeRestoreRecord, listRestoreRecords } from '../restore-records';

test('rejects cleaning the live database and invalid names', async () => {
  await expect(
    cleanupDrill(
      { targetDb: 'sse', targetMinioPrefix: 'drills/x/', confirm: 'CLEANUP sse' },
      { liveDatabase: 'sse' } as any
    )
  ).rejects.toThrow('TARGET_IS_LIVE_DB');
  await expect(
    cleanupDrill(
      { targetDb: 'sse; DROP', targetMinioPrefix: '', confirm: 'CLEANUP sse; DROP' },
      { liveDatabase: 'sse' } as any
    )
  ).rejects.toThrow('INVALID_TARGET_DB');
});

test('drops the drill database, clears the prefix and marks the record', async () => {
  const root = mkdtempSync(join(tmpdir(), 'sse-drill-'));
  const record = writeRestoreRecord(root, {
    backupId: 'b1',
    targetDb: 'sse_drill_b1',
    targetMinioPrefix: 'drills/b1/',
  });

  const calls: string[] = [];
  const result = await cleanupDrill(
    {
      targetDb: 'sse_drill_b1',
      targetMinioPrefix: 'drills/b1/',
      confirm: 'CLEANUP sse_drill_b1',
      restoreId: record.id,
    },
    {
      liveDatabase: 'sse',
      backupDir: root,
      buckets: ['avatars', 'invoices', 'payment-receipts'],
      createAdminPool: () => ({
        query: async (sql: string) => {
          calls.push(sql);
          return { rows: [] };
        },
        end: async () => undefined,
      }),
      dropTargetDatabase: async (_admin: any, target: string) => {
        calls.push(`DROP ${target}`);
      },
      objectTarget: {
        removePrefix: async (bucket: string, prefix: string) => {
          calls.push(`CLEAR ${bucket}/${prefix}`);
        },
      },
    }
  );

  expect(result.ok).toBe(true);
  expect(calls).toContain('DROP sse_drill_b1');
  expect(calls.some((line) => line.startsWith('CLEAR avatars/'))).toBe(true);
  expect(listRestoreRecords(root)[0].status).toBe('deleted');
});
