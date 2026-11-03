import type { PaymentAuditAction, PaymentAuditLog } from '@sse/shared';
import { pool } from '../connection';
import type { Queryable } from '../transaction';

export type CreatePaymentAuditInput = {
  reportId: string;
  action: PaymentAuditAction;
  operatorId?: string;
  reason?: string;
  before?: unknown;
  after?: unknown;
};

function mapAudit(row: any): PaymentAuditLog {
  return {
    id: row.id,
    reportId: row.report_id,
    action: row.action as PaymentAuditAction,
    operatorId: row.operator_id ?? undefined,
    operatorName: row.operator_name ?? undefined,
    reason: row.reason ?? undefined,
    before: row.before ?? undefined,
    after: row.after ?? undefined,
    createdAt: row.created_at,
  };
}

export class PgPaymentAuditRepo {
  async create(input: CreatePaymentAuditInput, db: Queryable = pool): Promise<PaymentAuditLog> {
    const { rows } = await db.query(
      `INSERT INTO payment_audit_logs (report_id, action, operator_id, reason, before, after)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [
        input.reportId,
        input.action,
        input.operatorId ?? null,
        input.reason ?? null,
        input.before !== undefined ? JSON.stringify(input.before) : null,
        input.after !== undefined ? JSON.stringify(input.after) : null,
      ]
    );
    return mapAudit(rows[0]);
  }

  async findByReportId(reportId: string): Promise<PaymentAuditLog[]> {
    const { rows } = await pool.query(
      `SELECT pal.*, u.name AS operator_name
         FROM payment_audit_logs pal
         LEFT JOIN users u ON u.id = pal.operator_id
        WHERE pal.report_id = $1
        ORDER BY pal.created_at DESC`,
      [reportId]
    );
    return rows.map(mapAudit);
  }
}
