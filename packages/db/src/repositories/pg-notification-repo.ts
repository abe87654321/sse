import type { NotificationLog, NotificationDelivery, SystemMessage } from '@sse/shared';
import type { INotificationRepo } from '@sse/core';
import { pool } from '../connection';

function mapNotification(row: any): NotificationLog {
  return {
    id: row.id,
    user_id: row.user_id,
    type: row.type,
    title: row.title,
    body: row.body,
    read_at: row.read_at ?? undefined,
    created_at: row.created_at,
  };
}

function mapDelivery(row: any): NotificationDelivery {
  return {
    id: row.id,
    notification_id: row.notification_id,
    channel: row.channel,
    status: row.status,
    error_message: row.error_message ?? undefined,
    sent_at: row.sent_at ?? undefined,
    created_at: row.created_at,
  };
}

function mapSystemMessage(row: any): SystemMessage {
  return {
    id: row.id,
    title: row.title,
    body: row.body,
    body_ai: row.body_ai ?? undefined,
    body_ai_instruction: row.body_ai_instruction ?? undefined,
    target_roles: row.target_roles || [],
    target_user_ids: row.target_user_ids || [],
    sender_id: row.sender_id,
    delivery_channels: row.delivery_channels || [],
    status: row.status,
    sent_at: row.sent_at ?? undefined,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export class PgNotificationRepo implements INotificationRepo {
  async findByUserId(userId: string, page: number, pageSize: number) {
    const offset = (page - 1) * pageSize;
    const [dataRes, countRes] = await Promise.all([
      pool.query('SELECT * FROM notification_logs WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3', [userId, pageSize, offset]),
      pool.query('SELECT COUNT(*) FROM notification_logs WHERE user_id = $1', [userId]),
    ]);
    return { results: dataRes.rows.map(mapNotification), total: parseInt(countRes.rows[0].count, 10) };
  }

  async findById(id: string) {
    const { rows } = await pool.query('SELECT * FROM notification_logs WHERE id = $1', [id]);
    return rows.length === 0 ? null : mapNotification(rows[0]);
  }

  async countUnread(userId: string) {
    const { rows } = await pool.query('SELECT COUNT(*) FROM notification_logs WHERE user_id = $1 AND read_at IS NULL', [userId]);
    return parseInt(rows[0].count, 10);
  }

  async markRead(id: string) {
    await pool.query('UPDATE notification_logs SET read_at = NOW() WHERE id = $1', [id]);
  }

  async markAllRead(userId: string) {
    await pool.query('UPDATE notification_logs SET read_at = NOW() WHERE user_id = $1 AND read_at IS NULL', [userId]);
  }

  async create(notification: Omit<NotificationLog, 'id'>) {
    const { rows } = await pool.query(
      `INSERT INTO notification_logs (user_id, type, title, body) VALUES ($1, $2, $3, $4) RETURNING *`,
      [notification.user_id, notification.type, notification.title, notification.body]
    );
    return mapNotification(rows[0]);
  }

  async createDelivery(delivery: Omit<NotificationDelivery, 'id'>) {
    const { rows } = await pool.query(
      `INSERT INTO notification_deliveries (notification_id, channel, status, error_message) VALUES ($1, $2, $3, $4) RETURNING *`,
      [delivery.notification_id, delivery.channel, delivery.status, delivery.error_message ?? null]
    );
    return mapDelivery(rows[0]);
  }

  async findDeliveriesByNotification(notificationId: string) {
    const { rows } = await pool.query('SELECT * FROM notification_deliveries WHERE notification_id = $1', [notificationId]);
    return rows.map(mapDelivery);
  }

  async findSystemMessages(status?: string) {
    let query = 'SELECT * FROM system_messages';
    const values: any[] = [];
    if (status) { query += ' WHERE status = $1'; values.push(status); }
    query += ' ORDER BY updated_at DESC';
    const { rows } = await pool.query(query, values);
    return rows.map(mapSystemMessage);
  }

  async findSystemMessageById(id: string) {
    const { rows } = await pool.query('SELECT * FROM system_messages WHERE id = $1', [id]);
    return rows.length === 0 ? null : mapSystemMessage(rows[0]);
  }

  async createSystemMessage(msg: Omit<SystemMessage, 'id'>) {
    const { rows } = await pool.query(
      `INSERT INTO system_messages (title, body, body_ai, body_ai_instruction, target_roles, target_user_ids, sender_id, delivery_channels, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
      [msg.title, msg.body, msg.body_ai ?? null, msg.body_ai_instruction ?? null, msg.target_roles ?? [], msg.target_user_ids ?? [], msg.sender_id, msg.delivery_channels ?? [], msg.status || 'draft']
    );
    return mapSystemMessage(rows[0]);
  }

  async updateSystemMessage(id: string, msg: Partial<SystemMessage>) {
    const fields: string[] = [];
    const values: any[] = [];
    let idx = 1;
    if (msg.title !== undefined) { fields.push(`title = $${idx++}`); values.push(msg.title); }
    if (msg.body !== undefined) { fields.push(`body = $${idx++}`); values.push(msg.body); }
    if (msg.body_ai !== undefined) { fields.push(`body_ai = $${idx++}`); values.push(msg.body_ai); }
    if (msg.body_ai_instruction !== undefined) { fields.push(`body_ai_instruction = $${idx++}`); values.push(msg.body_ai_instruction); }
    if (msg.target_roles !== undefined) { fields.push(`target_roles = $${idx++}`); values.push(msg.target_roles); }
    if (msg.target_user_ids !== undefined) { fields.push(`target_user_ids = $${idx++}`); values.push(msg.target_user_ids); }
    if (msg.delivery_channels !== undefined) { fields.push(`delivery_channels = $${idx++}`); values.push(msg.delivery_channels); }
    if (msg.status !== undefined) { fields.push(`status = $${idx++}`); values.push(msg.status); if (msg.status === 'sent') fields.push('sent_at = NOW()'); }
    fields.push('updated_at = NOW()');
    if (fields.length === 0) return;
    values.push(id);
    await pool.query(`UPDATE system_messages SET ${fields.join(', ')} WHERE id = $${idx}`, values);
  }

  async deleteSystemMessage(id: string) {
    await pool.query(`DELETE FROM system_messages WHERE id = $1 AND status = 'draft'`, [id]);
  }
}
