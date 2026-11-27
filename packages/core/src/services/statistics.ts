export const SPENDING_STATUSES = ['approved', 'paid'] as const;

export type StatisticsScope =
  | { kind: 'all' }
  | { kind: 'department'; department: string }
  | { kind: 'departments'; departments: string[] }
  | { kind: 'self'; userId: string };

export interface StatisticsQuery {
  dateFrom?: unknown;
  dateTo?: unknown;
  department?: unknown;
}

export interface StatisticsFilter {
  dateFrom?: string;
  dateTo?: string;
  department?: string;
  departments?: string[];
  userId?: string;
}

export interface StatisticsPredicate {
  where: string;
  params: any[];
  needsUserJoin: boolean;
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

export function resolveStatisticsFilter(
  scope: StatisticsScope,
  query: StatisticsQuery
): StatisticsFilter {
  const dateFrom = readString(query.dateFrom);
  const dateTo = readString(query.dateTo);

  if (scope.kind === 'self') {
    return { userId: scope.userId, dateFrom, dateTo };
  }
  if (scope.kind === 'department') {
    return { department: scope.department, dateFrom, dateTo };
  }
  if (scope.kind === 'departments') {
    return { departments: scope.departments, dateFrom, dateTo };
  }
  return { department: readString(query.department), dateFrom, dateTo };
}

export function buildStatisticsPredicate(
  filter: StatisticsFilter,
  options: { statuses?: readonly string[] } = {}
): StatisticsPredicate {
  const conditions: string[] = [];
  const params: any[] = [];
  let idx = 1;

  if (filter.userId) {
    conditions.push(`er.user_id = $${idx++}`);
    params.push(filter.userId);
  }
  if (filter.department) {
    conditions.push(
      `u.department_id = (SELECT id FROM departments WHERE name = $${idx++})`
    );
    params.push(filter.department);
  }
  if (filter.departments && filter.departments.length > 0) {
    conditions.push(
      `u.department_id IN (SELECT id FROM departments WHERE name = ANY($${idx++}))`
    );
    params.push(filter.departments);
  }
  if (filter.dateFrom) {
    conditions.push(`er.created_at >= $${idx++}::date`);
    params.push(filter.dateFrom);
  }
  if (filter.dateTo) {
    conditions.push(`er.created_at < ($${idx++}::date + INTERVAL '1 day')`);
    params.push(filter.dateTo);
  }
  if (options.statuses && options.statuses.length > 0) {
    conditions.push(`er.status = ANY($${idx++})`);
    params.push(options.statuses);
  }

  return {
    where: conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '',
    params,
    needsUserJoin: Boolean(filter.department || (filter.departments && filter.departments.length > 0)),
  };
}

export function statisticsScopeLabel(scope: StatisticsScope): string {
  if (scope.kind === 'self') return '本人';
  if (scope.kind === 'department') return scope.department;
  if (scope.kind === 'departments') return scope.departments.join('、');
  return '全公司';
}
