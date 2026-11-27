-- 028: project department approver assignments as sse:approverOf edges.
--
-- Plan A: no separate entity for the assignment table. The users projection
-- emits Person -> Department edges from the enriched users payload, and the
-- assignment table only exists to trigger a users re-projection.

CREATE OR REPLACE FUNCTION sse_ontology_user_payload(p_user users) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  forbidden TEXT[] := ARRAY[
    'password_hash', 'phone', 'email',
    'storage_key', 'storage_bucket', 'ocr_result', 'verification_result',
    'payment_comment', 'avatar_url'
  ];
  payload JSONB;
BEGIN
  payload := to_jsonb(p_user) - forbidden;
  payload := payload || jsonb_build_object(
    'department',
    COALESCE((SELECT name FROM departments WHERE id = p_user.department_id), '未分配'),
    'approver_departments',
    COALESCE((
      SELECT json_agg(d.name ORDER BY d.name)
        FROM department_approvers da
        JOIN departments d ON d.id = da.department_id
       WHERE da.user_id = p_user.id
    ), '[]'::json)
  );
  RETURN payload;
END;
$$;

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
    IF TG_TABLE_NAME = 'users' THEN
      old_payload := sse_ontology_user_payload(OLD);
    ELSE
      old_payload := to_jsonb(OLD) - forbidden;
    END IF;
  END IF;

  IF TG_OP <> 'DELETE' THEN
    IF TG_TABLE_NAME = 'users' THEN
      new_payload := sse_ontology_user_payload(NEW);
    ELSE
      new_payload := to_jsonb(NEW) - forbidden;
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

-- Assignment changes must re-project the affected user. Emit a synthetic
-- users UPDATE so the projector replaces that person's approverOf edges.
CREATE OR REPLACE FUNCTION sse_department_approvers_outbox_trigger() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  enabled TEXT;
  u users%ROWTYPE;
BEGIN
  SELECT value INTO enabled FROM ontology_settings WHERE key = 'outbox_enabled';
  IF COALESCE(enabled, 'false') <> 'true' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  SELECT * INTO u FROM users WHERE id = COALESCE(NEW.user_id, OLD.user_id);
  -- Soft-deleted or removed users are projected by the users triggers instead.
  IF NOT FOUND OR u.deleted_at IS NOT NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  INSERT INTO ontology_outbox(table_name, op, row_id, old_row, new_row)
  VALUES ('users', 'UPDATE', u.id, NULL, sse_ontology_user_payload(u));
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_department_approvers_ontology_outbox ON department_approvers;
CREATE TRIGGER trg_department_approvers_ontology_outbox
  AFTER INSERT OR UPDATE OR DELETE ON department_approvers
  FOR EACH ROW EXECUTE FUNCTION sse_department_approvers_outbox_trigger();
