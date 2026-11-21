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
        draft_count: '0',
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
    expect(sql).toContain('LEFT JOIN users u ON u.id = er.user_id');
    expect(sql).toContain('er.user_id = $1');
    expect(sql).toContain('u.department = $2');
    expect(sql).toContain('er.created_at >= $3::date');
    expect(sql).toContain("er.created_at < ($4::date + INTERVAL '1 day')");
    expect(params).toEqual(['u1', '技术部', '2026-01-01', '2026-12-31']);
  });

  it('counts spending, rejected, pending and draft reports separately', async () => {
    await new PgExpenseRepo().getStatistics();

    const [sql] = mockQuery.mock.calls[0];
    expect(sql).toContain(
      "COALESCE(SUM(er.total_amount) FILTER (WHERE er.status IN ('approved', 'paid')), 0) as total_amount"
    );
    expect(sql).toContain(
      "COUNT(*) FILTER (WHERE er.status IN ('approved', 'paid')) as total_count"
    );
    expect(sql).toContain(
      "COUNT(*) FILTER (WHERE er.status IN ('approved', 'paid')) as approved_count"
    );
    expect(sql).toContain(
      "COUNT(*) FILTER (WHERE er.status = 'rejected') as rejected_count"
    );
    expect(sql).toContain(
      "COUNT(*) FILTER (WHERE er.status = 'pending') as pending_count"
    );
    expect(sql).toContain(
      "COUNT(*) FILTER (WHERE er.status = 'draft') as draft_count"
    );
  });
});
