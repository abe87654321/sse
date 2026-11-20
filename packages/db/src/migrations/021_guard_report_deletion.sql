CREATE OR REPLACE FUNCTION sse_guard_expense_report_delete()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF COALESCE(current_setting('sse.allow_destructive_delete', true), 'off') = 'on' THEN
    RETURN OLD;
  END IF;

  IF OLD.status <> 'draft' OR EXISTS (
    SELECT 1 FROM approval_records WHERE report_id = OLD.id
  ) THEN
    RAISE EXCEPTION 'expense report % cannot be physically deleted (status %)', OLD.id, OLD.status
      USING ERRCODE = '23514',
            HINT = 'Only drafts without approval evidence may be deleted';
  END IF;

  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_expense_report_delete ON expense_reports;
CREATE TRIGGER trg_guard_expense_report_delete
  BEFORE DELETE ON expense_reports
  FOR EACH ROW
  EXECUTE FUNCTION sse_guard_expense_report_delete();

ALTER TABLE approval_records
  DROP CONSTRAINT IF EXISTS approval_records_report_id_fkey;
ALTER TABLE approval_records
  ADD CONSTRAINT approval_records_report_id_fkey
  FOREIGN KEY (report_id) REFERENCES expense_reports(id) ON DELETE RESTRICT;
