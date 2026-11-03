ALTER TABLE users ALTER COLUMN notify_prefs SET DEFAULT '{
  "sms": {"reminder": true, "escalation": true, "rejected": false, "paid": true},
  "email": {"reminder": true, "escalation": true, "rejected": true, "paid": false},
  "broadcast": true,
  "in_app": {"rejected": true, "paid": true, "broadcast": true}
}'::jsonb;
