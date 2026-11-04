# SSE 开发过程记录（2026-11-04）

> 本次会话覆盖：本体可视化访问控制、通知系统补齐、阿里云短信接入与按事件模板、迁移与测试验证。
> 当前 `master` 已推送到 `6dfc0b6`，工作区干净。

---

## 一、本次完成内容

### 1. 本体可视化访问控制

**问题**：`/ontology/graph` 已按角色过滤，但存在多个绕过入口。

**实现**：
- 新增 `packages/ontology/src/graph-scope.ts`：`scopeGraphForUser`
  - `admin` / `finance`：全图
  - `dept_approver`：本部门节点 + 成员 + 1 跳
  - `employee`：自己的 Person 节点 + 2 跳
  - 缺失 userId / 空部门 / 未知角色：空图
- 修复部门匹配（`properties.name` / 解码后的 URI），此前审批人常拿到空图。
- 删除员工「找不到自己节点就返回所有 Person」的兜底。
- REST：
  - `/ontology/graph`、`/sync`、`/from-text` 统一走角色裁剪。
  - `/ontology/query` 先裁剪再按类型过滤。
  - 写操作：实体/关系/`from-text`/`sync` 仅 `admin`；`reason` 仅 `admin`/`finance`。
- MCP：
  - `query_ontology` 按角色裁剪。
  - `query_sparql` 仅 `admin`/`finance`。
  - `get_entity_network` 中心不可见时返回 `FORBIDDEN`。
- 测试：8 个 `scopeGraphForUser` 用例。

文档：`docs/2026-11-03-ontology-access-control.md`

### 2. 通知系统补齐

**问题**：原先只有广播和调度器提醒，审批/打款/入职事件不通知；调度器绕过偏好与送达追踪；送达记录无入口。

**实现**：
- `NotificationEngine`
  - `SendOptions` 支持 `notifyPrefs` / `systemMessageId` / `emailBody` / `sms`。
  - 先查用户再写库；用户不存在返回 `null`。
  - 广播退订在写库前拦截。
  - 偏好缺失按默认值回退；显式 false 仍生效。
  - 单用户发送失败隔离；失败生成 `bounce_alert`。
  - 邮件正文 HTML 转义。
- 工厂与事件消息：`createNotificationEngine`、`expenseApprovedMessage` / `expenseRejectedMessage` / `paymentPaidMessage` / `welcomeMessage`。
- 调度器：改走统一引擎，修复收件人 ID 错误；24h 提醒、再 24h 升级；升级后不再重复；重入保护。
- 业务事件接线：
  - 审批通过：站内
  - 驳回：站内 + 邮件 + 短信
  - 打款：站内 + 短信 + 邮件
  - 新用户：欢迎邮件
  - 业务发送使用 `void sendNotificationSafe(...)`，不阻塞主请求。
- 送达追踪：
  - 迁移 `012_notification_system_message_link.sql`：`notification_logs.system_message_id`。
  - `GET /admin/messages/:id/deliveries`（SQL 汇总 + 最多 500 行）。
  - AdminMessages「查看送达」弹窗。
  - 广播发送使用原子 `draft → sent`，防重复广播。
- 偏好：
  - Profile 增加 SMS/邮件 的提醒、升级、驳回、付款开关。
  - 深合并默认值，避免旧偏好覆盖新字段。
  - 迁移 `013_notification_pref_defaults.sql` 更新新用户默认偏好。
  - 通知渠道请求改为 rejected/paid 同时请求 SMS+邮件，由偏好决定实际渠道。

文档：`docs/2026-11-03-notification-completion.md`

### 3. 阿里云短信真实接入

**问题**：`AliyunSmsProvider` 原先只是 `console.log` 占位；单个通用模板无法区分事件；验证码模板不允许中文。

**实现**：
- 真实调用 `@alicloud/dysmsapi20170525` + `@alicloud/openapi-core`。
- 按事件配置模板 CODE：
  - `ALIYUN_SMS_TEMPLATE_REMINDER`
  - `ALIYUN_SMS_TEMPLATE_ESCALATION`
  - `ALIYUN_SMS_TEMPLATE_REJECTED`
  - `ALIYUN_SMS_TEMPLATE_PAID`
  - `ALIYUN_SMS_TEMPLATE_BROADCAST`
  - 未配置时回退 `ALIYUN_SMS_TEMPLATE_CODE`
- 提醒/升级/驳回/打款模板变量统一为 `${code}`，值为报销单号。
- 广播模板无变量（固定文案）。
- 修复用户遇到的 `isv.TEMPLATE_PARAMS_ILLEGAL ... for verification sms`：验证码模板不能承载通知文本，必须使用通知类模板。

---

## 二、验证结果

- `pnpm build`：11 个包全部通过。
- `pnpm test`：
  - core 33
  - auth 5
  - db 13
  - ai 60
  - notifications 29
  - ontology 8
  - api 17
  - 合计 **165 passed**
- 未执行真实数据库迁移（本机无 Docker/PostgreSQL），需在测试机验证。

---

## 三、部署与迁移

重启 API 前应确认已应用：

- `packages/db/src/migrations/012_notification_system_message_link.sql`
- `packages/db/src/migrations/013_notification_pref_defaults.sql`

Docker 执行方式：

```bash
sudo docker exec -i -e PGPASSWORD=sse_dev sse-postgres-1 \
  psql -U sse -d sse < packages/db/src/migrations/012_notification_system_message_link.sql

sudo docker exec -i -e PGPASSWORD=sse_dev sse-postgres-1 \
  psql -U sse -d sse < packages/db/src/migrations/013_notification_pref_defaults.sql
```

验证：

```sql
SELECT column_name FROM information_schema.columns
 WHERE table_name='notification_logs' AND column_name='system_message_id';

SELECT indexname FROM pg_indexes
 WHERE tablename='notification_logs' AND indexname='idx_notification_logs_system_message';

SELECT column_default FROM information_schema.columns
 WHERE table_name='users' AND column_name='notify_prefs';
```

---

## 四、测试机当前状态

- 代码已推送到 `6dfc0b6`。
- 测试机已安装阿里云短信 SDK 依赖。
- 需要在测试机执行：
  ```bash
  git pull
  pnpm install
  pnpm build
  # 重启 API
  ```
- `.env` 需配置按事件的通知类短信模板（不要用验证码模板）。

---

## 五、下一会话待办

### P0：密码安全（强烈建议先修）

**问题**：
- `packages/api/src/routes/auth.ts` 登录时只校验手机号存在和状态，**完全没有校验密码**，任意密码都能登录。
- `packages/api/src/routes/admin.ts` 创建用户时忽略传入的 `password`，`password_hash` 写入空字符串。
- `PgUserRepo` 未查询 `password_hash`。

**建议步骤**：
1. 在 `@sse/auth` 增加 `hashPassword` / `verifyPassword`（bcrypt）。
2. 登录时查询 `password_hash` 并 `bcrypt.compare`。
3. 创建用户时要求并哈希 `password`。
4. 为历史空密码账号生成临时密码哈希并通知重置。
5. 增加登录正确/错误密码、禁用账号、空密码的测试。

### P1：短信真实链路

1. 在阿里云控制台申请 **通知类** 短信模板。
2. 配置各事件模板 CODE（见 `.env.example`）。
3. 确认模板变量是 `${code}`，值为报销单号。
4. 触发提醒/驳回/打款，检查 `notification_deliveries.status = sent`。
5. 若通知模板对变量字符有限制，可在代码中清洗单号（当前保留 `-`）。

### P2：端到端手动冒烟

1. 入职邮件（只发邮件）
2. 审批通过（站内）
3. 驳回（站内 + 邮件 + 短信）
4. 打款（站内 + 短信 + 邮件）
5. 广播「查看送达」
6. 调度器提醒/升级（回拨 `step_started_at` / `reminder_sent_at` 后重启 API）

### P3：可选清理

- 广播 `sent_to` 目前按目标人数统计，未扣除退订/失败用户。
- `POST /admin/messages` 的 `send_now` 路径未使用原子 claim 与失败回滚。
- `PgNotificationLogRepo` / `INotificationLogRepo` 已无生产调用。
- 迁移 012/013 没有 `.down.sql`（仓库所有迁移均如此）。
- 调度器外部渠道全失败时仍会标记提醒（会生成管理员退回告警），已在文档中说明。

---

## 六、本次提交记录

| Commit | 说明 |
|---|---|
| `57881b4` | fix(ontology): enforce role-scoped graph access |
| `5a2b310` | feat(notifications): link broadcasts to per-user deliveries |
| `e179401` | fix(notifications): persist delivery timestamps and accept pending status |
| `19d6ea3` | feat(notifications): respect preferences and link deliveries |
| `09717e4` | fix(notifications): map reminder prefs and isolate delivery failures |
| `3e0ea11` | fix(db): load notify_prefs with users |
| `bc1e616` | feat(notifications): add engine factory and event builders |
| `b3f34bc` | fix(notifications): escape email HTML and lazy-load db in factory |
| `6058943` | refactor(notifications): route reminders through the engine |
| `e99db8c` | fix(notifications): prevent repeated escalations and track delivery results |
| `22f3234` | feat(notifications): notify approval, payment and onboarding events |
| `0557a50` | fix(notifications): guard reject comments and avoid blocking requests |
| `1f1c9ea` | feat(notifications): expose broadcast delivery tracking |
| `0aa00ac` | fix(notifications): bound delivery report and claim broadcasts atomically |
| `5bfd2c4` | feat(web): complete notification preference toggles |
| `847b5af` | fix(web): merge notification prefs over defaults |
| `5443dad` | docs: record notification completion |
| `d980a4c` | fix(notifications): honor channel toggles and delay escalation |
| `45b9f48` | feat(notifications): enable real Aliyun SMS provider |
| `62e84a5` | fix(notifications): use code variable for Aliyun SMS template |
| `6dfc0b6` | feat(notifications): use per-event SMS templates |
