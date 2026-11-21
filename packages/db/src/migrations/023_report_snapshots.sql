CREATE TABLE IF NOT EXISTS report_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id UUID NOT NULL,
  snapshot_type TEXT NOT NULL
    CHECK (snapshot_type IN ('submit', 'approve', 'reject', 'pay', 'backfill')),
  schema_version INT NOT NULL DEFAULT 1,
  approval_record_id UUID,
  step INT,
  actor_type TEXT NOT NULL DEFAULT 'user',
  actor_id UUID,
  actor_role TEXT,
  payload JSONB NOT NULL,
  content_hash TEXT NOT NULL,
  legacy BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_report_snapshots_report
  ON report_snapshots (report_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_report_snapshots_type
  ON report_snapshots (snapshot_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_report_snapshots_approval_record
  ON report_snapshots (approval_record_id);
CREATE INDEX IF NOT EXISTS idx_report_snapshots_actor
  ON report_snapshots (actor_id, created_at DESC);

CREATE OR REPLACE FUNCTION sse_report_snapshots_append_only()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'report_snapshots is append-only (%); insert a new snapshot instead', TG_OP
    USING ERRCODE = '55000';
END;
$$;

DROP TRIGGER IF EXISTS trg_report_snapshots_append_only ON report_snapshots;
CREATE TRIGGER trg_report_snapshots_append_only
  BEFORE UPDATE OR DELETE ON report_snapshots
  FOR EACH ROW
  EXECUTE FUNCTION sse_report_snapshots_append_only();

INSERT INTO report_snapshots (
  report_id,
  snapshot_type,
  schema_version,
  actor_type,
  payload,
  content_hash,
  legacy,
  created_at
)
SELECT
  p.report_id,
  'backfill',
  1,
  'system',
  p.payload,
  encode(sha256(convert_to(p.payload::text, 'UTF8')), 'hex'),
  true,
  NOW()
FROM (
  SELECT
    r.id AS report_id,
    jsonb_build_object(
      'schemaVersion', 1,
      'snapshotType', 'backfill',
      'capturedAt', to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'legacy', true,
      'report', jsonb_build_object(
        'id', r.id,
        'serialNo', r.serial_no,
        'title', r.title,
        'description', r.description,
        'status', r.status,
        'currentStep', r.current_step,
        'totalAmount', r.total_amount,
        'userId', r.user_id,
        'applicantName', u.name,
        'applicantDepartment', u.department,
        'submittedAt', r.submitted_at,
        'completedAt', r.completed_at,
        'paidAt', r.paid_at,
        'paidBy', r.paid_by,
        'paymentRef', r.payment_ref,
        'paymentComment', r.payment_comment,
        'paymentUpdatedAt', r.payment_updated_at,
        'paymentUpdatedBy', r.payment_updated_by,
        'createdAt', r.created_at,
        'updatedAt', r.updated_at
      ),
      'items', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'id', ei.id,
          'categoryId', ei.category_id,
          'categoryName', ec.name,
          'amount', ei.amount,
          'expenseDate', ei.expense_date,
          'description', ei.description,
          'invoices', COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
              'id', i.id,
              'fileName', i.file_name,
              'fileFormat', i.file_format,
              'fileSize', i.file_size,
              'checksum', i.checksum,
              'invoiceNo', i.invoice_no,
              'verificationStatus', i.verification_status,
              'verificationResult', i.verification_result,
              'verifiedAt', i.verified_at,
              'uploadedAt', i.uploaded_at
            ) ORDER BY i.uploaded_at)
            FROM invoices i
            WHERE i.item_id = ei.id
          ), '[]'::jsonb)
        ) ORDER BY ei.expense_date, ei.id)
        FROM expense_items ei
        JOIN expense_categories ec ON ec.id = ei.category_id
        WHERE ei.report_id = r.id
      ), '[]'::jsonb),
      'verification', jsonb_build_object(
        'aggregateStatus', (
          SELECT CASE
            WHEN COUNT(*) = 0 THEN 'no_invoices'
            WHEN bool_or(i.verification_status = 'warning') THEN 'warning'
            WHEN bool_or(i.verification_status = 'error') THEN 'error'
            WHEN bool_or(i.verification_status IN ('unverified', 'pending')) THEN 'unverified'
            ELSE 'pass'
          END
          FROM invoices i
          JOIN expense_items ei ON ei.id = i.item_id
          WHERE ei.report_id = r.id
        ),
        'acknowledged', false
      ),
      'approval', jsonb_build_object(
        'rule', NULL,
        'records', COALESCE((
          SELECT jsonb_agg(jsonb_build_object(
            'id', ar.id,
            'step', ar.step,
            'approverId', ar.approver_id,
            'approverName', au.name,
            'result', ar.result,
            'comment', ar.comment,
            'stepStartedAt', ar.step_started_at,
            'approvedAt', ar.approved_at,
            'verificationAcknowledged', COALESCE(ar.verification_acknowledged, false)
          ) ORDER BY ar.step, ar.step_started_at)
          FROM approval_records ar
          LEFT JOIN users au ON au.id = ar.approver_id
          WHERE ar.report_id = r.id
        ), '[]'::jsonb),
        'action', NULL
      ),
      'payment', CASE WHEN r.status = 'paid' THEN jsonb_build_object(
        'paidAt', r.paid_at,
        'paidBy', r.paid_by,
        'paidByName', pu.name,
        'paymentRef', r.payment_ref,
        'paymentComment', r.payment_comment,
        'receipt', (
          SELECT jsonb_build_object(
            'id', pr.id,
            'fileName', pr.file_name,
            'fileFormat', pr.file_format,
            'checksum', pr.checksum,
            'verificationStatus', pr.verification_status,
            'verificationResult', pr.verification_result,
            'verifiedAt', pr.verified_at
          )
          FROM payment_receipts pr
          WHERE pr.report_id = r.id
        )
      ) ELSE NULL END
    ) AS payload
  FROM expense_reports r
  JOIN users u ON u.id = r.user_id
  LEFT JOIN users pu ON pu.id = r.paid_by
  WHERE r.status <> 'draft'
) p;
