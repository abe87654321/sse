import { mkdtempSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { exportDatabase } from '../db/export';

function fakeClient(rows: any[]) {
  return {
    query: jest.fn(async (sql: string) => {
      if (sql.includes('information_schema.columns')) {
        return {
          rows: [
            { table_name: 'users', column_name: 'id', ordinal_position: 1, data_type: 'uuid', udt_name: 'uuid', is_nullable: 'NO', column_default: null },
            { table_name: 'users', column_name: 'name', ordinal_position: 2, data_type: 'text', udt_name: 'text', is_nullable: 'YES', column_default: null },
          ],
        };
      }
      if (sql.includes('information_schema.tables')) return { rows: [{ table_name: 'users' }] };
      if (sql.includes('schema_migrations')) return { rows: [{ version: '024_verification_history' }] };
      if (sql.includes('COUNT(*)')) return { rows: [{ c: String(rows.length) }] };
      if (sql.includes('server_version')) return { rows: [{ server_version: '16.4' }] };
      return { rows: [] };
    }),
    cursorFactory: () => {
      let offset = 0;
      return {
        read: async (n: number) => {
          const batch = rows.slice(offset, offset + n).map((row) => ({ line: JSON.stringify(row) }));
          offset += batch.length;
          return batch;
        },
        close: async () => undefined,
      };
    },
  };
}

test('exports one JSONL file per table in a repeatable-read transaction', async () => {
  const out = mkdtempSync(join(tmpdir(), 'sse-db-export-'));
  const client = fakeClient([{ id: 'u1', name: null }, { id: 'u2', name: '' }]);
  const result = await exportDatabase(client as any, out);
  expect(result.schema.schemaVersion).toBe('024_verification_history');
  expect(result.tables[0]).toMatchObject({ name: 'users', rows: 2 });
  expect(readFileSync(join(out, 'users.jsonl'), 'utf-8')).toBe(
    '{"id":"u1","name":null}\n{"id":"u2","name":""}\n'
  );
});

test('rolls back on row count mismatch', async () => {
  const out = mkdtempSync(join(tmpdir(), 'sse-db-export-'));
  const client = fakeClient([{ id: 'u1' }]);
  client.cursorFactory = () => ({ read: async () => [], close: async () => undefined });
  await expect(exportDatabase(client as any, out)).rejects.toThrow('ROW_COUNT_MISMATCH');
});
