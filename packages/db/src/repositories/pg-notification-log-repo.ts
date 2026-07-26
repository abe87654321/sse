import type { NotificationLog } from '@sse/shared';
import type { INotificationLogRepo } from '@sse/core';
import { pool } from '../connection';

function mapLog(row: any): NotificationLog {
  return {
    id: row.id,
    user_id: row.user_id || row.recipient_id || '',
    type: row.type || row.trigger_type || '',
    title: row.title || '',
    body: row.body || '',
    read_at: row.read_at ?? undefined,
    created_at: row.created_at,
  };
}

export class PgNotificationLogRepo implements INotificationLogRepo {
  async create(log: Omit<NotificationLog, 'id'>): Promise<NotificationLog> {
    const { rows } = await pool.query(
      `INSERT INTO notification_logs (user_id, type, title, body)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [log.user_id, log.type, log.title, log.body]
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
        'SELECT * FROM notification_logs WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3',
        [recipientId, pageSize, offset]
      ),
      pool.query(
        'SELECT COUNT(*) FROM notification_logs WHERE user_id = $1',
        [recipientId]
      ),
    ]);
    return {
      results: dataRes.rows.map(mapLog),
      total: parseInt(countRes.rows[0].count, 10),
    };
  }
}
