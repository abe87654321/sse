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
    departmentId: row.department_id ?? undefined,
    role: row.role,
    parentId: row.parent_id ?? undefined,
    status: row.status,
    avatarUrl: row.avatar_url ?? undefined,
    notify_prefs: row.notify_prefs ?? undefined,
    deletedAt: row.deleted_at ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const USER_COLUMNS = `u.id, u.name, u.phone, u.email, u.department_id, u.role, u.parent_id,
  u.status, u.deleted_at, u.avatar_url, u.notify_prefs, u.created_at, u.updated_at,
  d.name AS department`;
const USER_FROM = 'FROM users u LEFT JOIN departments d ON d.id = u.department_id';

export class PgUserRepo implements IUserRepo {
  async findById(id: string): Promise<User | null> {
    const { rows } = await pool.query(
      `SELECT ${USER_COLUMNS} ${USER_FROM} WHERE u.id = $1`,
      [id]
    );
    return rows.length === 0 ? null : mapUser(rows[0]);
  }

  async findByPhone(phone: string): Promise<User | null> {
    const { rows } = await pool.query(
      `SELECT ${USER_COLUMNS} ${USER_FROM} WHERE u.phone = $1`,
      [phone]
    );
    return rows.length === 0 ? null : mapUser(rows[0]);
  }

  async findCredentialsByPhone(
    phone: string
  ): Promise<{ user: User; passwordHash: string } | null> {
    const { rows } = await pool.query(
      `SELECT ${USER_COLUMNS}, u.password_hash ${USER_FROM} WHERE u.phone = $1`,
      [phone]
    );
    return rows.length === 0
      ? null
      : { user: mapUser(rows[0]), passwordHash: rows[0].password_hash ?? '' };
  }

  async findCredentialsById(
    id: string
  ): Promise<{ user: User; passwordHash: string } | null> {
    const { rows } = await pool.query(
      `SELECT ${USER_COLUMNS}, u.password_hash ${USER_FROM} WHERE u.id = $1`,
      [id]
    );
    return rows.length === 0
      ? null
      : { user: mapUser(rows[0]), passwordHash: rows[0].password_hash ?? '' };
  }

  async findDeptApprovers(department: string): Promise<User[]> {
    const { rows } = await pool.query(
      `SELECT ${USER_COLUMNS} ${USER_FROM} WHERE d.name = $1 AND u.role = $2`,
      [department, 'dept_approver']
    );
    return rows.map(mapUser);
  }

  async findByRole(role: string, department?: string): Promise<User[]> {
    if (department) {
      const { rows } = await pool.query(
        `SELECT ${USER_COLUMNS} ${USER_FROM} WHERE u.role = $1 AND d.name = $2 AND u.status = 'active' ORDER BY u.name`,
        [role, department]
      );
      return rows.map(mapUser);
    }
    const { rows } = await pool.query(
      `SELECT ${USER_COLUMNS} ${USER_FROM} WHERE u.role = $1 AND u.status = 'active' ORDER BY u.name`,
      [role]
    );
    return rows.map(mapUser);
  }

  async findAll(): Promise<User[]> {
    const { rows } = await pool.query(
      `SELECT ${USER_COLUMNS} ${USER_FROM} ORDER BY u.name`
    );
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
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SET LOCAL sse.allow_destructive_delete = 'on'");

      const optionalTables = [
        'DELETE FROM identity_mappings WHERE local_user_id::text = $1::text',
        'DELETE FROM system_messages WHERE sender_id::text = $1::text',
      ];
      for (const sql of optionalTables) {
        try { await client.query(sql, [id]); } catch { /* table may not exist */ }
      }

      await client.query(
        'DELETE FROM mcp_api_keys WHERE user_id::text = $1::text',
        [id]
      );

      await client.query(
        'DELETE FROM approval_records WHERE approver_id::text = $1::text',
        [id]
      );

      await client.query(
        'DELETE FROM notification_logs WHERE recipient_id::text = $1::text',
        [id]
      );

      await client.query(
        'DELETE FROM expense_reports WHERE paid_by::text = $1::text',
        [id]
      );

      await client.query(
        'UPDATE users SET parent_id = NULL WHERE parent_id::text = $1::text',
        [id]
      );

      await client.query(
        `DELETE FROM invoices WHERE item_id IN (
           SELECT id FROM expense_items WHERE report_id IN (
             SELECT id FROM expense_reports WHERE user_id::text = $1::text
           )
         )`,
        [id]
      );
      await client.query(
        'DELETE FROM expense_items WHERE report_id IN (SELECT id FROM expense_reports WHERE user_id::text = $1::text)',
        [id]
      );
      await client.query(
        'DELETE FROM approval_records WHERE report_id IN (SELECT id FROM expense_reports WHERE user_id::text = $1::text)',
        [id]
      );
      await client.query('DELETE FROM expense_reports WHERE user_id::text = $1::text', [id]);
      await client.query('DELETE FROM users WHERE id::text = $1::text', [id]);

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async updateAvatar(id: string, avatarUrl: string): Promise<void> {
    await pool.query(
      'UPDATE users SET avatar_url = $1, updated_at = NOW() WHERE id = $2',
      [avatarUrl, id]
    );
  }

  async getRelatedDataCount(id: string): Promise<number> {
    const queries: { sql: string; params: any[] }[] = [
      { sql: 'SELECT COUNT(*)::int AS cnt FROM expense_reports WHERE user_id = $1', params: [id] },
      { sql: 'SELECT COUNT(*)::int AS cnt FROM approval_records WHERE approver_id = $1::text', params: [id] },
      { sql: 'SELECT COUNT(*)::int AS cnt FROM notification_logs WHERE recipient_id = $1::uuid', params: [id] },
      { sql: 'SELECT COUNT(*)::int AS cnt FROM system_messages WHERE sender_id = $1', params: [id] },
      { sql: 'SELECT COUNT(*)::int AS cnt FROM identity_mappings WHERE local_user_id = $1', params: [id] },
    ];
    let count = 0;
    for (const { sql, params } of queries) {
      try {
        const { rows } = await pool.query(sql, params);
        count += rows[0].cnt;
      } catch { /* table may not exist, skip */ }
    }
    return count;
  }
}
