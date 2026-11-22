import { validateTargetDatabase, ensureTargetDatabase, dropTargetDatabase } from '../db/target';

test('rejects the live database and invalid identifiers', () => {
  expect(() => validateTargetDatabase('sse', 'sse')).toThrow('TARGET_IS_LIVE_DB');
  expect(() => validateTargetDatabase('sse; DROP', 'sse')).toThrow('INVALID_TARGET_DB');
});

test('creates and drops a drill database', async () => {
  const queries: string[] = [];
  const admin = {
    query: jest.fn(async (sql: string) => {
      queries.push(sql);
      return { rows: [] };
    }),
  };
  await ensureTargetDatabase(admin as any, 'sse_drill_1');
  expect(queries.some((sql) => sql.includes('CREATE DATABASE "sse_drill_1"'))).toBe(true);
  await dropTargetDatabase(admin as any, 'sse_drill_1');
  expect(queries.some((sql) => sql.includes('DROP DATABASE IF EXISTS "sse_drill_1"'))).toBe(true);
});
