import { readFileSync } from 'fs';
import { join } from 'path';

const migrations = join(__dirname, '..', 'migrations');
const sql = readFileSync(join(migrations, '026_ontology_user_department.sql'), 'utf-8');

describe('026_ontology_user_department', () => {
  it('keeps the outbox denylist intact', () => {
    expect(sql).toMatch(/password_hash/);
    expect(sql).toMatch(/storage_key/);
    expect(sql).toMatch(/ocr_result/);
  });

  it('resolves the department name for users rows', () => {
    expect(sql).toMatch(/TG_TABLE_NAME = 'users'/);
    expect(sql).toMatch(/SELECT name FROM departments WHERE id = NEW.department_id/);
    expect(sql).toMatch(/SELECT name FROM departments WHERE id = OLD.department_id/);
    expect(sql).toMatch(/'department'/);
  });

  it('keeps insert/delete payloads nullable', () => {
    expect(sql).toMatch(/IF TG_OP <> 'INSERT' THEN/);
    expect(sql).toMatch(/IF TG_OP <> 'DELETE' THEN/);
  });
});
