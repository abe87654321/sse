import { readFileSync } from 'fs';
import { join } from 'path';

const sql = readFileSync(
  join(__dirname, '..', 'migrations', '023_report_snapshots.sql'),
  'utf-8'
);

describe('023_report_snapshots', () => {
  it('creates the snapshot table with the expected columns and type check', () => {
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS report_snapshots/i);
    expect(sql).toMatch(/snapshot_type TEXT NOT NULL/i);
    expect(sql).toMatch(/payload JSONB NOT NULL/i);
    expect(sql).toMatch(/content_hash TEXT NOT NULL/i);
    expect(sql).toMatch(/legacy BOOLEAN NOT NULL DEFAULT false/i);
    expect(sql).toMatch(
      /CHECK \(snapshot_type IN \('submit', 'approve', 'reject', 'pay', 'backfill'\)\)/i
    );
  });

  it('does not bind snapshots to users or reports with foreign keys', () => {
    expect(sql).not.toMatch(/REFERENCES users/i);
    expect(sql).not.toMatch(/REFERENCES expense_reports/i);
  });

  it('blocks updates and deletes with an append-only trigger', () => {
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION sse_report_snapshots_append_only/i);
    expect(sql).toMatch(/BEFORE UPDATE OR DELETE ON report_snapshots/i);
    expect(sql).toMatch(/RAISE EXCEPTION/i);
  });

  it('computes the content hash with sha256 over the canonical JSONB text', () => {
    expect(sql).toMatch(
      /encode\(sha256\(convert_to\(p\.payload::text, 'UTF8'\)\), 'hex'\)/i
    );
  });

  it('backfills one legacy snapshot per non-draft report', () => {
    expect(sql).toMatch(/INSERT INTO report_snapshots/i);
    expect(sql).toMatch(/'backfill'/i);
    expect(sql).toMatch(/WHERE r\.status <> 'draft'/i);
    expect(sql).toMatch(/'legacy', true/i);
  });
});
