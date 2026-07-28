import type { User } from '@sse/shared';
import type { IUserRepo } from '@sse/core';
import { pool } from '../connection';

function mapUser(row: any): User {
  return {
    id: row.id,
    name: row.name,
    phone: row.phone,
    email: row.email ?? undefined,
    department: row.department,
    role: row.role,
    parentId: row.parent_id ?? undefined,
    status: row.status,
    deletedAt: row.deleted_at ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const USER_COLUMNS = 'id, name, phone, email, department, role, parent_id, status, deleted_at, created_at, updated_at';

export class PgUserRepo implements IUserRepo {
  async findById(id: string): Promise<User | null> {
    const { rows } = await pool.query(`SELECT ${USER_COLUMNS} FROM users WHERE id = $1`, [id]);
    return rows.length === 0 ? null : mapUser(rows[0]);
  }

  async findByPhone(phone: string): Promise<User | null> {
    const { rows } = await pool.query(`SELECT ${USER_COLUMNS} FROM users WHERE phone = $1`, [phone]);
    return rows.length === 0 ? null : mapUser(rows[0]);
  }

  async findDeptApprovers(department: string): Promise<User[]> {
    const { rows } = await pool.query(
      `SELECT ${USER_COLUMNS} FROM users WHERE department = $1 AND role = $2`,
      [department, 'dept_approver']
    );
    return rows.map(mapUser);
  }

  async findByRole(role: string, department?: string): Promise<User[]> {
    if (department) {
      const { rows } = await pool.query(
        `SELECT ${USER_COLUMNS} FROM users WHERE role = $1 AND department = $2 AND status = 'active'`,
        [role, department]
      );
      return rows.map(mapUser);
    }
    const { rows } = await pool.query(
      `SELECT ${USER_COLUMNS} FROM users WHERE role = $1 AND status = 'active'`,
      [role]
    );
    return rows.map(mapUser);
  }

  async findAll(): Promise<User[]> {
    const { rows } = await pool.query(`SELECT ${USER_COLUMNS} FROM users ORDER BY name`);
    return rows.map(mapUser);
  }

  async softDelete(id: string): Promise<void> {
    await pool.query(
      "UPDATE users SET status = 'deleted', deleted_at = NOW(), updated_at = NOW() WHERE id = $1",
      [id]
    );
  }

  async hardDelete(id: string): Promise<void> {
    await pool.query('DELETE FROM users WHERE id = $1', [id]);
  }

  async cascadeDelete(id: string): Promise<void> {
    await pool.query('DELETE FROM identity_mappings WHERE local_user_id = $1', [id]);
    await pool.query('DELETE FROM notification_logs WHERE recipient_id = $1::uuid', [id]);
    await pool.query('DELETE FROM system_messages WHERE sender_id = $1', [id]);
    await pool.query('DELETE FROM invoices WHERE item_id IN (SELECT id FROM expense_items WHERE report_id IN (SELECT id FROM expense_reports WHERE user_id = $1))', [id]);
    await pool.query('DELETE FROM expense_items WHERE report_id IN (SELECT id FROM expense_reports WHERE user_id = $1)', [id]);
    await pool.query('DELETE FROM approval_records WHERE report_id IN (SELECT id FROM expense_reports WHERE user_id = $1)', [id]);
    await pool.query('DELETE FROM expense_reports WHERE user_id = $1', [id]);
    await pool.query('DELETE FROM users WHERE id = $1', [id]);
  }

  async getRelatedDataCount(id: string): Promise<number> {
    const { rows } = await pool.query(
      `SELECT
        COALESCE((SELECT COUNT(*) FROM expense_reports WHERE user_id = $1), 0) +
        COALESCE((SELECT COUNT(*) FROM approval_records WHERE approver_id = $1::text), 0) +
        COALESCE((SELECT COUNT(*) FROM notification_logs WHERE recipient_id = $1::uuid), 0) +
        COALESCE((SELECT COUNT(*) FROM system_messages WHERE sender_id = $1), 0) +
        COALESCE((SELECT COUNT(*) FROM identity_mappings WHERE local_user_id = $1), 0)
        AS total`,
      [id]
    );
    return parseInt(rows[0].total, 10);
  }
}
