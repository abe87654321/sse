import { readFileSync } from 'fs';
import { join } from 'path';

const migrations = join(__dirname, '..', 'migrations');
const sql = readFileSync(join(migrations, '025_departments.sql'), 'utf-8');

describe('025_departments', () => {
  it('creates the departments registry with a protected unassigned row', () => {
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS departments/i);
    expect(sql).toMatch(/name TEXT NOT NULL UNIQUE/i);
    expect(sql).toMatch(/is_protected BOOLEAN NOT NULL DEFAULT false/i);
    expect(sql).toMatch(/VALUES \('未分配', true\)/);
  });

  it('backfills users and enforces the foreign key', () => {
    expect(sql).toMatch(/INSERT INTO departments \(name\)/i);
    expect(sql).toMatch(/ADD COLUMN department_id UUID/i);
    expect(sql).toMatch(/ALTER COLUMN department_id SET NOT NULL/i);
    expect(sql).toMatch(/FOREIGN KEY \(department_id\) REFERENCES departments\(id\) ON DELETE RESTRICT/i);
    expect(sql).toMatch(/CREATE INDEX IF NOT EXISTS idx_users_department_id/i);
  });

  it('drops the legacy text columns', () => {
    expect(sql).toMatch(/ALTER TABLE users DROP COLUMN department;/i);
    expect(sql).toMatch(/ALTER TABLE mcp_api_keys DROP COLUMN IF EXISTS department;/i);
  });

  it('protects the unassigned department from rename and delete', () => {
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION sse_departments_protect/i);
    expect(sql).toMatch(/BEFORE UPDATE OR DELETE ON departments/i);
    expect(sql).toMatch(/protected department cannot be deleted/i);
    expect(sql).toMatch(/protected department cannot be modified/i);
    expect(sql).toMatch(/is_protected cannot be changed/i);
    expect(sql).toMatch(/DROP TRIGGER IF EXISTS trg_departments_protect/i);
  });
});
