import type { ApprovalRecord } from '@sse/shared';
import type { IApprovalRecordRepo } from '@sse/core';
import { pool } from '../connection';

function mapRecord(row: any): ApprovalRecord {
  return {
    id: row.id,
    reportId: row.report_id,
    step: row.step,
    approverId: row.approver_id,
    stepStartedAt: row.step_started_at,
    result: row.result,
    comment: row.comment ?? undefined,
    approvedAt: row.approved_at ?? undefined,
    reminderSentAt: row.reminder_sent_at ?? undefined,
    escalatedAt: row.escalated_at ?? undefined,
  };
}

export class PgApprovalRecordRepo implements IApprovalRecordRepo {
  async findByReportId(reportId: string): Promise<ApprovalRecord[]> {
    const { rows } = await pool.query(
      'SELECT * FROM approval_records WHERE report_id = $1 ORDER BY step ASC',
      [reportId]
    );
    return rows.map(mapRecord);
  }

  async findPendingOverdue(): Promise<ApprovalRecord[]> {
    const { rows } = await pool.query(
      `SELECT ar.* FROM approval_records ar
       JOIN approval_rules arule ON arule.is_active = true
       WHERE ar.result = 'pending'
         AND ar.step_started_at < NOW() - INTERVAL '24 hours'`
    );
    return rows.map(mapRecord);
  }

  async create(record: Omit<ApprovalRecord, 'id'>): Promise<ApprovalRecord> {
    const { rows } = await pool.query(
      `INSERT INTO approval_records (report_id, step, approver_id, step_started_at, result, comment)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [
        record.reportId,
        record.step,
        record.approverId,
        record.stepStartedAt,
        record.result,
        record.comment ?? null,
      ]
    );
    return mapRecord(rows[0]);
  }

  async updateResult(id: string, result: string, comment?: string): Promise<void> {
    await pool.query(
      `UPDATE approval_records SET result = $1, comment = $2, approved_at = CASE WHEN $1 IN ('approved', 'rejected') THEN NOW() ELSE approved_at END
       WHERE id = $3`,
      [result, comment ?? null, id]
    );
  }

  async markReminderSent(id: string): Promise<void> {
    await pool.query(
      'UPDATE approval_records SET reminder_sent_at = NOW() WHERE id = $1',
      [id]
    );
  }

  async markEscalated(id: string): Promise<void> {
    await pool.query(
      'UPDATE approval_records SET escalated_at = NOW() WHERE id = $1',
      [id]
    );
  }
}
