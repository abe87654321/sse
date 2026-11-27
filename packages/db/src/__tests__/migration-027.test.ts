import { readFileSync } from 'fs';
import { join } from 'path';

const sql = readFileSync(
  join(__dirname, '..', 'migrations', '027_department_approvers.sql'),
  'utf-8'
);

describe('027_department_approvers', () => {
  it('creates the assignment table with one approver per department', () => {
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS department_approvers/i);
    expect(sql).toMatch(
      /department_id UUID PRIMARY KEY REFERENCES departments\(id\) ON DELETE CASCADE/i
    );
    expect(sql).toMatch(/user_id\s+UUID NOT NULL REFERENCES users\(id\) ON DELETE CASCADE/i);
  });

  it('indexes the assignments by user', () => {
    expect(sql).toMatch(/idx_department_approvers_user/i);
    expect(sql).toMatch(/ON department_approvers\(user_id\)/i);
  });

  it('backfills legacy dept_approver users once per department', () => {
    expect(sql).toMatch(/DISTINCT ON \(u\.department_id\)/i);
    expect(sql).toMatch(/WHERE u\.role = 'dept_approver' AND u\.status = 'active'/i);
    expect(sql).toMatch(/ON CONFLICT \(department_id\) DO NOTHING/i);
  });

  it('keeps updated_at fresh on updates', () => {
    expect(sql).toMatch(/BEFORE UPDATE ON department_approvers/i);
    expect(sql).toMatch(/NEW\.updated_at := NOW\(\)/i);
  });
});
