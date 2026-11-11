-- Report-level description used by the web form, CreateReportDto and mapReport.
-- Nullable to match PgExpenseRepo.create (`dto.description || null`).
ALTER TABLE expense_reports ADD COLUMN IF NOT EXISTS description TEXT;
