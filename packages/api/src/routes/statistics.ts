import { Router, Request, Response, NextFunction } from 'express';
import { PgExpenseRepo, pool } from '@sse/db';
import { authMiddleware } from '@sse/auth';
import { requireRole } from '../middleware/rbac';
import { UserRole } from '@sse/shared';

const router = Router();
const expenseRepo = new PgExpenseRepo();

function asyncWrap(fn: (req: Request, res: Response, next: NextFunction) => Promise<void>) {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

router.use(authMiddleware);
router.use(requireRole(UserRole.FINANCE, UserRole.ADMIN));

router.get(
  '/',
  asyncWrap(async (req, res) => {
    const { dateFrom, dateTo, department } = req.query;

    const stats = await expenseRepo.getStatistics(
      dateFrom as string | undefined,
      dateTo as string | undefined,
      department as string | undefined
    );

    const { rows: categoryStats } = await pool.query(
      `SELECT ec.name as category, COALESCE(SUM(ei.amount), 0) as total_amount, COUNT(DISTINCT ei.report_id) as report_count
       FROM expense_items ei
       JOIN expense_reports er ON er.id = ei.report_id
       LEFT JOIN expense_categories ec ON ec.id = ei.category_id
       WHERE 1=1
       GROUP BY ec.name
       ORDER BY total_amount DESC`
    );

    const { rows: deptStats } = await pool.query(
      `SELECT u.department, COALESCE(SUM(er.total_amount), 0) as total_amount,
              COUNT(*) as report_count,
              COUNT(*) FILTER (WHERE er.status = 'approved') as approved_count
       FROM expense_reports er
       JOIN users u ON u.id = er.user_id
       GROUP BY u.department
       ORDER BY total_amount DESC`
    );

    res.json({
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
    });
  })
);

router.get(
  '/export',
  asyncWrap(async (req, res) => {
    const { dateFrom, dateTo } = req.query;

    const { rows } = await pool.query(
      `SELECT er.serial_no, er.title, u.name as applicant, u.department,
              er.total_amount, er.status, er.created_at, er.submitted_at, er.completed_at
       FROM expense_reports er
       JOIN users u ON u.id = er.user_id
       WHERE ($1::text IS NULL OR er.created_at >= $1::timestamptz)
         AND ($2::text IS NULL OR er.created_at <= $2::timestamptz)
       ORDER BY er.created_at DESC`,
      [dateFrom || null, dateTo || null]
    );

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
        `attachment; filename="expenses_${dateFrom || 'all'}_${dateTo || 'all'}.csv"`
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
