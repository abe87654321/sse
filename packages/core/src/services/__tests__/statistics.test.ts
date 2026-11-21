import {
  SPENDING_STATUSES,
  buildStatisticsPredicate,
  resolveStatisticsFilter,
  statisticsScopeLabel,
} from '../statistics';

describe('resolveStatisticsFilter', () => {
  it('scopes employees to their own reports and ignores a department filter', () => {
    const filter = resolveStatisticsFilter(
      { kind: 'self', userId: 'u-emp' },
      { department: '市场部', dateFrom: '2026-11-01', dateTo: '  ' }
    );

    expect(filter).toEqual({
      userId: 'u-emp',
      department: undefined,
      dateFrom: '2026-11-01',
      dateTo: undefined,
    });
  });

  it('forces department approvers to their own department', () => {
    const filter = resolveStatisticsFilter(
      { kind: 'department', department: '技术部' },
      { department: '市场部' }
    );

    expect(filter).toEqual({
      userId: undefined,
      department: '技术部',
      dateFrom: undefined,
      dateTo: undefined,
    });
  });

  it('lets all-company viewers choose a department', () => {
    const filter = resolveStatisticsFilter(
      { kind: 'all' },
      { department: '市场部' }
    );

    expect(filter).toEqual({
      userId: undefined,
      department: '市场部',
      dateFrom: undefined,
      dateTo: undefined,
    });
  });
});

describe('buildStatisticsPredicate', () => {
  it('treats dateTo as an inclusive day via an exclusive next-day bound', () => {
    const { where, params } = buildStatisticsPredicate({
      dateFrom: '2026-11-01',
      dateTo: '2026-11-30',
    });

    expect(where).toContain('er.created_at >= $1::date');
    expect(where).toContain("er.created_at < ($2::date + INTERVAL '1 day')");
    expect(params).toEqual(['2026-11-01', '2026-11-30']);
  });

  it('can restrict to the spending statuses used by every aggregate', () => {
    const { where, params } = buildStatisticsPredicate(
      { userId: 'u-emp' },
      { statuses: SPENDING_STATUSES }
    );

    expect(SPENDING_STATUSES).toEqual(['approved', 'paid']);
    expect(where).toContain('er.user_id = $1');
    expect(where).toContain('er.status = ANY($2)');
    expect(params).toEqual(['u-emp', ['approved', 'paid']]);
  });

  it('asks for the users join only when a department filter is applied', () => {
    expect(buildStatisticsPredicate({ userId: 'u1' }).needsUserJoin).toBe(false);
    expect(buildStatisticsPredicate({ department: '技术部' }).needsUserJoin).toBe(
      true
    );
  });
});

describe('statisticsScopeLabel', () => {
  it('labels each scope consistently across API and MCP', () => {
    expect(statisticsScopeLabel({ kind: 'self', userId: 'u1' })).toBe('本人');
    expect(statisticsScopeLabel({ kind: 'department', department: '技术部' })).toBe(
      '技术部'
    );
    expect(statisticsScopeLabel({ kind: 'all' })).toBe('全公司');
  });
});
