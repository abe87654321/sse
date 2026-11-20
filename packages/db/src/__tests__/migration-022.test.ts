import { readFileSync } from 'fs';
import { join } from 'path';

const migrations = join(__dirname, '..', 'migrations');
const sql = readFileSync(join(migrations, '022_audit_events.sql'), 'utf-8');

describe('022_audit_events', () => {
  it('creates the append-only audit_events table', () => {
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS audit_events/i);
    expect(sql).toMatch(/details JSONB NOT NULL DEFAULT '\{\}'::jsonb/i);
    expect(sql).toMatch(/occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW\(\)/i);
  });

  it('does not bind audit rows to users or reports', () => {
    expect(sql).not.toMatch(/REFERENCES users/i);
    expect(sql).not.toMatch(/REFERENCES expense_reports/i);
  });

  it('blocks updates and deletes with a trigger', () => {
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION\s+sse_audit_events_append_only/i);
    expect(sql).toMatch(/BEFORE UPDATE OR DELETE ON audit_events/i);
    expect(sql).toMatch(/RAISE EXCEPTION/i);
    expect(sql).toMatch(/DROP TRIGGER IF EXISTS/i);
  });

  it('indexes the common query paths', () => {
    expect(sql).toMatch(/audit_events \(occurred_at DESC\)/i);
    expect(sql).toMatch(/audit_events \(source, occurred_at DESC\)/i);
    expect(sql).toMatch(/audit_events \(action, occurred_at DESC\)/i);
    expect(sql).toMatch(/audit_events \(actor_id, occurred_at DESC\)/i);
    expect(sql).toMatch(/audit_events \(entity_type, entity_id\)/i);
  });
});
