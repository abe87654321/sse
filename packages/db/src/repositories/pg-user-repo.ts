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
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class PgUserRepo implements IUserRepo {
  async findById(id: string): Promise<User | null> {
    const { rows } = await pool.query('SELECT * FROM users WHERE id = $1', [id]);
    return rows.length === 0 ? null : mapUser(rows[0]);
  }

  async findByPhone(phone: string): Promise<User | null> {
    const { rows } = await pool.query('SELECT * FROM users WHERE phone = $1', [phone]);
    return rows.length === 0 ? null : mapUser(rows[0]);
  }

  async findDeptApprovers(department: string): Promise<User[]> {
    const { rows } = await pool.query(
      'SELECT * FROM users WHERE department = $1 AND role = $2',
      [department, 'dept_approver']
    );
    return rows.map(mapUser);
  }

  async findAll(): Promise<User[]> {
    const { rows } = await pool.query('SELECT * FROM users ORDER BY name');
    return rows.map(mapUser);
  }
}
