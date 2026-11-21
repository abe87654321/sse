import { readFileSync } from 'fs';
import { join } from 'path';

const sql = readFileSync(
  join(__dirname, '..', 'migrations', '024_verification_history.sql'),
  'utf-8'
);

describe('024_verification_history', () => {
  it('creates both history tables with the expected status checks', () => {
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS verification_runs/i);
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS verification_run_items/i);
    expect(sql).toMatch(/kind TEXT NOT NULL CHECK \(kind IN \('invoice', 'payment_receipt'\)\)/i);
    expect(sql).toMatch(
      /event_type TEXT NOT NULL CHECK \(event_type IN \('verify', 'invalidate', 'backfill'\)\)/i
    );
    expect(sql).toMatch(/status TEXT NOT NULL CHECK \(status IN/i);
    expect(sql).toMatch(/summary JSONB NOT NULL/i);
    expect(sql).toMatch(/result JSONB NOT NULL/i);
    expect(sql).toMatch(/content_hash TEXT NOT NULL/i);
    expect(sql).toMatch(/legacy BOOLEAN NOT NULL DEFAULT false/i);
  });

  it('does not bind history to users, reports, invoices or receipts', () => {
    expect(sql).not.toMatch(/REFERENCES users/i);
    expect(sql).not.toMatch(/REFERENCES expense_reports/i);
    expect(sql).not.toMatch(/REFERENCES invoices/i);
    expect(sql).not.toMatch(/REFERENCES payment_receipts/i);
  });

  it('blocks updates and deletes on both tables', () => {
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION sse_verification_runs_append_only/i);
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION sse_verification_run_items_append_only/i);
    expect(sql).toMatch(/BEFORE UPDATE OR DELETE ON verification_runs/i);
    expect(sql).toMatch(/BEFORE UPDATE OR DELETE ON verification_run_items/i);
    expect(sql).toMatch(/RAISE EXCEPTION/i);
  });

  it('computes SHA-256 hashes for runs and items', () => {
    expect(sql).toMatch(/encode\(sha256\(convert_to\(summary::text, 'UTF8'\)\), 'hex'\)/i);
    expect(sql).toMatch(/encode\(sha256\(convert_to\(result::text, 'UTF8'\)\), 'hex'\)/i);
  });

  it('backfills legacy invoice and receipt results', () => {
    expect(sql).toMatch(/INSERT INTO verification_runs/i);
    expect(sql).toMatch(/'backfill'/i);
    expect(sql).toMatch(/'legacy', true/i);
    expect(sql).toMatch(/FROM invoices i/i);
    expect(sql).toMatch(/FROM payment_receipts pr/i);
    expect(sql).toMatch(/verification_result IS NOT NULL/i);
    expect(sql).toMatch(/NOT EXISTS/i);
  });
});
