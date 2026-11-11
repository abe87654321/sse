import { readFileSync } from 'fs';
import { join } from 'path';

const sql = readFileSync(
  join(__dirname, '..', 'migrations', '017_ontology_rules_v2.sql'),
  'utf-8',
);

describe('migration 017 rule seed idempotency', () => {
  it('creates a unique index on reasoning_rules(name) before seeding', () => {
    const index = sql.indexOf(
      'CREATE UNIQUE INDEX IF NOT EXISTS uq_reasoning_rules_name ON reasoning_rules(name);',
    );
    const seed = sql.indexOf('INSERT INTO reasoning_rules');

    expect(index).toBeGreaterThanOrEqual(0);
    expect(seed).toBeGreaterThanOrEqual(0);
    expect(index).toBeLessThan(seed);
  });

  it('uses the named conflict target so re-running the seed is a no-op', () => {
    expect(sql).toMatch(/ON CONFLICT \(name\) DO NOTHING;/);
    expect(sql).not.toMatch(/ON CONFLICT DO NOTHING;/);
  });

  it('deduplicates existing rule names before creating the unique index', () => {
    const dedupe = sql.indexOf('DELETE FROM reasoning_rules a');
    const index = sql.indexOf(
      'CREATE UNIQUE INDEX IF NOT EXISTS uq_reasoning_rules_name ON reasoning_rules(name);',
    );

    expect(dedupe).toBeGreaterThanOrEqual(0);
    expect(index).toBeGreaterThanOrEqual(0);
    expect(dedupe).toBeLessThan(index);
    expect(sql).toMatch(/a\.id > b\.id/);
  });
});
