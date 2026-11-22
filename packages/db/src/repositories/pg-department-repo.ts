import { pool } from '../connection';

export interface Department {
  id: string;
  name: string;
  userCount: number;
  isProtected: boolean;
}

export const UNASSIGNED_DEPARTMENT = '未分配';

function mapDepartment(row: any): Department {
  return {
    id: row.id,
    name: row.name,
    userCount: Number(row.user_count ?? 0),
    isProtected: Boolean(row.is_protected),
  };
}

const DEPARTMENT_COLUMNS = `d.id, d.name, d.is_protected,
  (SELECT COUNT(*)::int FROM users u WHERE u.department_id = d.id) AS user_count`;

export class PgDepartmentRepo {
  async list(): Promise<Department[]> {
    const { rows } = await pool.query(
      `SELECT ${DEPARTMENT_COLUMNS} FROM departments d ORDER BY d.name`
    );
    return rows.map(mapDepartment);
  }

  async findById(id: string): Promise<Department | null> {
    const { rows } = await pool.query(
      `SELECT ${DEPARTMENT_COLUMNS} FROM departments d WHERE d.id = $1`,
      [id]
    );
    return rows.length === 0 ? null : mapDepartment(rows[0]);
  }

  async findByName(name: string): Promise<Department | null> {
    const { rows } = await pool.query(
      `SELECT ${DEPARTMENT_COLUMNS} FROM departments d WHERE d.name = $1`,
      [name]
    );
    return rows.length === 0 ? null : mapDepartment(rows[0]);
  }

  async create(name: string): Promise<Department> {
    const { rows } = await pool.query(
      `INSERT INTO departments (name) VALUES ($1)
       RETURNING id, name, is_protected, 0::int AS user_count`,
      [name]
    );
    return mapDepartment(rows[0]);
  }

  async rename(id: string, name: string): Promise<Department | null> {
    const { rows } = await pool.query(
      `UPDATE departments d SET name = $2
        WHERE d.id = $1
       RETURNING d.id, d.name, d.is_protected,
         (SELECT COUNT(*)::int FROM users u WHERE u.department_id = d.id) AS user_count`,
      [id, name]
    );
    return rows.length === 0 ? null : mapDepartment(rows[0]);
  }

  async delete(id: string): Promise<boolean> {
    const { rows } = await pool.query(
      'DELETE FROM departments WHERE id = $1 RETURNING id',
      [id]
    );
    return rows.length > 0;
  }

  async resolveOrCreate(name?: string | null): Promise<string> {
    const trimmed = (name || '').trim() || UNASSIGNED_DEPARTMENT;
    const { rows } = await pool.query(
      `INSERT INTO departments (name) VALUES ($1)
       ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name
       RETURNING id`,
      [trimmed]
    );
    return rows[0].id;
  }
}
