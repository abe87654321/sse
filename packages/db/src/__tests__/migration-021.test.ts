import { readFileSync } from 'fs';
import { join } from 'path';

const migrations = join(__dirname, '..', 'migrations');
const sql = readFileSync(join(migrations, '021_guard_report_deletion.sql'), 'utf-8');

describe('021_guard_report_deletion', () => {
  it('installs a before-delete guard on expense_reports', () => {
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION\s+sse_guard_expense_report_delete/i);
    expect(sql).toMatch(/BEFORE DELETE ON expense_reports/i);
    expect(sql).toMatch(/DROP TRIGGER IF EXISTS/i);
  });

  it('blocks non-draft reports and reports with approval evidence', () => {
    expect(sql).toMatch(/OLD\.status\s*<>\s*'draft'/i);
    expect(sql).toMatch(/FROM approval_records WHERE report_id = OLD\.id/i);
    expect(sql).toMatch(/RAISE EXCEPTION/i);
  });

  it('keeps the explicit cascade-delete escape hatch', () => {
    expect(sql).toMatch(/current_setting\('sse\.allow_destructive_delete', true\)/i);
    expect(sql).toMatch(/RETURN OLD/i);
  });

  it('restricts approval_records deletion unless evidence is removed first', () => {
    expect(sql).toMatch(/DROP CONSTRAINT IF EXISTS approval_records_report_id_fkey/i);
    expect(sql).toMatch(
      /FOREIGN KEY \(report_id\) REFERENCES expense_reports\(id\) ON DELETE RESTRICT/i
    );
  });
});
