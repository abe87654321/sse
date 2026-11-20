CREATE TABLE IF NOT EXISTS audit_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  actor_type TEXT NOT NULL DEFAULT 'system',
  actor_id TEXT,
  actor_role TEXT,
  source TEXT NOT NULL,
  action TEXT NOT NULL,
  entity_type TEXT,
  entity_id TEXT,
  outcome TEXT NOT NULL DEFAULT 'success',
  ip TEXT,
  request_id TEXT,
  details JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_audit_events_occurred ON audit_events (occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_events_source_occurred ON audit_events (source, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_events_action_occurred ON audit_events (action, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_events_actor ON audit_events (actor_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_events_entity ON audit_events (entity_type, entity_id);

CREATE OR REPLACE FUNCTION sse_audit_events_append_only()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'audit_events is append-only (%); insert a new event instead', TG_OP
    USING ERRCODE = '55000';
END;
$$;

DROP TRIGGER IF EXISTS trg_audit_events_append_only ON audit_events;
CREATE TRIGGER trg_audit_events_append_only
  BEFORE UPDATE OR DELETE ON audit_events
  FOR EACH ROW
  EXECUTE FUNCTION sse_audit_events_append_only();
