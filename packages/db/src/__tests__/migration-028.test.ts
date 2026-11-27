import { readFileSync } from 'fs';
import { join } from 'path';

const sql = readFileSync(
  join(__dirname, '..', 'migrations', '028_ontology_approver_departments.sql'),
  'utf-8'
);

describe('028_ontology_approver_departments', () => {
  it('enriches the users payload with approver departments', () => {
    expect(sql).toMatch(/sse_ontology_user_payload/);
    expect(sql).toMatch(/'approver_departments'/);
    expect(sql).toMatch(/json_agg\(d\.name ORDER BY d\.name\)/i);
  });

  it('keeps the sensitive-field denylist', () => {
    expect(sql).toMatch(/'password_hash', 'phone', 'email'/);
    expect(sql).not.toMatch(/SELECT \* FROM users/);
  });

  it('re-projects the affected user when assignments change', () => {
    expect(sql).toMatch(/CREATE TRIGGER trg_department_approvers_ontology_outbox/i);
    expect(sql).toMatch(/AFTER INSERT OR UPDATE OR DELETE ON department_approvers/i);
    expect(sql).toMatch(/VALUES \('users', 'UPDATE'/);
    expect(sql).toMatch(/u\.deleted_at IS NOT NULL/);
  });
});
