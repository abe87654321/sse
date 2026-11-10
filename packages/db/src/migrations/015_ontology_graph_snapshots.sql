-- Dedicated table: the legacy `ontology_snapshots` JSONB rows must keep working
-- until Phase 7. Do not share one table between the two formats.
CREATE SEQUENCE IF NOT EXISTS ontology_snapshot_version_seq START WITH 1;

CREATE TABLE IF NOT EXISTS ontology_graph_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  version BIGINT NOT NULL,
  checksum TEXT NOT NULL,
  nquads TEXT NOT NULL,
  graph_names TEXT[] NOT NULL,
  last_outbox_id BIGINT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_ontology_graph_snapshots_version
  ON ontology_graph_snapshots(version);
CREATE INDEX IF NOT EXISTS idx_ontology_graph_snapshots_created
  ON ontology_graph_snapshots(created_at DESC);

CREATE TABLE IF NOT EXISTS ontology_projector_state (
  id TEXT PRIMARY KEY DEFAULT 'default',
  last_outbox_id BIGINT NOT NULL DEFAULT 0,
  last_snapshot_version BIGINT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO ontology_projector_state (id) VALUES ('default')
  ON CONFLICT (id) DO NOTHING;
