-- Multi-department approver: one user may approve several departments, but each
-- department has exactly one approver (PRIMARY KEY on department_id).
-- Forward-only. Rollback must be written by hand.

CREATE TABLE IF NOT EXISTS department_approvers (
  department_id UUID PRIMARY KEY REFERENCES departments(id) ON DELETE CASCADE,
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  assigned_by   UUID REFERENCES users(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_department_approvers_user
  ON department_approvers(user_id);

-- Backfill legacy dept_approver users by their home department. If a department
-- has several legacy approvers, keep the earliest created and leave the others
-- for manual normalization (see design doc 2026-11-27).
INSERT INTO department_approvers (department_id, user_id)
SELECT DISTINCT ON (u.department_id) u.department_id, u.id
FROM users u
WHERE u.role = 'dept_approver' AND u.status = 'active'
ORDER BY u.department_id, u.created_at ASC, u.id ASC
ON CONFLICT (department_id) DO NOTHING;

CREATE OR REPLACE FUNCTION sse_department_approvers_touch() RETURNS trigger AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_department_approvers_touch ON department_approvers;
CREATE TRIGGER trg_department_approvers_touch
  BEFORE UPDATE ON department_approvers
  FOR EACH ROW EXECUTE FUNCTION sse_department_approvers_touch();
