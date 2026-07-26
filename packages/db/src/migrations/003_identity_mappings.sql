CREATE TABLE IF NOT EXISTS identity_mappings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  local_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  external_id TEXT NOT NULL,
  source TEXT NOT NULL,
  external_metadata JSONB DEFAULT '{}',
  last_synced_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(local_user_id, source),
  UNIQUE(external_id, source)
);

CREATE INDEX IF NOT EXISTS idx_identity_mappings_external ON identity_mappings(external_id, source);
CREATE INDEX IF NOT EXISTS idx_identity_mappings_local ON identity_mappings(local_user_id);
