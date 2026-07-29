ALTER TABLE expense_reports
  ADD COLUMN paid_at TIMESTAMPTZ,
  ADD COLUMN paid_by UUID REFERENCES users(id),
  ADD COLUMN payment_ref VARCHAR(100);
