# 通知系统补齐 — 开发过程记录（2026-11-03）

> 日期：2026-11-03 | 会话记录
> 本次会话覆盖：业务事件通知、调度器统一走引擎、广播送达追踪、通知偏好补全。
> 迁移：`012_notification_system_message_link.sql`、`013_notification_pref_defaults.sql`

---

## 问题

通知能力此前只完成了一半：

- **只有广播 + 催办调度器**：审批通过/驳回、打款完成、新用户入职等关键业务事件没有任何通知。
- **调度器绕过偏好设置**：催办/升级不读取用户的 `notify_prefs`，也不写 `notification_deliveries`，无法知道发没发出去。
- **送达记录不可见**：广播发送后，管理员只能看到「已发送」，无法查看每个用户的成功/失败/跳过明细。
- **调度器收件人 ID 错误**：把审批记录 ID 当作收件人 ID 使用，提醒可能发错人或发不出。
- **重复升级**：同一审批记录已升级后仍会被反复扫描通知。

---

## 变更

### 1. 通知引擎（NotificationEngine）

- 新增 `SendOptions`：`notifyPrefs`、`systemMessageId`、`emailBody`。
- 发送时优先使用调用方传入的偏好，否则读用户 `notify_prefs`，最后回退默认值。
- 广播支持用户级退订（`prefs.broadcast=false` 时不创建站内信）。
- 偏好读取做防御性处理：字段缺失时按默认值判断，不因残缺 JSON 抛错。
- 逐用户失败隔离：`sendBatch` 中单个用户失败不打断整批广播。
- 送达失败时为管理员生成 `bounce_alert` 站内告警。
- 邮件正文与短信正文分离；事件构造的 HTML 邮件正文统一做 HTML 转义，避免用户输入注入。
- 每个渠道都写 `notification_deliveries`，状态为 `sent` / `failed` / `skipped`。

### 2. 工厂与事件消息

- 新增 `createNotificationEngine()`（`factory.ts`），统一选择 SMS/Email provider，并按需懒加载 `@sse/db`。
- 新增事件构造器（`events.ts`）：
  - `expenseApprovedMessage`：审批通过（站内）。
  - `expenseRejectedMessage`：驳回（请求 SMS + 邮件，带驳回原因，HTML 转义）。默认偏好下实际只发邮件。
  - `paymentPaidMessage`：打款完成（请求 SMS + 邮件）。默认偏好下实际只发短信。
  - 两个事件都同时请求短信和邮件，具体发哪个渠道由用户偏好决定，因此 Profile 里的两个渠道开关都能真正生效。
  - `welcomeMessage`：新用户欢迎（邮件）。

### 3. 调度器

- `ApprovalReminderScheduler` 改为依赖 `NotificationEngine`，不再自己拼 provider / 写日志。
- 修正收件人：使用审批人用户 ID，不再误用审批记录 ID。
- 审批记录带 `escalated_at` 后停止重复处理。
- 增加 `running` 重入保护，避免上一轮未结束时并发扫描。
- 升级前有 24 小时缓冲：`findPendingOverdue` 要求 `reminder_sent_at` 为空或早于 24 小时前，即 24 小时发首次提醒，提醒后再过 24 小时才升级，不会在下一轮扫描立即升级。
- 标记时机：用户不存在时 `send` 返回 `null`，不标记，下一轮会重试；外部渠道（短信/邮件）发送失败会为管理员生成 `bounce_alert`，但该审批记录仍会标记 `reminder_sent_at` / `escalated_at`，避免每 15 分钟重复通知、造成通知风暴。
- 清理 `findPendingOverdue` 中无意义的 JOIN。

### 4. 业务事件接线

- 新增 `packages/api/src/services/notifications.ts`：懒加载引擎 + `sendNotificationSafe`，发送异常只告警、不阻断主流程。
- 审批通过：在各「流程结束」分支（无规则 / 最后一步 / 无下一步）触发通过通知。
- 审批驳回：写回 `REJECTED` 后触发驳回通知，并对空驳回原因做兜底。
- 打款成功：事务提交后触发打款通知。
- 新建用户：创建成功后触发欢迎邮件。
- 所有事件均以 fire-and-forget 方式发送，通知失败不影响接口响应。

### 5. 送达追踪

- 迁移 012：`notification_logs.system_message_id`（引用 `system_messages`，`ON DELETE SET NULL`）+ 索引。
- 广播创建与发送时写入 `system_message_id`，把消息与每个用户的送达记录关联。
- 新增 `GET /admin/messages/:id/deliveries`：返回汇总（总数/成功/失败/跳过/待定）与明细（最多 500 条）。
- `AdminMessages.vue` 增加「查看送达」按钮与送达统计弹窗。
- 草稿发送改为原子 `draft → sent` 抢占（`claimSystemMessageForSend`），防止重复发送；发送异常回滚为草稿。

### 6. 通知偏好

- `Profile.vue` 补齐 SMS/邮件两个渠道的「超时提醒」「超时升级催办」「驳回通知」「打款通知」开关，以及广播开关。
- 默认值对齐设计：短信默认 `reminder/escalation/paid` 开、`rejected` 关；邮件默认 `reminder/escalation/rejected` 开、`paid` 关。即驳回默认走邮件、打款默认走短信。
- 前端、引擎 `DEFAULT_PREFS` 与迁移 013 三处默认值保持一致。
- 读取偏好时在默认值上做深合并，接口只返回部分字段也不会把缺失项清空。
- 保留 `in_app` 偏好，保存时一并回传。

---

## 验证

### 构建与测试

在本机（Windows/PowerShell）执行：

| 命令 | 结果 |
|---|---|
| `pnpm build` | 全部包 Done（shared / core / db / auth / ai / ocr / notifications / ontology / api / mcp / web） |
| `pnpm test` | 全部通过 |

`pnpm test` 各包结果：

| 包 | 测试数 |
|---|---:|
| `@sse/core` | 33 |
| `@sse/auth` | 5 |
| `@sse/ai` | 60 |
| `@sse/db` | 13 |
| `@sse/ontology` | 8 |
| `@sse/notifications` | 22 |
| `@sse/api` | 17 |
| **合计** | **158** |

说明：`@sse/notifications` 的调度器测试中会打印一条 `[Scheduler] ... boom` 的 `console.error`，这是「单个收件人发送失败被隔离」用例的预期输出，测试本身通过。

---

## 部署

### 迁移 012 与 013

两组迁移都必须在重启 API 前应用：

- `packages/db/src/migrations/012_notification_system_message_link.sql`：新 API 代码会写入/查询 `notification_logs.system_message_id`。
- `packages/db/src/migrations/013_notification_pref_defaults.sql`：更新 `users.notify_prefs` 的列默认值，使新用户的默认渠道与设计一致（驳回默认邮件、打款默认短信）；已有用户的偏好不被改写。

012：

```sql
ALTER TABLE notification_logs
  ADD COLUMN IF NOT EXISTS system_message_id UUID REFERENCES system_messages(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_notification_logs_system_message
  ON notification_logs(system_message_id);
```

013：

```sql
ALTER TABLE users ALTER COLUMN notify_prefs SET DEFAULT '{
  "sms": {"reminder": true, "escalation": true, "rejected": false, "paid": true},
  "email": {"reminder": true, "escalation": true, "rejected": true, "paid": false},
  "broadcast": true,
  "in_app": {"rejected": true, "paid": true, "broadcast": true}
}'::jsonb;
```

012 使用 `IF NOT EXISTS`，013 只改默认值，均可重复执行。推荐用迁移执行器：

```bash
DB_PORT=5433 pnpm migrate
```

或直接对容器执行：

```bash
sudo docker exec -i -e PGPASSWORD=sse_dev sse-postgres-1 \
  psql -U sse -d sse < packages/db/src/migrations/012_notification_system_message_link.sql
```

### 部署顺序

```bash
git pull
pnpm install
# 先应用 012 与 013，再重启 API
DB_PORT=5433 pnpm migrate
pnpm build
# 重启 API / 前端服务
```

关键：迁移 012 必须先于 API 重启完成，否则新代码读写 `system_message_id` 会报错；迁移 013 保证新建用户的默认通知偏好正确。`pnpm migrate` 会按编号顺序应用两者。

---

## 仍需手动验证

本环境没有真实 SMTP / 阿里云短信 / 可写的 PostgreSQL，以下项需要在具备服务与测试库的环境补做：

- 真实 SMTP 发送欢迎/驳回邮件，确认标题、正文、HTML 转义、失败告警。
- 真实阿里云短信发送打款/催办短信，确认模板与签名。
- 在真实库执行迁移 012 与 013，确认 `system_message_id` 列/外键/索引创建成功，且 `users.notify_prefs` 默认值已更新。
- 端到端验证：
  - 提交报销 → 审批通过 → 申请人收到通知。
  - 驳回并填写原因 → 申请人收到驳回邮件。
  - 打款成功 → 申请人收到打款短信。
  - 管理员广播 → 已退订用户不收到站内信，管理端可查看每条送达记录。
- 调度器真实运行一轮，确认提醒/升级只发一次且受用户偏好控制。

---

## 按事件短信模板

- 提醒 / 升级 / 驳回 / 打款 / 广播 可分别通过以下环境变量配置模板 CODE：
  `ALIYUN_SMS_TEMPLATE_REMINDER`、`ALIYUN_SMS_TEMPLATE_ESCALATION`、
  `ALIYUN_SMS_TEMPLATE_REJECTED`、`ALIYUN_SMS_TEMPLATE_PAID`、`ALIYUN_SMS_TEMPLATE_BROADCAST`。
- 未配置时回退到 `ALIYUN_SMS_TEMPLATE_CODE`（兼容旧配置）。
- 前四类模板变量统一为 `${code}`，值为报销单号；广播模板建议使用固定文案（不带变量）。
- 验证码模板不能用于通知文本：阿里云限制验证码模板变量只能是 `[a-zA-Z0-9]`，必须申请通知类模板。

---

## 已知遗留问题（本次未修复）

`POST /admin/users` 接收了请求体中的 `password`，但插入数据库时写死 `password_hash=''`，即管理员设置的新用户密码被忽略；随后发送的欢迎邮件仍提示用户「登录系统」，会误导用户（新账号无法用所填密码登录）。

建议后续修复方向：

- 创建用户时用 `password` 做哈希写入 `password_hash`；
- 或在未设置密码时生成一次性初始密码/邀请链接，并让欢迎邮件只提示设置密码，而不是直接登录。

此为通知补齐之外的独立账号问题，本次未改动。

---

## 相关提交

| Commit | 说明 |
|---|---|
| `feat(notifications): link broadcasts to per-user deliveries` | 迁移 012、类型与仓储 |
| `feat(notifications): respect preferences and link deliveries` | 引擎偏好与送达 |
| `feat(notifications): add engine factory and event builders` | 工厂与事件消息 |
| `fix(notifications): escape email HTML and lazy-load db in factory` | HTML 转义与懒加载 |
| `refactor(notifications): route reminders through the engine` | 调度器统一走引擎 |
| `fix(notifications): prevent repeated escalations and track delivery results` | 重入/重复升级/结果追踪 |
| `feat(notifications): notify approval, payment and onboarding events` | 业务事件接线 |
| `fix(notifications): guard reject comments and avoid blocking requests` | 驳回原因兜底与非阻塞发送 |
| `feat(notifications): use per-event SMS templates` | 按事件短信模板与短参数 |
| `feat(notifications): expose broadcast delivery tracking` | 送达接口与页面 |
| `fix(notifications): bound delivery report and claim broadcasts atomically` | 送达上限与原子抢占 |
| `feat(web): complete notification preference toggles` | 偏好 UI 补全 |
| `fix(web): merge notification prefs over defaults` | 偏好深合并 |
