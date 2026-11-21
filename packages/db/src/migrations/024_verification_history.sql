CREATE TABLE IF NOT EXISTS verification_runs (
  id UUID PRIMARY KEY,
  report_id UUID NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('invoice', 'payment_receipt')),
  event_type TEXT NOT NULL CHECK (event_type IN ('verify', 'invalidate', 'backfill')),
  cause TEXT NOT NULL CHECK (cause IN (
    'manual', 'force_ocr', 'items_updated', 'invoice_uploaded',
    'receipt_replaced', 'system', 'backfill'
  )),
  reason TEXT,
  actor_type TEXT NOT NULL DEFAULT 'user' CHECK (actor_type IN ('user', 'system')),
  actor_id UUID,
  actor_role TEXT,
  status TEXT NOT NULL CHECK (status IN (
    'pass', 'warning', 'unverified', 'error', 'no_invoices', 'invalidated'
  )),
  summary JSONB NOT NULL,
  content_hash TEXT NOT NULL,
  legacy BOOLEAN NOT NULL DEFAULT false,
  checked_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS verification_run_items (
  id UUID PRIMARY KEY,
  run_id UUID NOT NULL,
  report_id UUID NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('invoice', 'payment_receipt')),
  subject_id UUID NOT NULL,
  item_id UUID,
  file_name TEXT,
  status TEXT NOT NULL CHECK (status IN (
    'pass', 'warning', 'unverified', 'error', 'no_invoices', 'invalidated'
  )),
  result JSONB NOT NULL,
  content_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_verification_runs_report
  ON verification_runs (report_id, checked_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_verification_runs_kind
  ON verification_runs (kind, checked_at DESC);
CREATE INDEX IF NOT EXISTS idx_verification_runs_actor
  ON verification_runs (actor_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_verification_run_items_run
  ON verification_run_items (run_id);
CREATE INDEX IF NOT EXISTS idx_verification_run_items_subject
  ON verification_run_items (subject_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_verification_run_items_report
  ON verification_run_items (report_id, kind, created_at DESC);

CREATE OR REPLACE FUNCTION sse_verification_runs_append_only()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'verification_runs is append-only (%); insert a new run instead', TG_OP
    USING ERRCODE = '55000';
END;
$$;

DROP TRIGGER IF EXISTS trg_verification_runs_append_only ON verification_runs;
CREATE TRIGGER trg_verification_runs_append_only
  BEFORE UPDATE OR DELETE ON verification_runs
  FOR EACH ROW
  EXECUTE FUNCTION sse_verification_runs_append_only();

CREATE OR REPLACE FUNCTION sse_verification_run_items_append_only()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'verification_run_items is append-only (%); insert a new item instead', TG_OP
    USING ERRCODE = '55000';
END;
$$;

DROP TRIGGER IF EXISTS trg_verification_run_items_append_only ON verification_run_items;
CREATE TRIGGER trg_verification_run_items_append_only
  BEFORE UPDATE OR DELETE ON verification_run_items
  FOR EACH ROW
  EXECUTE FUNCTION sse_verification_run_items_append_only();

WITH invoice_groups AS (
  SELECT
    ei.report_id,
    COALESCE(MAX(i.verified_at), NOW()) AS checked_at,
    CASE
      WHEN bool_or(i.verification_status = 'warning') THEN 'warning'
      WHEN bool_or(i.verification_status = 'error') THEN 'error'
      WHEN bool_or(i.verification_status IN ('unverified', 'pending')) THEN 'unverified'
      ELSE 'pass'
    END AS status,
    COUNT(*)::int AS total,
    COUNT(*) FILTER (WHERE i.verification_status = 'pass')::int AS pass_count,
    COUNT(*) FILTER (WHERE i.verification_status = 'warning')::int AS warning_count,
    COUNT(*) FILTER (WHERE i.verification_status = 'unverified')::int AS unverified_count
  FROM invoices i
  JOIN expense_items ei ON ei.id = i.item_id
  WHERE i.verification_result IS NOT NULL
  GROUP BY ei.report_id
),
invoice_run_source AS (
  SELECT
    report_id,
    checked_at,
    status,
    jsonb_build_object(
      'status', status,
      'checkedAt', checked_at,
      'summary', '历史回填（上线前最后一次核对结果）',
      'counts', jsonb_build_object(
        'total', total,
        'pass', pass_count,
        'warning', warning_count,
        'unverified', unverified_count,
        'pending', 0
      ),
      'checks', '[]'::jsonb,
      'legacy', true
    ) AS summary
  FROM invoice_groups
),
invoice_runs AS (
  INSERT INTO verification_runs (
    id, report_id, kind, event_type, cause, actor_type, status,
    summary, content_hash, legacy, checked_at, created_at
  )
  SELECT
    gen_random_uuid(), report_id, 'invoice', 'backfill', 'backfill', 'system', status,
    summary,
    encode(sha256(convert_to(summary::text, 'UTF8')), 'hex'),
    true,
    checked_at,
    NOW()
  FROM invoice_run_source
  RETURNING id, report_id
)
INSERT INTO verification_run_items (
  id, run_id, report_id, kind, subject_id, item_id, file_name, status, result,
  content_hash, created_at
)
SELECT
  gen_random_uuid(),
  run_id,
  report_id,
  'invoice',
  subject_id,
  item_id,
  file_name,
  status,
  result,
  encode(sha256(convert_to(result::text, 'UTF8')), 'hex'),
  NOW()
FROM (
  SELECT
    r.id AS run_id,
    ei.report_id,
    i.id AS subject_id,
    i.item_id,
    i.file_name,
    CASE WHEN i.verification_status = 'pending' THEN 'unverified' ELSE i.verification_status END AS status,
    i.verification_result AS result
  FROM invoices i
  JOIN expense_items ei ON ei.id = i.item_id
  JOIN invoice_runs r ON r.report_id = ei.report_id
  WHERE i.verification_result IS NOT NULL
) invoice_items;

WITH receipt_source AS (
  SELECT
    pr.report_id,
    pr.id,
    pr.file_name,
    pr.verification_status,
    pr.verification_result,
    COALESCE(pr.verified_at, NOW()) AS checked_at,
    jsonb_build_object(
      'status', CASE WHEN pr.verification_status = 'pending' THEN 'unverified' ELSE pr.verification_status END,
      'checkedAt', COALESCE(pr.verified_at, NOW()),
      'summary', '历史回填（上线前最后一次核对结果）',
      'checks', COALESCE(pr.verification_result -> 'checks', '[]'::jsonb),
      'legacy', true
    ) AS summary
  FROM payment_receipts pr
  WHERE pr.verification_result IS NOT NULL
),
receipt_runs AS (
  INSERT INTO verification_runs (
    id, report_id, kind, event_type, cause, actor_type, status,
    summary, content_hash, legacy, checked_at, created_at
  )
  SELECT
    gen_random_uuid(), report_id, 'payment_receipt', 'backfill', 'backfill', 'system',
    CASE WHEN verification_status = 'pending' THEN 'unverified' ELSE verification_status END,
    summary,
    encode(sha256(convert_to(summary::text, 'UTF8')), 'hex'),
    true,
    checked_at,
    NOW()
  FROM receipt_source
  RETURNING id, report_id
)
INSERT INTO verification_run_items (
  id, run_id, report_id, kind, subject_id, item_id, file_name, status, result,
  content_hash, created_at
)
SELECT
  gen_random_uuid(),
  run_id,
  report_id,
  'payment_receipt',
  subject_id,
  NULL,
  file_name,
  status,
  result,
  encode(sha256(convert_to(result::text, 'UTF8')), 'hex'),
  NOW()
FROM (
  SELECT
    r.id AS run_id,
    s.report_id,
    s.id AS subject_id,
    s.file_name,
    CASE WHEN s.verification_status = 'pending' THEN 'unverified' ELSE s.verification_status END AS status,
    s.verification_result AS result
  FROM receipt_source s
  JOIN receipt_runs r ON r.report_id = s.report_id
) receipt_items;
