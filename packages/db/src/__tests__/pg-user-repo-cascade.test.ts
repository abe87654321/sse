const mockConnect = jest.fn();

jest.mock('../connection', () => ({
  pool: { connect: (...args: any[]) => mockConnect(...args) },
}));

import { PgUserRepo } from '../repositories/pg-user-repo';

describe('PgUserRepo.cascadeDelete', () => {
  it('marks the transaction as an explicit destructive delete before removing data', async () => {
    const queries: string[] = [];
    const client = {
      query: jest.fn(async (sql: string) => {
        queries.push(sql);
        return { rows: [] };
      }),
      release: jest.fn(),
    };
    mockConnect.mockResolvedValue(client);

    await new PgUserRepo().cascadeDelete('user-1');

    expect(queries.slice(0, 2)).toEqual([
      'BEGIN',
      "SET LOCAL sse.allow_destructive_delete = 'on'",
    ]);
    expect(queries).toContain('COMMIT');
    expect(queries.some((sql) => sql.includes('DELETE FROM expense_reports'))).toBe(true);
    expect(queries.some((sql) => sql.includes('DELETE FROM users'))).toBe(true);
    expect(client.release).toHaveBeenCalledTimes(1);
  });
});
