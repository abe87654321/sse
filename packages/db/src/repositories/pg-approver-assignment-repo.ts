import type { ApproverDepartment, DepartmentApprover } from '@sse/shared';
import type { IApproverAssignmentRepo } from '@sse/core';
import { pool } from '../connection';

export class ApproverConflictError extends Error {
  constructor(public readonly departmentIds: string[]) {
    super('department already assigned to another approver');
    this.name = 'ApproverConflictError';
  }
}

function mapDepartment(row: any): ApproverDepartment {
  return { id: row.id, name: row.name };
}

function mapAssignment(row: any): DepartmentApprover {
  return {
    departmentId: row.department_id,
    departmentName: row.department_name,
    userId: row.user_id,
    userName: row.user_name,
  };
}

export class PgApproverAssignmentRepo implements IApproverAssignmentRepo {
  async findApproverIdForDepartment(departmentId: string): Promise<string | null> {
    const { rows } = await pool.query(
      'SELECT user_id FROM department_approvers WHERE department_id = $1',
      [departmentId]
    );
    return rows[0]?.user_id ?? null;
  }

  async findApproverIdForDepartmentName(departmentName: string): Promise<string | null> {
    const { rows } = await pool.query(
      `SELECT da.user_id
         FROM department_approvers da
         JOIN departments d ON d.id = da.department_id
        WHERE d.name = $1`,
      [departmentName]
    );
    return rows[0]?.user_id ?? null;
  }

  async findFallbackAdminId(): Promise<string | null> {
    const { rows } = await pool.query(
      `SELECT id FROM users
        WHERE role = 'admin' AND status = 'active'
        ORDER BY created_at ASC, id ASC
        LIMIT 1`
    );
    return rows[0]?.id ?? null;
  }

  async findDepartmentsForUser(userId: string): Promise<ApproverDepartment[]> {
    const { rows } = await pool.query(
      `SELECT d.id, d.name
         FROM department_approvers da
         JOIN departments d ON d.id = da.department_id
        WHERE da.user_id = $1
        ORDER BY d.name`,
      [userId]
    );
    return rows.map(mapDepartment);
  }

  async listAssignments(): Promise<DepartmentApprover[]> {
    const { rows } = await pool.query(
      `SELECT da.department_id, d.name AS department_name, da.user_id, u.name AS user_name
         FROM department_approvers da
         JOIN departments d ON d.id = da.department_id
         JOIN users u ON u.id = da.user_id
        ORDER BY d.name`
    );
    return rows.map(mapAssignment);
  }

  async assign(departmentId: string, userId: string, assignedBy?: string): Promise<void> {
    await pool.query(
      `INSERT INTO department_approvers (department_id, user_id, assigned_by)
       VALUES ($1, $2, $3)
       ON CONFLICT (department_id) DO UPDATE
         SET user_id = EXCLUDED.user_id,
             assigned_by = EXCLUDED.assigned_by,
             updated_at = NOW()`,
      [departmentId, userId, assignedBy ?? null]
    );
  }

  async unassign(departmentId: string): Promise<void> {
    await pool.query('DELETE FROM department_approvers WHERE department_id = $1', [departmentId]);
  }

  async replaceForUser(
    userId: string,
    departmentIds: string[],
    assignedBy?: string
  ): Promise<void> {
    const ids = [...new Set(departmentIds)];
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const { rows: conflicts } = await client.query(
        `SELECT department_id, user_id
           FROM department_approvers
          WHERE department_id = ANY($1::uuid[]) AND user_id <> $2
          FOR UPDATE`,
        [ids, userId]
      );
      if (conflicts.length > 0) {
        throw new ApproverConflictError(conflicts.map((row: any) => row.department_id));
      }

      await client.query(
        `DELETE FROM department_approvers
          WHERE user_id = $2 AND NOT (department_id = ANY($1::uuid[]))`,
        [ids, userId]
      );

      await client.query(
        `INSERT INTO department_approvers (department_id, user_id, assigned_by)
         SELECT d, $2, $3 FROM unnest($1::uuid[]) AS d
         ON CONFLICT (department_id) DO UPDATE
           SET user_id = EXCLUDED.user_id,
               assigned_by = EXCLUDED.assigned_by,
               updated_at = NOW()`,
        [ids, userId, assignedBy ?? null]
      );

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }
}
