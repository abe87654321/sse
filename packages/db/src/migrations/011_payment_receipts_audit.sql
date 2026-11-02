CREATE TABLE IF NOT EXISTS payment_receipts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  report_id UUID NOT NULL UNIQUE REFERENCES expense_reports(id) ON DELETE CASCADE,
  file_name TEXT NOT NULL,
  file_format TEXT NOT NULL,
  file_size INT NOT NULL,
  storage_key TEXT NOT NULL,
  storage_bucket TEXT NOT NULL,
  checksum TEXT NOT NULL,
  uploaded_by UUID REFERENCES users(id),
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ocr_result JSONB,
  verification_status TEXT NOT NULL DEFAULT 'pending',
  verification_result JSONB,
  verified_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_payment_receipts_checksum ON payment_receipts(checksum);
CREATE INDEX IF NOT EXISTS idx_payment_receipts_status ON payment_receipts(verification_status);

CREATE TABLE IF NOT EXISTS payment_audit_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  report_id UUID NOT NULL REFERENCES expense_reports(id) ON DELETE CASCADE,
  action TEXT NOT NULL,
  operator_id UUID REFERENCES users(id),
  reason TEXT,
  before JSONB,
  after JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_payment_audit_logs_report_id ON payment_audit_logs(report_id);

ALTER TABLE expense_reports
  ADD COLUMN IF NOT EXISTS payment_comment TEXT,
  ADD COLUMN IF NOT EXISTS payment_updated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS payment_updated_by UUID REFERENCES users(id);
