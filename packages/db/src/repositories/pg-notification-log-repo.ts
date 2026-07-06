import type { NotificationLog } from '@sse/shared';
import type { INotificationLogRepo } from '@sse/core';
import { pool } from '../connection';

function mapLog(row: any): NotificationLog {
  return {
    id: row.id,
    reportId: row.report_id,
    recipientId: row.recipient_id,
    channel: row.channel,
    triggerType: row.trigger_type,
    status: row.status,
    sentAt: row.sent_at ?? undefined,
    errorMessage: row.error_message ?? undefined,
  };
}

export class PgNotificationLogRepo implements INotificationLogRepo {
  async create(log: Omit<NotificationLog, 'id'>): Promise<NotificationLog> {
    const { rows } = await pool.query(
      `INSERT INTO notification_logs (report_id, recipient_id, channel, trigger_type, status, sent_at, error_message)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [
        log.reportId,
        log.recipientId,
        log.channel,
        log.triggerType,
        log.status,
        log.sentAt ?? null,
        log.errorMessage ?? null,
      ]
    );
    return mapLog(rows[0]);
  }

  async findByReportId(reportId: string): Promise<NotificationLog[]> {
    const { rows } = await pool.query(
      'SELECT * FROM notification_logs WHERE report_id = $1 ORDER BY id',
      [reportId]
    );
    return rows.map(mapLog);
  }

  async findByRecipient(recipientId: string, page: number, pageSize: number): Promise<{ results: NotificationLog[]; total: number }> {
    const offset = (page - 1) * pageSize;
    const [dataRes, countRes] = await Promise.all([
      pool.query(
        'SELECT * FROM notification_logs WHERE recipient_id = $1 ORDER BY id DESC LIMIT $2 OFFSET $3',
        [recipientId, pageSize, offset]
      ),
      pool.query(
        'SELECT COUNT(*) FROM notification_logs WHERE recipient_id = $1',
        [recipientId]
      ),
    ]);
    return {
      results: dataRes.rows.map(mapLog),
      total: parseInt(countRes.rows[0].count, 10),
    };
  }
}
