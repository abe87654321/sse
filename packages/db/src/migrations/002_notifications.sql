-- 修改 notification_logs 表，适应新模型
ALTER TABLE notification_logs
  ADD COLUMN IF NOT EXISTS user_id UUID,
  ADD COLUMN IF NOT EXISTS type text,
  ADD COLUMN IF NOT EXISTS title text,
  ADD COLUMN IF NOT EXISTS body text,
  ADD COLUMN IF NOT EXISTS read_at timestamptz,
  ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();

-- migration: populate user_id from recipient_id if exists
UPDATE notification_logs SET user_id = recipient_id::UUID WHERE recipient_id IS NOT NULL AND user_id IS NULL;

-- 新增渠道送达明细表
CREATE TABLE IF NOT EXISTS notification_deliveries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  notification_id UUID NOT NULL REFERENCES notification_logs(id) ON DELETE CASCADE,
  channel text NOT NULL CHECK (channel IN ('in_app', 'sms', 'email')),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('sent', 'failed', 'skipped', 'pending')),
  error_message text,
  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_deliveries_notification ON notification_deliveries(notification_id);

-- 管理员广播消息表
CREATE TABLE IF NOT EXISTS system_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  body text NOT NULL,
  body_ai text,
  body_ai_instruction text,
  target_roles text[] DEFAULT '{}',
  target_user_ids UUID[] DEFAULT '{}',
  sender_id UUID NOT NULL REFERENCES users(id),
  delivery_channels text[] DEFAULT '{}',
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'sent')),
  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_system_messages_status ON system_messages(status);
CREATE INDEX IF NOT EXISTS idx_system_messages_sender ON system_messages(sender_id);

-- 用户通知偏好字段
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS notify_prefs jsonb DEFAULT '{
    "sms": {"reminder": true, "escalation": true, "rejected": true, "paid": false},
    "email": {"rejected": true, "paid": false},
    "broadcast": true,
    "in_app": {"rejected": true, "paid": true, "broadcast": true}
  }'::jsonb;
