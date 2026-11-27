-- 构造覆盖所有业务域的测试数据
-- 对应：用户管理 / 系统管理 / 消息管理 / 推理规则 / 报销单据 / 发票 / 支付回单 / 审计

-- ========== 全量清空（按 FK 逆序，避免外键约束冲突） ==========
-- 注意：单纯 DELETE FROM users 会被 system_messages.sender_id 的 FK 拦住。
-- 必须先删子表，再删父表。
DELETE FROM notification_deliveries;
DELETE FROM notification_logs;
DELETE FROM system_messages;
DELETE FROM payment_audit_logs;
DELETE FROM payment_receipts;
DELETE FROM approval_records;
DELETE FROM invoices;
DELETE FROM expense_items;
DELETE FROM expense_reports;
DELETE FROM ontology_snapshots;
DELETE FROM mcp_api_keys;
DELETE FROM identity_mappings;
DELETE FROM reasoning_rules;
DELETE FROM approval_rules;
DELETE FROM expense_categories;
DELETE FROM users;

-- ========== 用户管理 ==========

INSERT INTO users (id, name, phone, email, department, role, parent_id, status, password_hash, notify_prefs, avatar_url)
VALUES
('11111111-1111-1111-1111-111111111111','系统管理员','13800000000','admin@sse.local','管理部','admin',NULL,'active','$2b$10$CrmgV1BBcfaDFF7m5uIUf.5zk/JK8BvMgUP4M5Ock0KOgAmZDvgMq',NULL,NULL),
('22222222-2222-2222-2222-222222222222','张经理','13900000001','zhang@sse.local','研发部','manager',NULL,'active','$2b$10$hash2',NULL,'avatars/22222222-2222-2222-2222-222222222222_1700000000.png'),
('33333333-3333-3333-3333-333333333333','李员工','13900000002','li@sse.local','研发部','employee','22222222-2222-2222-2222-222222222222','active','$2b$10$hash3',NULL,NULL),
('44444444-4444-4444-4444-444444444444','王财务','13900000003','wang@sse.local','财务部','finance',NULL,'active','$2b$10$hash4',NULL,NULL),
('55555555-5555-5555-5555-555555555555','赵已删除','13900000004','zhao@sse.local','研发部','employee','22222222-2222-2222-2222-222222222222','inactive','$2b$10$hash5',NULL,NULL)
ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, phone=EXCLUDED.phone, email=EXCLUDED.email,
  department=EXCLUDED.department, role=EXCLUDED.role, parent_id=EXCLUDED.parent_id,
  status=EXCLUDED.status, password_hash=EXCLUDED.password_hash, avatar_url=EXCLUDED.avatar_url;

UPDATE users SET deleted_at = NOW() WHERE id = '55555555-5555-5555-5555-555555555555';

-- 通知偏好（JSONB）
UPDATE users SET notify_prefs = '{
  "sms": {"reminder": true, "escalation": true, "rejected": false, "paid": true},
  "email": {"reminder": true, "escalation": true, "rejected": true, "paid": false},
  "broadcast": true,
  "in_app": {"rejected": true, "paid": true, "broadcast": true}
}'::jsonb WHERE id = '33333333-3333-3333-3333-333333333333';

-- ========== 身份映射 ==========
INSERT INTO identity_mappings (id, local_user_id, external_id, source, external_metadata) VALUES
('aaaa1111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222222','wx-0001','wechat','{"nick":"张经理"}'),
('aaaa2222-2222-2222-2222-222222222222','33333333-3333-3333-3333-333333333333','wx-0002','wechat','{"nick":"李员工"}')
ON CONFLICT (id) DO NOTHING;

-- ========== 系统管理：费用类别 + 审批规则 ==========
-- seed 已插入 8 个标准类别（按 name 唯一），这里改用 name 对齐到固定 id，
-- 这样外键（expense_items.category_id）能稳定引用
UPDATE expense_categories SET id = 'c0000001-0000-0000-0000-000000000001' WHERE name = '交通';
UPDATE expense_categories SET id = 'c0000002-0000-0000-0000-000000000002' WHERE name = '住宿';
UPDATE expense_categories SET id = 'c0000003-0000-0000-0000-000000000003' WHERE name = '餐饮';
UPDATE expense_categories SET id = 'c0000004-0000-0000-0000-000000000004' WHERE name = '招待';

INSERT INTO expense_categories (id, name, sort_order, is_active) VALUES
('c0000001-0000-0000-0000-000000000001','交通',1,true),
('c0000002-0000-0000-0000-000000000002','住宿',2,true),
('c0000003-0000-0000-0000-000000000003','餐饮',3,true),
('c0000004-0000-0000-0000-000000000004','招待',4,true)
ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, sort_order=EXCLUDED.sort_order, is_active=EXCLUDED.is_active;

INSERT INTO approval_rules (id, name, min_amount, max_amount, category_ids, approval_chain, priority, is_active) VALUES
('a0000001-0000-0000-0000-000000000001','小额审批',0,1000,'{c0000001-0000-0000-0000-000000000001}','[{"step":1,"role":"dept_approver","label":"部门审批"}]'::jsonb,1,true),
('a0000002-0000-0000-0000-000000000002','大额审批',1000,100000,'{c0000002-0000-0000-0000-000000000002}','[{"step":1,"role":"dept_approver","label":"部门审批"},{"step":2,"role":"finance","label":"财务审批"}]'::jsonb,2,true)
ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, min_amount=EXCLUDED.min_amount,
  max_amount=EXCLUDED.max_amount, category_ids=EXCLUDED.category_ids,
  approval_chain=EXCLUDED.approval_chain, priority=EXCLUDED.priority, is_active=EXCLUDED.is_active;

-- ========== 系统管理：推理规则 ==========
INSERT INTO reasoning_rules (id, name, description, conditions, conclusion, priority, is_active) VALUES
('b6000001-0000-0000-0000-000000000001','差旅超标判定','金额超过标准时需要说明','{"type":"amount_exceeds","field":"total_amount","operator":">","value":3000}','{"action":"require_note","message":"金额超标，请说明原因"}'::jsonb,10,true),
('b6000002-0000-0000-0000-000000000002','餐饮类别校验','餐饮类必须附发票','{"type":"category","value":"餐饮"}','{"action":"require_invoice"}'::jsonb,5,true),
('b6000003-0000-0000-0000-000000000003','自动通过规则','小额自动通过','{"type":"amount_below","value":100}','{"action":"auto_approve"}'::jsonb,1,false)
ON CONFLICT (id) DO NOTHING;

-- ========== 报销单据 ==========
INSERT INTO expense_reports (id, serial_no, user_id, title, total_amount, status, current_step, submitted_at, completed_at, paid_at, paid_by, payment_ref, payment_comment)
VALUES
('e0000001-0000-0000-0000-000000000001','BX20260101001','33333333-3333-3333-3333-333333333333','北京出差',1500.00,'approved',2,NOW()-INTERVAL '10 days',NOW()-INTERVAL '8 days',NOW()-INTERVAL '7 days','44444444-4444-4444-4444-444444444444','PAY20260101','已打款'),
('e0000002-0000-0000-0000-000000000002','BX20260101002','33333333-3333-3333-3333-333333333333','客户招待',800.50,'pending',1,NOW()-INTERVAL '3 days',NULL,NULL,NULL,NULL,NULL),
('e0000003-0000-0000-0000-000000000003','BX20260101003','33333333-3333-3333-3333-333333333333','办公用品采购',200.00,'draft',0,NULL,NULL,NULL,NULL,NULL,NULL)
ON CONFLICT (id) DO NOTHING;

-- ========== 明细 + 发票 ==========
INSERT INTO expense_items (id, report_id, category_id, amount, expense_date, description) VALUES
('d0000001-0000-0000-0000-000000000001','e0000001-0000-0000-0000-000000000001','c0000002-0000-0000-0000-000000000002',1400.00,'2026-01-01','酒店住宿2晚'),
('d0000002-0000-0000-0000-000000000002','e0000001-0000-0000-0000-000000000001','c0000001-0000-0000-0000-000000000001',100.00,'2026-01-01','高铁票'),
('d0000003-0000-0000-0000-000000000003','e0000002-0000-0000-0000-000000000002','c0000004-0000-0000-0000-000000000004',800.50,'2026-01-03','客户晚餐')
ON CONFLICT (id) DO NOTHING;

INSERT INTO invoices (id, item_id, file_name, file_format, file_size, storage_key, storage_bucket, checksum, ocr_result, uploaded_at, invoice_no, verification_status, verification_result, verified_at)
VALUES
('f0000001-0000-0000-0000-000000000001','d0000001-0000-0000-0000-000000000001','hotel.pdf','pdf',2048,'invoices/d0000001-0000-0000-0000-000000000001_1700000001.pdf','invoices','abc123checksum1','{"invoiceNo":"INV001","amount":1400.00,"seller":"某酒店"}'::jsonb,NOW()-INTERVAL '10 days','INV001','verified','{"match":true}'::jsonb,NOW()-INTERVAL '9 days'),
('f0000002-0000-0000-0000-000000000002','d0000002-0000-0000-0000-000000000002','train.pdf','pdf',1536,'invoices/d0000002-0000-0000-0000-000000000002_1700000002.pdf','invoices','abc123checksum2','{"invoiceNo":"INV002","amount":100.00}'::jsonb,NOW()-INTERVAL '10 days','INV002','pending',NULL,NULL),
('f0000003-0000-0000-0000-000000000003','d0000003-0000-0000-0000-000000000003','dinner.jpg','jpg',4096,'invoices/d0000003-0000-0000-0000-000000000003_1700000003.jpg','invoices','abc123checksum3',NULL,NOW()-INTERVAL '3 days',NULL,'pending',NULL,NULL)
ON CONFLICT (id) DO NOTHING;

-- ========== 审批记录 ==========
INSERT INTO approval_records (id, report_id, step, approver_id, result, comment, approved_at, verification_acknowledged) VALUES
('a9000001-0000-0000-0000-000000000001','e0000001-0000-0000-0000-000000000001',1,'22222222-2222-2222-2222-222222222222','approved','同意',NOW()-INTERVAL '9 days',true),
('a9000002-0000-0000-0000-000000000002','e0000001-0000-0000-0000-000000000001',2,'44444444-4444-4444-4444-444444444444','approved','财务通过',NOW()-INTERVAL '8 days',true),
('a9000003-0000-0000-0000-000000000003','e0000002-0000-0000-0000-000000000002',1,'22222222-2222-2222-2222-222222222222','pending',NULL,NULL,false)
ON CONFLICT (id) DO NOTHING;

-- ========== 消息管理：广播消息 ==========
INSERT INTO system_messages (id, title, body, body_ai, body_ai_instruction, target_roles, target_user_ids, sender_id, delivery_channels, status, sent_at)
VALUES
('b7000001-0000-0000-0000-000000000001','本月报销截止日变更','原定每月25日，现改为每月20日。','【系统通知】本月报销截止日变更为每月20日，请及时提交。','简洁通知用户截止日变更','{employee,manager}','{33333333-3333-3333-3333-333333333333}','11111111-1111-1111-1111-111111111111','{in_app,sms}','sent',NOW()-INTERVAL '2 days'),
('b7000002-0000-0000-0000-000000000002','草稿消息草稿草稿','这是一条草稿','AI草稿内容','草稿指令','{employee}','{}','11111111-1111-1111-1111-111111111111','{in_app}','draft',NULL)
ON CONFLICT (id) DO NOTHING;

-- ========== 消息管理：通知日志 + 送达明细 ==========
INSERT INTO notification_logs (id, report_id, recipient_id, user_id, channel, trigger_type, status, sent_at, type, title, body, read_at, created_at, system_message_id)
VALUES
('b1000001-0000-0000-0000-000000000001','e0000001-0000-0000-0000-000000000001','22222222-2222-2222-2222-222222222222','22222222-2222-2222-2222-222222222222','in_app','reminder','sent',NOW()-INTERVAL '9 days','approval','您有一条待审批','BX20260101001 待审批',NULL,NOW()-INTERVAL '9 days',NULL),
('b1000002-0000-0000-0000-000000000002',NULL,'33333333-3333-3333-3333-333333333333','33333333-3333-3333-3333-333333333333','in_app','broadcast','sent',NOW()-INTERVAL '2 days','broadcast','系统公告','本月报销截止日变更',NOW()-INTERVAL '1 day',NOW()-INTERVAL '2 days','b7000001-0000-0000-0000-000000000001'),
('b1000003-0000-0000-0000-000000000003',NULL,NULL,'33333333-3333-3333-3333-333333333333','email','paid','failed',NULL,'payment','打款失败通知','BX20260101002 打款失败',NULL,NOW()-INTERVAL '1 day',NULL)
ON CONFLICT (id) DO NOTHING;

INSERT INTO notification_deliveries (id, notification_id, channel, status, sent_at, error_message) VALUES
('b2000001-0000-0000-0000-000000000001','b1000001-0000-0000-0000-000000000001','in_app','sent',NOW()-INTERVAL '9 days',NULL),
('b2000002-0000-0000-0000-000000000002','b1000001-0000-0000-0000-000000000001','sms','skipped',NULL,'用户关闭短信提醒'),
('b2000003-0000-0000-0000-000000000003','b1000003-0000-0000-0000-000000000003','email','failed',NULL,'SMTP connection refused')
ON CONFLICT (id) DO NOTHING;

-- ========== 支付回单 + 审计 ==========
INSERT INTO payment_receipts (id, report_id, file_name, file_format, file_size, storage_key, storage_bucket, checksum, uploaded_by, uploaded_at, ocr_result, verification_status, verification_result, verified_at)
VALUES
('b5000001-0000-0000-0000-000000000001','e0000001-0000-0000-0000-000000000001','receipt.pdf','pdf',3072,'payment-receipts/e0000001-0000-0000-0000-000000000001/1700000009.pdf','payment-receipts','receiptchecksum1','44444444-4444-4444-4444-444444444444',NOW()-INTERVAL '7 days','{"amount":1500.00}'::jsonb,'verified','{"match":true}'::jsonb,NOW()-INTERVAL '7 days')
ON CONFLICT (id) DO NOTHING;

INSERT INTO payment_audit_logs (id, report_id, action, operator_id, reason, before, after, created_at) VALUES
('b4000001-0000-0000-0000-000000000001','e0000001-0000-0000-0000-000000000001','mark_paid','44444444-4444-4444-4444-444444444444','财务打款','{"status":"approved","paidAt":null}'::jsonb,'{"status":"approved","paidAt":"2026-01-08"}'::jsonb,NOW()-INTERVAL '7 days'),
('b4000002-0000-0000-0000-000000000002','e0000001-0000-0000-0000-000000000001','upload_receipt','44444444-4444-4444-4444-444444444444','上传回单',NULL,'{"fileName":"receipt.pdf"}'::jsonb,NOW()-INTERVAL '7 days')
ON CONFLICT (id) DO NOTHING;

-- ========== 本体快照 ==========
INSERT INTO ontology_snapshots (id, graph, created_at) VALUES
('b3000001-0000-0000-0000-000000000001','{"nodes":[{"id":"person/2222","type":"Person","name":"张经理"},{"id":"report/BX20260101001","type":"ExpenseReport","amount":1500}],"edges":[]}'::jsonb,NOW()-INTERVAL '5 days')
ON CONFLICT (id) DO NOTHING;

-- ========== MCP API Key ==========
INSERT INTO mcp_api_keys (id, key, user_id, role, department, is_active) VALUES
('b0000001-0000-0000-0000-000000000001','mcp_test_key_001','22222222-2222-2222-2222-222222222222','manager','研发部',true),
('b0000002-0000-0000-0000-000000000002','mcp_test_key_002','33333333-3333-3333-3333-333333333333','employee','研发部',false)
ON CONFLICT (id) DO NOTHING;

-- ========== schema_migrations（模拟已应用版本） ==========
CREATE TABLE IF NOT EXISTS schema_migrations (version TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
INSERT INTO schema_migrations (version) VALUES
('001_initial'),('002_notifications'),('003_identity_mappings'),('004_ontology_snapshots'),
('005_user_deleted_at'),('006_payment'),('007_reasoning_rules'),('008_user_avatar'),
('009_mcp_api_keys'),('010_invoice_verification'),('011_payment_receipts_audit'),
('012_notification_system_message_link'),('013_notification_pref_defaults')
ON CONFLICT (version) DO NOTHING;
