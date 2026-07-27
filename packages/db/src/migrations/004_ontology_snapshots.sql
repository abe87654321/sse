CREATE TABLE IF NOT EXISTS ontology_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  graph JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ontology_snapshots_created ON ontology_snapshots(created_at DESC);
