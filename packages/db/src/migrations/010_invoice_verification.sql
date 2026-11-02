ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS invoice_no TEXT,
  ADD COLUMN IF NOT EXISTS verification_status TEXT NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS verification_result JSONB,
  ADD COLUMN IF NOT EXISTS verified_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_invoices_invoice_no
  ON invoices(invoice_no)
  WHERE invoice_no IS NOT NULL;

ALTER TABLE approval_records
  ADD COLUMN IF NOT EXISTS verification_acknowledged BOOLEAN NOT NULL DEFAULT false;
