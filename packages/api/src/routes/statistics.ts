import { Router, Request, Response, NextFunction } from 'express';
import { auditFromRequest } from '../services/audit';
import { PgExpenseRepo, pool } from '@sse/db';
import { authMiddleware, resolveDataScope } from '@sse/auth';
import type { DataScope } from '@sse/auth';
import { UserRole } from '@sse/shared';
import { requireRole } from '../middleware/rbac';
import { AppError } from '../middleware/error';

const router = Router();
const expenseRepo = new PgExpenseRepo();

function asyncWrap(fn: (req: Request, res: Response, next: NextFunction) => Promise<void>) {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

type StatisticsFilter = {
  dateFrom?: string;
  dateTo?: string;
  department?: string;
  userId?: string;
};

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function buildStatisticsFilter(
  scope: DataScope,
  query: Request['query']
): StatisticsFilter {
  if (scope.kind === 'deny') {
    throw new AppError(403, 'UNAUTHORIZED', '当前角色无权查看统计');
  }

  const dateFrom = readString(query.dateFrom);
  const dateTo = readString(query.dateTo);

  if (scope.kind === 'self') {
    return { userId: scope.userId, dateFrom, dateTo };
  }
  if (scope.kind === 'department') {
    return { department: scope.department, dateFrom, dateTo };
  }
  return { department: readString(query.department), dateFrom, dateTo };
}

function buildReportFilter(filter: StatisticsFilter): {
  where: string;
  values: any[];
  needsUserJoin: boolean;
} {
  const conditions: string[] = [];
  const values: any[] = [];
  let idx = 1;

  if (filter.userId) {
    conditions.push(`er.user_id = $${idx++}`);
    values.push(filter.userId);
  }
  if (filter.department) {
    conditions.push(`u.department = $${idx++}`);
    values.push(filter.department);
  }
  if (filter.dateFrom) {
    conditions.push(`er.created_at >= $${idx++}`);
    values.push(filter.dateFrom);
  }
  if (filter.dateTo) {
    conditions.push(`er.created_at <= $${idx++}`);
    values.push(filter.dateTo);
  }

  return {
    where: conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '',
    values,
    needsUserJoin: Boolean(filter.department),
  };
}

function scopeLabel(scope: DataScope): string {
  if (scope.kind === 'self') return '本人';
  if (scope.kind === 'department') return scope.department;
  if (scope.kind === 'all') return '全公司';
  return '无权限';
}

router.use(authMiddleware);

router.get(
  '/',
  asyncWrap(async (req, res) => {
    const scope = resolveDataScope({
      role: req.user!.role,
      userId: req.user!.userId,
      department: req.user!.department,
    });
    const filter = buildStatisticsFilter(scope, req.query);
    const { where, values, needsUserJoin } = buildReportFilter(filter);
    const userJoin = needsUserJoin ? 'JOIN users u ON u.id = er.user_id' : '';

    const stats = await expenseRepo.getStatistics(
      filter.dateFrom,
      filter.dateTo,
      filter.department,
      filter.userId
    );

    const { rows: categoryStats } = await pool.query(
      `SELECT ec.name as category, COALESCE(SUM(ei.amount), 0) as total_amount, COUNT(DISTINCT ei.report_id) as report_count
       FROM expense_items ei
       JOIN expense_reports er ON er.id = ei.report_id
       LEFT JOIN expense_categories ec ON ec.id = ei.category_id
       ${userJoin}
       ${where}
       GROUP BY ec.name
       ORDER BY total_amount DESC`,
      values
    );

    const { rows: deptStats } = await pool.query(
      `SELECT u.department, COALESCE(SUM(er.total_amount), 0) as total_amount,
              COUNT(*) as report_count,
              COUNT(*) FILTER (WHERE er.status = 'approved') as approved_count
       FROM expense_reports er
       JOIN users u ON u.id = er.user_id
       ${where}
       GROUP BY u.department
       ORDER BY total_amount DESC`,
      values
    );

    const { rows: monthlyStats } = await pool.query(
      `SELECT month, total_amount, report_count
       FROM (
         SELECT TO_CHAR(er.created_at, 'YYYY-MM') as month,
                COALESCE(SUM(er.total_amount), 0) as total_amount,
                COUNT(*) as report_count
         FROM expense_reports er
         ${userJoin}
         ${where}
         GROUP BY month
         ORDER BY month DESC
         LIMIT 12
       ) recent_months
       ORDER BY month ASC`,
      values
    );

    res.json({
      scope: scope.kind,
      scopeLabel: scopeLabel(scope),
      overview: {
        totalAmount: Number(stats.total_amount),
        totalCount: Number(stats.total_count),
        approvedCount: Number(stats.approved_count),
        rejectedCount: Number(stats.rejected_count),
        pendingCount: Number(stats.pending_count),
      },
      byCategory: categoryStats.map((r: any) => ({
        category: r.category || '未分类',
        totalAmount: Number(r.total_amount),
        reportCount: Number(r.report_count),
      })),
      byDepartment: deptStats.map((r: any) => ({
        department: r.department,
        totalAmount: Number(r.total_amount),
        reportCount: Number(r.report_count),
        approvedCount: Number(r.approved_count),
      })),
      monthly: monthlyStats.map((r: any) => ({
        month: r.month,
        totalAmount: Number(r.total_amount),
        reportCount: Number(r.report_count),
      })),
    });
  })
);

router.get(
  '/export',
  requireRole(UserRole.FINANCE, UserRole.ADMIN),
  asyncWrap(async (req, res) => {
    const scope = resolveDataScope({
      role: req.user!.role,
      userId: req.user!.userId,
      department: req.user!.department,
    });
    const filter = buildStatisticsFilter(scope, req.query);
    const { where, values } = buildReportFilter(filter);

    const { rows } = await pool.query(
      `SELECT er.serial_no, er.title, u.name as applicant, u.department,
              er.total_amount, er.status, er.created_at, er.submitted_at, er.completed_at
       FROM expense_reports er
       JOIN users u ON u.id = er.user_id
       ${where}
       ORDER BY er.created_at DESC`,
      values
    );

    await auditFromRequest(req, {
      source: 'api',
      action: 'statistics.export',
      entityType: 'statistics',
      outcome: 'success',
      details: {
        format: req.query.format === 'csv' || req.headers.accept?.includes('text/csv') ? 'csv' : 'json',
        scope: scope.kind,
        dateFrom: filter.dateFrom || null,
        dateTo: filter.dateTo || null,
        rows: rows.length,
      },
    });

    if (req.query.format === 'csv' || req.headers.accept?.includes('text/csv')) {
      const headers = ['编号', '标题', '申请人', '部门', '金额', '状态', '创建时间', '提交时间', '完成时间'];
      const csvRows = [headers.join(',')];

      for (const row of rows) {
        csvRows.push(
          [
            row.serial_no,
            `"${(row.title || '').replace(/"/g, '""')}"`,
            row.applicant,
            row.department,
            row.total_amount,
            row.status,
            row.created_at,
            row.submitted_at || '',
            row.completed_at || '',
          ].join(',')
        );
      }

      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="expenses_${filter.dateFrom || 'all'}_${filter.dateTo || 'all'}.csv"`
      );
      res.send('\uFEFF' + csvRows.join('\n'));
    } else {
      res.json({
        total: rows.length,
        items: rows.map((r: any) => ({
          serialNo: r.serial_no,
          title: r.title,
          applicant: r.applicant,
          department: r.department,
          totalAmount: Number(r.total_amount),
          status: r.status,
          createdAt: r.created_at,
          submittedAt: r.submitted_at,
          completedAt: r.completed_at,
        })),
      });
    }
  })
);

export { router as statisticsRoutes };
