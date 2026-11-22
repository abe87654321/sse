-- P1-9 phase 2: keep the ontology outbox payload compatible with the
-- normalized users table. Projection code still reads `department` by name.

CREATE OR REPLACE FUNCTION sse_ontology_outbox_trigger() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  enabled TEXT;
  forbidden TEXT[] := ARRAY[
    'password_hash', 'phone', 'email',
    'storage_key', 'storage_bucket', 'ocr_result', 'verification_result',
    'payment_comment', 'avatar_url'
  ];
  old_payload JSONB;
  new_payload JSONB;
BEGIN
  SELECT value INTO enabled FROM ontology_settings WHERE key = 'outbox_enabled';
  IF COALESCE(enabled, 'false') <> 'true' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  IF TG_OP <> 'INSERT' THEN
    old_payload := to_jsonb(OLD) - forbidden;
    IF TG_TABLE_NAME = 'users' THEN
      old_payload := old_payload || jsonb_build_object(
        'department',
        COALESCE((SELECT name FROM departments WHERE id = OLD.department_id), '未分配')
      );
    END IF;
  END IF;

  IF TG_OP <> 'DELETE' THEN
    new_payload := to_jsonb(NEW) - forbidden;
    IF TG_TABLE_NAME = 'users' THEN
      new_payload := new_payload || jsonb_build_object(
        'department',
        COALESCE((SELECT name FROM departments WHERE id = NEW.department_id), '未分配')
      );
    END IF;
  END IF;

  INSERT INTO ontology_outbox(table_name, op, row_id, old_row, new_row)
  VALUES (
    TG_TABLE_NAME,
    TG_OP,
    COALESCE(NEW.id, OLD.id),
    old_payload,
    new_payload
  );
  RETURN COALESCE(NEW, OLD);
END;
$$;
