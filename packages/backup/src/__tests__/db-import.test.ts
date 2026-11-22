import { mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { planImport, importPackageTables } from '../db/import';

const source = {
  schemaVersion: '024',
  serverVersion: '16',
  tables: [{
    name: 'users',
    columns: [
      { name: 'id', ordinal: 1, dataType: 'uuid', udtName: 'uuid', nullable: false, default: null },
      { name: 'legacy', ordinal: 2, dataType: 'text', udtName: 'text', nullable: true, default: null },
    ],
  }],
};
const target = {
  schemaVersion: '024',
  serverVersion: '16',
  tables: [{
    name: 'users',
    columns: [
      { name: 'id', ordinal: 1, dataType: 'uuid', udtName: 'uuid', nullable: false, default: null },
      { name: 'status', ordinal: 2, dataType: 'text', udtName: 'text', nullable: false, default: "'active'" },
    ],
  }],
};

test('drops source-only columns and lets target defaults fill missing columns', () => {
  expect(planImport(source as any, target as any).tables[0]).toEqual({
    name: 'users',
    columns: ['id'],
    skippedColumns: ['legacy'],
  });
});

test('fails when a required target column is missing from the backup', () => {
  const bad = {
    ...target,
    tables: [{
      name: 'users',
      columns: [
        ...target.tables[0].columns,
        { name: 'required', ordinal: 3, dataType: 'text', udtName: 'text', nullable: false, default: null },
      ],
    }],
  };
  expect(() => planImport(source as any, bad as any)).toThrow('MISSING_REQUIRED_COLUMN');
});

test('imports JSONL batches without parsing numbers in JS', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'sse-import-'));
  writeFileSync(join(dir, 'users.jsonl'), '{"id":"u1","big":9007199254740993}\n');
  const client = { query: jest.fn(async (_sql: string, _params?: any[]) => ({ rows: [] })) };
  await importPackageTables(client as any, dir, [
    { name: 'users', columns: ['id', 'big'], skippedColumns: [] },
  ]);
  const insert = client.query.mock.calls.find(([sql]) => String(sql).includes('json_populate_recordset'));
  const params = insert?.[1] as any[] | undefined;
  expect(params?.[0]).toContain('9007199254740993');
});
