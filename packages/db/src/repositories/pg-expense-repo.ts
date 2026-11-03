import type { ExpenseReport, ExpenseItem, CreateReportDto } from '@sse/shared';
import type { IExpenseRepo, ExpenseQuery } from '@sse/core';
import { pool } from '../connection';
import type { Queryable } from '../transaction';

const CATEGORY_NAMES_SQL = `COALESCE(
  (SELECT array_agg(DISTINCT ec.name ORDER BY ec.name)
     FROM expense_items ei
     JOIN expense_categories ec ON ec.id = ei.category_id
    WHERE ei.report_id = er.id),
  ARRAY[]::text[]
)`;

function mapReport(row: any): ExpenseReport {
  return {
    id: row.id,
    serialNo: row.serial_no,
    userId: row.user_id,
    applicantName: row.applicant_name ?? undefined,
    title: row.title,
    totalAmount: Number(row.total_amount),
    categoryNames: row.category_names ?? [],
    status: row.status,
    currentStep: row.current_step,
    submittedAt: row.submitted_at ?? undefined,
    completedAt: row.completed_at ?? undefined,
    description: row.description ?? undefined,
    paidAt: row.paid_at ?? undefined,
    paidBy: row.paid_by ?? undefined,
    paymentRef: row.payment_ref ?? undefined,
    paymentComment: row.payment_comment ?? undefined,
    paymentUpdatedAt: row.payment_updated_at ?? undefined,
    paymentUpdatedBy: row.payment_updated_by ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapItem(row: any): ExpenseItem {
  return {
    id: row.id,
    reportId: row.report_id,
    categoryId: row.category_id,
    amount: Number(row.amount),
    expenseDate: row.expense_date,
    description: row.description,
  };
}

export class PgExpenseRepo implements IExpenseRepo {
  async findById(id: string): Promise<ExpenseReport | null> {
    const { rows } = await pool.query(
      'SELECT er.*, u.name AS applicant_name FROM expense_reports er JOIN users u ON u.id = er.user_id WHERE er.id = $1',
      [id]
    );
    return rows.length === 0 ? null : mapReport(rows[0]);
  }

  async findMany(query: ExpenseQuery): Promise<{ results: ExpenseReport[]; total: number }> {
    const conditions: string[] = [];
    const values: any[] = [];
    let idx = 1;

    if (query.dateFrom) { conditions.push(`er.created_at >= $${idx++}`); values.push(query.dateFrom); }
    if (query.dateTo) { conditions.push(`er.created_at <= $${idx++}`); values.push(query.dateTo); }
    if (query.applicantId) { conditions.push(`er.user_id = $${idx++}`); values.push(query.applicantId); }
    if (query.status) { conditions.push(`er.status = $${idx++}`); values.push(query.status); }
    if (query.keyword) {
      conditions.push(`(er.serial_no ILIKE $${idx} OR er.title ILIKE $${idx})`);
      values.push(`%${query.keyword}%`);
      idx++;
    }

    if (query.categoryId || query.amountMin !== undefined || query.amountMax !== undefined) {
      const itemConds: string[] = [];
      if (query.categoryId) { itemConds.push(`ei.category_id = $${idx++}`); values.push(query.categoryId); }
      if (query.amountMin !== undefined) { itemConds.push(`ei.amount >= $${idx++}`); values.push(query.amountMin); }
      if (query.amountMax !== undefined) { itemConds.push(`ei.amount <= $${idx++}`); values.push(query.amountMax); }

      conditions.push(`er.id IN (SELECT ei.report_id FROM expense_items ei WHERE ${itemConds.join(' AND ')})`);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const page = query.page || 1;
    const pageSize = query.pageSize || 20;
    const offset = (page - 1) * pageSize;

    const [dataRes, countRes] = await Promise.all([
      pool.query(
        `SELECT er.*, u.name AS applicant_name, ${CATEGORY_NAMES_SQL} AS category_names
           FROM expense_reports er
           JOIN users u ON u.id = er.user_id
          ${where}
          ORDER BY er.created_at DESC LIMIT $${idx++} OFFSET $${idx++}`,
        [...values, pageSize, offset]
      ),
      pool.query(`SELECT COUNT(*) FROM expense_reports er ${where}`, values),
    ]);

    return {
      results: dataRes.rows.map(mapReport),
      total: parseInt(countRes.rows[0].count, 10),
    };
  }

  async findManyByApprover(approverId: string, page: number, pageSize: number): Promise<{ results: ExpenseReport[]; total: number }> {
    const offset = (page - 1) * pageSize;
    const [dataRes, countRes] = await Promise.all([
      pool.query(
        `SELECT DISTINCT er.*, u.name AS applicant_name, ${CATEGORY_NAMES_SQL} AS category_names
           FROM expense_reports er
           JOIN approval_records ar ON ar.report_id = er.id
           JOIN users u ON u.id = er.user_id
          WHERE ar.approver_id = $1
          ORDER BY er.created_at DESC
          LIMIT $2 OFFSET $3`,
        [approverId, pageSize, offset]
      ),
      pool.query(
        `SELECT COUNT(DISTINCT er.id) FROM expense_reports er
         JOIN approval_records ar ON ar.report_id = er.id
         WHERE ar.approver_id = $1`,
        [approverId]
      ),
    ]);
    return {
      results: dataRes.rows.map(mapReport),
      total: parseInt(countRes.rows[0].count, 10),
    };
  }

  async findManyByUser(userId: string, query: ExpenseQuery): Promise<{ results: ExpenseReport[]; total: number }> {
    const conditions: string[] = [`er.user_id = $1`];
    const values: any[] = [userId];
    let idx = 2;

    if (query.dateFrom) { conditions.push(`er.created_at >= $${idx++}`); values.push(query.dateFrom); }
    if (query.dateTo) { conditions.push(`er.created_at <= $${idx++}`); values.push(query.dateTo); }
    if (query.status) { conditions.push(`er.status = $${idx++}`); values.push(query.status); }
    if (query.keyword) {
      conditions.push(`(er.serial_no ILIKE $${idx} OR er.title ILIKE $${idx})`);
      values.push(`%${query.keyword}%`);
      idx++;
    }

    const where = `WHERE ${conditions.join(' AND ')}`;
    const page = query.page || 1;
    const pageSize = query.pageSize || 20;
    const offset = (page - 1) * pageSize;

    const [dataRes, countRes] = await Promise.all([
      pool.query(
        `SELECT er.*, u.name AS applicant_name, ${CATEGORY_NAMES_SQL} AS category_names
           FROM expense_reports er
           JOIN users u ON u.id = er.user_id
          ${where}
          ORDER BY er.created_at DESC LIMIT $${idx++} OFFSET $${idx++}`,
        [...values, pageSize, offset]
      ),
      pool.query(`SELECT COUNT(*) FROM expense_reports er ${where}`, values),
    ]);

    return {
      results: dataRes.rows.map(mapReport),
      total: parseInt(countRes.rows[0].count, 10),
    };
  }

  async create(dto: CreateReportDto, userId: string, serialNo: string): Promise<ExpenseReport> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const totalAmount: number = dto.items.reduce((sum: number, item) => sum + item.amount, 0);

      const { rows: reportRows } = await client.query(
        `INSERT INTO expense_reports (serial_no, user_id, title, total_amount, description, status, current_step)
         VALUES ($1, $2, $3, $4, $5, 'draft', 0)
         RETURNING *`,
        [serialNo, userId, dto.title, totalAmount, dto.description || null]
      );

      const report = reportRows[0];

      for (const item of dto.items) {
        await client.query(
          `INSERT INTO expense_items (report_id, category_id, amount, expense_date, description)
           VALUES ($1, $2, $3, $4, $5)`,
          [report.id, item.categoryId, item.amount, item.expenseDate, item.description]
        );
      }

      await client.query('COMMIT');
      return mapReport(report);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async updateStatus(id: string, status: string, currentStep?: number): Promise<void> {
    if (currentStep !== undefined) {
      await pool.query(
        `UPDATE expense_reports SET status = $1, current_step = $2, updated_at = NOW() WHERE id = $3`,
        [status, currentStep, id]
      );
    } else {
      await pool.query(
        `UPDATE expense_reports SET status = $1, updated_at = NOW() WHERE id = $2`,
        [status, id]
      );
    }
  }

  async getStatistics(dateFrom?: string, dateTo?: string, department?: string): Promise<any> {
    const conditions: string[] = [];
    const values: any[] = [];
    let idx = 1;

    if (dateFrom) { conditions.push(`er.created_at >= $${idx++}`); values.push(dateFrom); }
    if (dateTo) { conditions.push(`er.created_at <= $${idx++}`); values.push(dateTo); }
    if (department) { conditions.push(`u.department = $${idx++}`); values.push(department); }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const { rows } = await pool.query(
      `SELECT
         COALESCE(SUM(er.total_amount), 0) as total_amount,
         COUNT(*) as total_count,
         COUNT(*) FILTER (WHERE er.status = 'approved') as approved_count,
         COUNT(*) FILTER (WHERE er.status = 'rejected') as rejected_count,
         COUNT(*) FILTER (WHERE er.status = 'pending') as pending_count
       FROM expense_reports er
       ${department ? 'JOIN users u ON u.id = er.user_id' : ''}
       ${where}`,
      values
    );

    return rows[0];
  }

  async markPaid(
    id: string,
    paidBy: string,
    paymentRef?: string,
    paymentComment?: string,
    db: Queryable = pool
  ): Promise<boolean> {
    const { rows } = await db.query(
      `UPDATE expense_reports
          SET status = $1,
              paid_at = NOW(),
              paid_by = $2,
              payment_ref = $3,
              payment_comment = $4,
              updated_at = NOW()
        WHERE id = $5 AND status = 'approved'
        RETURNING id`,
      ['paid', paidBy, paymentRef || null, paymentComment || null, id]
    );
    return rows.length > 0;
  }

  async updatePayment(
    id: string,
    input: { paymentRef?: string | null; paymentComment?: string | null; updatedBy: string },
    db: Queryable = pool
  ): Promise<boolean> {
    const { rows } = await db.query(
      `UPDATE expense_reports
          SET payment_ref = $2,
              payment_comment = $3,
              payment_updated_at = NOW(),
              payment_updated_by = $4,
              updated_at = NOW()
        WHERE id = $1 AND status = 'paid'
        RETURNING id`,
      [id, input.paymentRef ?? null, input.paymentComment ?? null, input.updatedBy]
    );
    return rows.length > 0;
  }

  async revertPayment(id: string, updatedBy: string, db: Queryable = pool): Promise<boolean> {
    const { rows } = await db.query(
      `UPDATE expense_reports
          SET status = 'approved',
              paid_at = NULL,
              paid_by = NULL,
              payment_ref = NULL,
              payment_comment = NULL,
              payment_updated_at = NOW(),
              payment_updated_by = $2,
              updated_at = NOW()
        WHERE id = $1 AND status = 'paid'
        RETURNING id`,
      [id, updatedBy]
    );
    return rows.length > 0;
  }

  async getUserSummary(userId: string, dateFrom?: string, dateTo?: string): Promise<any> {
    const conditions: string[] = ['er.user_id = $1'];
    const values: any[] = [userId];
    let idx = 2;

    if (dateFrom) { conditions.push(`er.created_at >= $${idx++}`); values.push(dateFrom); }
    if (dateTo) { conditions.push(`er.created_at <= $${idx++}`); values.push(dateTo); }

    const where = `WHERE ${conditions.join(' AND ')}`;

    const { rows } = await pool.query(
      `SELECT
         COALESCE(SUM(er.total_amount), 0) as total_amount,
         COUNT(*) as total_count,
         COUNT(*) FILTER (WHERE er.status = 'approved') as approved_count,
         COUNT(*) FILTER (WHERE er.status = 'rejected') as rejected_count,
         COUNT(*) FILTER (WHERE er.status = 'pending') as pending_count,
         COUNT(*) FILTER (WHERE er.status = 'draft') as draft_count
       FROM expense_reports er
       ${where}`,
      values
    );

    return rows[0];
  }
}
