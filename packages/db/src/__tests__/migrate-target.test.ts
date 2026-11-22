import { applyMigrations } from '../migrate';

test('applyMigrations uses an injected client and records versions', async () => {
  const calls: Array<[string, any[]?]> = [];
  const client = {
    query: jest.fn(async (sql: string, params?: any[]) => {
      calls.push([sql, params]);
      if (sql.includes('SELECT version')) return { rows: [] };
      return { rows: [] };
    }),
  };

  const applied = await applyMigrations(client as any, ['001_initial.sql']);

  expect(applied).toEqual(['001_initial']);
  expect(calls[0][0]).toContain('CREATE TABLE IF NOT EXISTS schema_migrations');
  expect(calls.some(([sql]) => sql === 'BEGIN')).toBe(true);
  expect(calls.some(([sql]) => sql === 'COMMIT')).toBe(true);
  expect(calls.some(([sql, params]) => sql.includes('INSERT INTO schema_migrations') && params?.[0] === '001_initial')).toBe(true);
});
