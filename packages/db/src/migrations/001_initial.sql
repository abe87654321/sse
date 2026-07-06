CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================
-- 用户表
-- ============================================================
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  phone TEXT NOT NULL UNIQUE,
  email TEXT,
  department TEXT NOT NULL,
  role TEXT NOT NULL,
  parent_id UUID REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'active',
  password_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- 费用类别表
-- ============================================================
CREATE TABLE expense_categories (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL UNIQUE,
  sort_order INT NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true
);

INSERT INTO expense_categories (name, sort_order) VALUES
  ('交通', 1),
  ('住宿', 2),
  ('餐饮', 3),
  ('招待', 4),
  ('办公用品', 5),
  ('通讯', 6),
  ('培训', 7),
  ('其他', 8)
ON CONFLICT (name) DO NOTHING;

-- ============================================================
-- 报销单表
-- ============================================================
CREATE TABLE expense_reports (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  serial_no TEXT NOT NULL UNIQUE,
  user_id UUID NOT NULL REFERENCES users(id),
  title TEXT NOT NULL,
  total_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'draft',
  current_step INT NOT NULL DEFAULT 0,
  submitted_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_expense_reports_user_id ON expense_reports(user_id);
CREATE INDEX idx_expense_reports_status ON expense_reports(status);
CREATE INDEX idx_expense_reports_serial_no ON expense_reports(serial_no);
CREATE INDEX idx_expense_reports_created_at ON expense_reports(created_at);

-- ============================================================
-- 报销明细表
-- ============================================================
CREATE TABLE expense_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  report_id UUID NOT NULL REFERENCES expense_reports(id) ON DELETE CASCADE,
  category_id UUID NOT NULL REFERENCES expense_categories(id),
  amount DECIMAL(12,2) NOT NULL,
  expense_date DATE NOT NULL,
  description TEXT NOT NULL DEFAULT ''
);

CREATE INDEX idx_expense_items_report_id ON expense_items(report_id);
CREATE INDEX idx_expense_items_category_id ON expense_items(category_id);

-- ============================================================
-- 发票表 (存储元信息，文件存 MinIO)
-- ============================================================
CREATE TABLE invoices (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  item_id UUID NOT NULL REFERENCES expense_items(id) ON DELETE CASCADE,
  file_name TEXT NOT NULL,
  file_format TEXT NOT NULL,
  file_size INT NOT NULL,
  storage_key TEXT NOT NULL,
  storage_bucket TEXT NOT NULL,
  checksum TEXT NOT NULL,
  ocr_result JSONB,
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_invoices_item_id ON invoices(item_id);

-- ============================================================
-- 审批规则表
-- ============================================================
CREATE TABLE approval_rules (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  min_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
  max_amount DECIMAL(12,2) NOT NULL DEFAULT 999999.99,
  category_ids TEXT[],
  approval_chain JSONB NOT NULL,
  priority INT NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true
);

INSERT INTO approval_rules (name, min_amount, max_amount, approval_chain, priority, is_active)
VALUES (
  '默认审批规则',
  0,
  10000,
  '[
    {"step": 1, "role": "dept_approver", "label": "部门审批"},
    {"step": 2, "role": "finance", "label": "财务审批"}
  ]'::jsonb,
  1,
  true
) ON CONFLICT DO NOTHING;

-- ============================================================
-- 审批记录表
-- ============================================================
CREATE TABLE approval_records (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  report_id UUID NOT NULL REFERENCES expense_reports(id) ON DELETE CASCADE,
  step INT NOT NULL,
  approver_id UUID NOT NULL REFERENCES users(id),
  step_started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  result TEXT NOT NULL DEFAULT 'pending',
  comment TEXT,
  approved_at TIMESTAMPTZ,
  reminder_sent_at TIMESTAMPTZ,
  escalated_at TIMESTAMPTZ
);

CREATE INDEX idx_approval_records_report_id ON approval_records(report_id);
CREATE INDEX idx_approval_records_approver_id ON approval_records(approver_id);
CREATE INDEX idx_approval_records_result ON approval_records(result);

-- ============================================================
-- 通知日志表
-- ============================================================
CREATE TABLE notification_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  report_id UUID NOT NULL REFERENCES expense_reports(id) ON DELETE CASCADE,
  recipient_id UUID NOT NULL REFERENCES users(id),
  channel TEXT NOT NULL,
  trigger_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  sent_at TIMESTAMPTZ,
  error_message TEXT
);

CREATE INDEX idx_notification_logs_report_id ON notification_logs(report_id);
CREATE INDEX idx_notification_logs_recipient_id ON notification_logs(recipient_id);

-- ============================================================
-- 默认管理员账号 (密码: admin123)
-- ============================================================
INSERT INTO users (name, phone, department, role, password_hash)
VALUES (
  '系统管理员',
  '13800000000',
  '管理部',
  'admin',
  '$2b$10$CrmgV1BBcfaDFF7m5uIUf.5zk/JK8BvMgUP4M5Ock0KOgAmZDvgMq'
) ON CONFLICT (phone) DO NOTHING;

-- ============================================================
-- updated_at 自动更新触发器
-- ============================================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_expense_reports_updated_at BEFORE UPDATE ON expense_reports
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
