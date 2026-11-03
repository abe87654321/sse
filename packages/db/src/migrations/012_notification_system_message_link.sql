ALTER TABLE notification_logs
  ADD COLUMN IF NOT EXISTS system_message_id UUID REFERENCES system_messages(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_notification_logs_system_message
  ON notification_logs(system_message_id);
