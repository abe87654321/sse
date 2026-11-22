-- P1-9: real departments with normalized users.department_id
-- Forward-only migration. To roll back, recreate users.department and backfill
-- from departments.name before dropping the table.

CREATE TABLE IF NOT EXISTS departments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  is_protected BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO departments (name, is_protected)
VALUES ('未分配', true)
ON CONFLICT (name) DO NOTHING;

INSERT INTO departments (name)
SELECT DISTINCT TRIM(department)
FROM users
WHERE department IS NOT NULL AND TRIM(department) <> ''
ON CONFLICT (name) DO NOTHING;

ALTER TABLE users ADD COLUMN department_id UUID;

UPDATE users u
SET department_id = d.id
FROM departments d
WHERE d.name = TRIM(u.department);

UPDATE users
SET department_id = (SELECT id FROM departments WHERE name = '未分配')
WHERE department_id IS NULL;

ALTER TABLE users ALTER COLUMN department_id SET NOT NULL;

ALTER TABLE users
  ADD CONSTRAINT fk_users_department
  FOREIGN KEY (department_id) REFERENCES departments(id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS idx_users_department_id ON users(department_id);

ALTER TABLE users DROP COLUMN department;

-- mcp_api_keys.department was only used as a dead fallback; the user row is
-- the single source of truth for role and department.
ALTER TABLE mcp_api_keys DROP COLUMN IF EXISTS department;

CREATE OR REPLACE FUNCTION sse_departments_protect() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' AND OLD.is_protected THEN
    RAISE EXCEPTION 'protected department cannot be deleted';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF OLD.is_protected THEN
      RAISE EXCEPTION 'protected department cannot be modified';
    END IF;
    IF NEW.is_protected IS DISTINCT FROM OLD.is_protected THEN
      RAISE EXCEPTION 'is_protected cannot be changed';
    END IF;
    NEW.updated_at := NOW();
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_departments_protect ON departments;
CREATE TRIGGER trg_departments_protect
  BEFORE UPDATE OR DELETE ON departments
  FOR EACH ROW EXECUTE FUNCTION sse_departments_protect();
