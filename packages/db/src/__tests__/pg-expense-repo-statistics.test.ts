const mockQuery = jest.fn();

jest.mock('../connection', () => ({
  pool: { query: (...args: any[]) => mockQuery(...args) },
}));

import { PgExpenseRepo } from '../repositories/pg-expense-repo';

beforeEach(() => {
  mockQuery.mockReset();
  mockQuery.mockResolvedValue({
    rows: [
      {
        total_amount: '0',
        total_count: '0',
        approved_count: '0',
        rejected_count: '0',
        pending_count: '0',
      },
    ],
  });
});

describe('PgExpenseRepo.getStatistics', () => {
  it('filters by user without joining users', async () => {
    await new PgExpenseRepo().getStatistics(undefined, undefined, undefined, 'u1');

    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain('er.user_id = $1');
    expect(sql).not.toContain('JOIN users');
    expect(params).toEqual(['u1']);
  });

  it('filters by department with a users join', async () => {
    await new PgExpenseRepo().getStatistics(
      '2026-01-01',
      '2026-12-31',
      '技术部',
      'u1'
    );

    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain('JOIN users u ON u.id = er.user_id');
    expect(sql).toContain('u.department = $3');
    expect(params).toEqual(['2026-01-01', '2026-12-31', '技术部', 'u1']);
  });
});
