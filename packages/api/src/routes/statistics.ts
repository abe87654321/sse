import { Router, Request, Response, NextFunction } from 'express';
import { auditFromRequest } from '../services/audit';
import { PgExpenseRepo, pool } from '@sse/db';
import { authMiddleware, resolveDataScope } from '@sse/auth';
import {
  SPENDING_STATUSES,
  buildStatisticsPredicate,
  resolveStatisticsFilter,
  statisticsScopeLabel,
} from '@sse/core';
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

function resolveScope(req: Request) {
  const scope = resolveDataScope({
    role: req.user!.role,
    userId: req.user!.userId,
    department: req.user!.department,
  });
  if (scope.kind === 'deny') {
    throw new AppError(403, 'UNAUTHORIZED', '当前角色无权查看统计');
  }
  return scope;
}

router.use(authMiddleware);

router.get(
  '/',
  asyncWrap(async (req, res) => {
    const scope = resolveScope(req);
    const filter = resolveStatisticsFilter(scope, req.query);
    const spending = buildStatisticsPredicate(filter, {
      statuses: SPENDING_STATUSES,
    });
    const userJoin = spending.needsUserJoin
      ? 'JOIN users u ON u.id = er.user_id'
      : '';

    const stats = await expenseRepo.getStatistics(
      filter.dateFrom,
      filter.dateTo,
      filter.department,
      filter.userId
    );

    const { rows: categoryStats } = await pool.query(
      `SELECT COALESCE(ec.name, '未分类') as category,
              COALESCE(SUM(ei.amount), 0) as total_amount,
              COUNT(DISTINCT ei.report_id) as report_count
       FROM expense_items ei
       JOIN expense_reports er ON er.id = ei.report_id
       LEFT JOIN expense_categories ec ON ec.id = ei.category_id
       ${userJoin}
       ${spending.where}
       GROUP BY COALESCE(ec.name, '未分类')
       ORDER BY total_amount DESC`,
      spending.params
    );

    const { rows: deptStats } = await pool.query(
      `SELECT COALESCE(d.name, '未分配') as department,
              COALESCE(SUM(er.total_amount), 0) as total_amount,
              COUNT(*) as report_count,
              COUNT(*) as approved_count
       FROM expense_reports er
       LEFT JOIN users u ON u.id = er.user_id
       LEFT JOIN departments d ON d.id = u.department_id
       ${spending.where}
       GROUP BY COALESCE(d.name, '未分配')
       ORDER BY total_amount DESC`,
      spending.params
    );

    const { rows: monthlyStats } = await pool.query(
      `SELECT month, total_amount, report_count
       FROM (
         SELECT TO_CHAR(er.created_at, 'YYYY-MM') as month,
                COALESCE(SUM(er.total_amount), 0) as total_amount,
                COUNT(*) as report_count
         FROM expense_reports er
         ${userJoin}
         ${spending.where}
         GROUP BY month
         ORDER BY month DESC
         LIMIT 12
       ) recent_months
       ORDER BY month ASC`,
      spending.params
    );

    res.json({
      scope: scope.kind,
      scopeLabel: statisticsScopeLabel(scope),
      overview: {
        totalAmount: Number(stats.total_amount),
        totalCount: Number(stats.total_count),
        approvedCount: Number(stats.approved_count),
        rejectedCount: Number(stats.rejected_count),
        pendingCount: Number(stats.pending_count),
        draftCount: Number(stats.draft_count),
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
    const scope = resolveScope(req);
    const filter = resolveStatisticsFilter(scope, req.query);
    const predicate = buildStatisticsPredicate(filter);

    const { rows } = await pool.query(
      `SELECT er.serial_no, er.title, u.name as applicant, d.name AS department,
              er.total_amount, er.status, er.created_at, er.submitted_at, er.completed_at
       FROM expense_reports er
       JOIN users u ON u.id = er.user_id
       JOIN departments d ON d.id = u.department_id
       ${predicate.where}
       ORDER BY er.created_at DESC`,
      predicate.params
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
