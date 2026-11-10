CREATE TABLE IF NOT EXISTS ontology_outbox (
  id BIGSERIAL PRIMARY KEY,
  table_name TEXT NOT NULL,
  op TEXT NOT NULL CHECK (op IN ('INSERT', 'UPDATE', 'DELETE')),
  row_id UUID,
  old_row JSONB,
  new_row JSONB,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at TIMESTAMPTZ,
  attempts INT NOT NULL DEFAULT 0,
  last_error TEXT,
  dead_letter BOOLEAN NOT NULL DEFAULT false
);

CREATE INDEX IF NOT EXISTS idx_ontology_outbox_pending
  ON ontology_outbox(id) WHERE processed_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_ontology_outbox_processed_at
  ON ontology_outbox(processed_at);
CREATE INDEX IF NOT EXISTS idx_ontology_outbox_dead_letter
  ON ontology_outbox(dead_letter) WHERE dead_letter = true;

CREATE TABLE IF NOT EXISTS ontology_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
INSERT INTO ontology_settings (key, value) VALUES ('outbox_enabled', 'false')
  ON CONFLICT (key) DO NOTHING;

CREATE OR REPLACE FUNCTION sse_ontology_outbox_trigger() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  enabled TEXT;
  forbidden TEXT[] := ARRAY[
    'password_hash', 'phone', 'email',
    'storage_key', 'storage_bucket', 'ocr_result', 'verification_result'
  ];
BEGIN
  SELECT value INTO enabled FROM ontology_settings WHERE key = 'outbox_enabled';
  IF COALESCE(enabled, 'false') <> 'true' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  INSERT INTO ontology_outbox(table_name, op, row_id, old_row, new_row)
  VALUES (
    TG_TABLE_NAME,
    TG_OP,
    COALESCE(NEW.id, OLD.id),
    CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE to_jsonb(OLD) - forbidden END,
    CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE to_jsonb(NEW) - forbidden END
  );
  RETURN COALESCE(NEW, OLD);
END;
$$;

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['users','expense_categories','expense_reports','expense_items','invoices','approval_rules','approval_records','payment_receipts']
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_%s_ontology_outbox ON %I', t, t);
    EXECUTE format('CREATE TRIGGER trg_%s_ontology_outbox AFTER INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION sse_ontology_outbox_trigger()', t, t);
  END LOOP;
END $$;

-- Trigger function is SECURITY DEFINER, so the application role does not need
-- INSERT on ontology_outbox. Keep explicit grants for tools/tests anyway.
-- Migrations run as the application role in this repo, so some of these are
-- advisory in environments where the role already owns the tables.
GRANT SELECT, INSERT ON ontology_outbox TO CURRENT_USER;
GRANT UPDATE ON ontology_settings, ontology_projector_state TO CURRENT_USER;
