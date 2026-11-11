import { readFileSync } from 'fs';
import { join } from 'path';

const migrations = join(__dirname, '..', 'migrations');
const snapshotsSql = readFileSync(join(migrations, '015_ontology_graph_snapshots.sql'), 'utf-8');
const outboxSql = readFileSync(join(migrations, '016_ontology_outbox.sql'), 'utf-8');

describe('ontology outbox trigger denylist', () => {
  it('removes payment comments and avatar URLs before writing JSON rows', () => {
    expect(outboxSql).toMatch(/'payment_comment'/);
    expect(outboxSql).toMatch(/'avatar_url'/);
  });
});

describe('ontology migrations grant the runtime role explicit access', () => {
  it('grants snapshot and sequence access', () => {
    expect(snapshotsSql).toMatch(
      /GRANT SELECT, INSERT, UPDATE, DELETE\s+ON ontology_graph_snapshots, ontology_projector_state TO CURRENT_USER;/,
    );
    expect(snapshotsSql).toMatch(
      /GRANT USAGE, SELECT ON SEQUENCE ontology_snapshot_version_seq TO CURRENT_USER;/,
    );
  });

  it('grants outbox, settings, projector state and sequence access', () => {
    expect(outboxSql).toMatch(
      /GRANT SELECT, INSERT, UPDATE, DELETE ON ontology_outbox TO CURRENT_USER;/,
    );
    expect(outboxSql).toMatch(
      /GRANT USAGE, SELECT ON SEQUENCE ontology_outbox_id_seq TO CURRENT_USER;/,
    );
    expect(outboxSql).toMatch(
      /GRANT SELECT, INSERT, UPDATE, DELETE ON ontology_settings TO CURRENT_USER;/,
    );
    expect(outboxSql).toMatch(
      /GRANT SELECT, INSERT, UPDATE, DELETE ON ontology_projector_state TO CURRENT_USER;/,
    );
  });
});
