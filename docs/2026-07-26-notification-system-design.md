# SSE 通知系统 — 设计方案

> 日期：2026-07-26 | 版本：v1.0 | 状态：待评审

---

## 1. 概述

将当前硬编码的通知页面升级为完整的消息通知系统，涵盖：

- **事务性通知**：审批提醒、驳回、付款等事件自动触发，页面内消息 + SMS/邮件补充
- **广播性通知**：管理员撰写并发送给指定角色/用户，支持 AI 润色
- **用户通知偏好**：每个用户独立控制各类消息的 SMS/邮件开关
- **送达追踪与退回告警**：短信/邮件发送失败时通知管理员

核心原则：**页面内消息为主，SMS/邮件为补充送达渠道**。

---

## 2. 数据模型

### 2.1 `notification_logs` — 逻辑通知记录（扩展）

| 字段 | 类型 | 说明 |
|------|------|------|
| id | UUID | PK |
| user_id | UUID | 接收用户 |
| type | enum | `reminder` / `escalation` / `rejected` / `approved` / `paid` / `broadcast` / `welcome` / `bounce_alert` |
| title | text | 消息标题（页面显示用） |
| body | text | 消息正文（页面显示用） |
| read_at | timestamptz? | 已读时间，null=未读 |
| created_at | timestamptz | |

### 2.2 `notification_deliveries` — 渠道送达明细（新建）

| 字段 | 类型 | 说明 |
|------|------|------|
| id | UUID | PK |
| notification_id | UUID | FK → notification_logs |
| channel | enum | `in_app` / `sms` / `email` |
| status | enum | `sent` / `failed` / `skipped` |
| error_message | text? | 失败原因（短信退回/邮箱退信） |
| sent_at | timestamptz? | 发送时间 |
| created_at | timestamptz | |

### 2.3 `system_messages` — 管理员广播消息（新建）

| 字段 | 类型 | 说明 |
|------|------|------|
| id | UUID | PK |
| title | text | 消息标题 |
| body | text | 消息正文 |
| body_ai | text? | AI 润色后的版本 |
| body_ai_instruction | text? | 润色时使用的调整指令 |
| target_roles | text[]? | 目标角色，null=全员 |
| target_user_ids | UUID[]? | 指定目标用户，与 roles 取并集 |
| sender_id | UUID | 发件人（管理员）FK → users |
| delivery_channels | text[] | 选择的渠道 `[sms, email]` 或空 |
| status | enum | `draft` / `sent` |
| sent_at | timestamptz? | 发送时间 |
| created_at | timestamptz | |
| updated_at | timestamptz | |

### 2.4 `users` 新增字段

```json
notify_prefs: {
  "sms": {
    "reminder": true,
    "escalation": true,
    "rejected": true,
    "paid": false
  },
  "email": {
    "rejected": true,
    "paid": false
  },
  "broadcast": true,
  "in_app": {
    "rejected": true,
    "paid": true,
    "broadcast": true
  }
}
```

### 2.5 新增枚举值

**notification_logs.type 扩展**：
- `broadcast` — 管理员广播
- `welcome` — 新用户入职欢迎
- `bounce_alert` — 管理员告警（短信/邮件退回）

---

## 3. 消息发送架构

### 3.1 核心流程

```
事件触发 / 管理员发送
        ↓
生成 notification_logs 记录（逻辑层，一条事件一条记录）
        ↓
始终写入 notification_deliveries { channel: in_app, status: sent }
        ↓
检查 notify_prefs.sms.{type} ──true→ SmsProvider → delivery { channel: sms, status: sent/failed }
        ↓
检查 notify_prefs.email.{type} ──true→ EmailProvider → delivery { channel: email, status: sent/failed }
        ↓
任一 delivery status=failed → 生成 bounce_alert 通知 → 管理员"消息"页收到退回告警
```

### 3.2 事务性消息触发点

| 事件 | type | 触发位置 | 默认渠道 |
|------|------|---------|---------|
| 审批超时提醒 | reminder | 调度器 | SMS |
| 审批升级催办 | escalation | 调度器 | SMS |
| 审批驳回 | rejected | 审批API驳回操作 | in_app + 邮件 |
| 审批通过（全部步骤完成） | approved | 审批API | in_app |
| 付款完成 | paid | 财务标记 paid 后 | in_app + SMS |
| 新用户入职 | welcome | 管理员创建用户后 | 邮件 |

### 3.3 广播消息目标解析

```
目标用户列表 = { role ∈ target_roles 的所有用户 } ∪ { id ∈ target_user_ids 的用户 }
  → 过滤 notify_prefs.broadcast = false 的用户
  → 逐个生成 notification_logs
  → 按管理员选择的 delivery_channels + 用户偏好的 SMS/email 开关 → 发送
```

### 3.4 退回告警

```
当 delivery status = failed:
  1. error_message 记录具体原因
  2. 生成一条 bounce_alert 消息推送给所有管理员:
     title: "消息送达失败"
     body: "向 <用户名>(<手机号/邮箱>) 发送的 <消息标题> 失败: <原因>"
```

---

## 4. 管理员撰写广播消息

### 4.1 页面布局

```
┌─ 撰写广播消息 ────────────────────────────────────────────┐
│                                                           │
│  标题: [________________________________________]         │
│                                                           │
│  正文: [________________________________________] [✨ 润色] │
│         ________________________________________          │
│                                                           │
│  目标角色:  ☐ 管理员  ☑ 部门审批人  ☑ 财务  ☐ 普通员工     │
│  指定用户:  [张三 ×] [李四 ×] [+搜索用户]                   │
│                                                           │
│  发送渠道:  ☑ 页面通知  ☐ SMS  ☐ 邮件                      │
│                                                           │
│  [保存草稿]                                  [发送]         │
└───────────────────────────────────────────────────────────┘
```

### 4.2 AI 润色流程

```
1. 点击 [✨ 润色]:
   → POST /ai/polish { body: 原文, instruction: "使其更专业、简洁、友好" }
   → LocalProvider → Ollama LLM（复用 ai-config.json 配置）
   → prompt: "你是企业通知编辑助手。请润色以下通知，使其更专业、简洁、友好。
              保持原意不变，不要添加原文没有的信息。只返回润色后正文。"
   → 返回 { polished_body }

2. 弹出对比弹窗:
   ┌──────────────────────────────────────────────────┐
   │ 原文                     │  润色后                 │
   │ xxxxxxxxxxxxxxxxxxxxxx  │  xxxxxxxxxxxxxxxxxxxxxx │
   │                          │                        │
   │ 调整要求: [更正式一些____]  [再次润色]              │
   │                          │                        │
   │           [采用润色]  [保留原文]                    │
   └──────────────────────────────────────────────────┘

3. 用户输入调整要求 → [再次润色]:
   → POST /ai/polish { body: 原文, instruction: "更正式一些", previous: 当前版 }
   → 返回新润色版 → 更新右侧

4. [采用润色] → 填入 body_ai，正文编辑框显示润色版
   [保留原文] → 丢弃润色版，继续编辑原文
```

### 4.3 草稿管理

- 可保存草稿（status=draft），稍后继续编辑
- 草稿列表展示最近草稿，可编辑/删除
- 已发送消息不可编辑

---

## 5. 用户通知偏好设置

### 5.1 设置入口

个人中心 → 通知设置卡片：

```
┌─ 通知设置 ───────────────────────────────┐
│                                          │
│  页面内通知（始终开启）                     │
│    ✓ 审批结果  ✓ 付款通知  ✓ 系统公告      │
│                                          │
│  SMS 通知                                │
│    ☐ 审批提醒  ☑ 驳回通知  ☐ 付款通知     │
│                                          │
│  邮件通知                                │
│    ☑ 驳回通知  ☐ 付款通知                 │
│                                          │
│  系统广播                                │
│    ☑ 接收管理员广播消息                    │
│                                          │
│  [保存设置]                                │
└──────────────────────────────────────────┘
```

- 管理员在创建用户时可设默认通知偏好
- 用户登录后可在个人中心自行修改

---

## 6. API 设计

### 6.1 用户通知

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/notifications` | 当前用户通知列表（分页） |
| PUT | `/notifications/:id/read` | 标记单条已读 |
| PUT | `/notifications/read-all` | 全部已读 |
| GET | `/notifications/unread-count` | 未读数（顶部红点用） |

### 6.2 通知偏好

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/user/notify-prefs` | 当前用户的通知设置 |
| PUT | `/user/notify-prefs` | 更新通知设置 |

### 6.3 管理员广播管理

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/admin/messages` | 消息列表（草稿+已发送） |
| GET | `/admin/messages/:id` | 消息详情 |
| POST | `/admin/messages` | 创建消息（保存草稿/立即发送） |
| PUT | `/admin/messages/:id` | 编辑草稿 |
| POST | `/admin/messages/:id/send` | 发送草稿 |
| DELETE | `/admin/messages/:id` | 删除草稿 |

### 6.4 AI 润色

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/ai/polish` | 参数 `{ body, instruction?, previous? }`，返回 `{ polished_body }` |

### 6.5 用户搜索（发送时选择目标用户）

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/admin/users/search?q=<keyword>` | 按姓名或手机号搜索用户 |

---

## 7. 前端页面

### 7.1 消息通知页（Notifications.vue）

- 从 API 获取当前用户的 notification_logs 列表
- 未读/已读状态切换
- 点击标记已读
- 全部已读按钮
- 顶端未读红点计数

### 7.2 管理员消息管理（AdminMessages.vue）

- 消息列表（草稿 + 已发送，标签切换）
- 新建消息按钮 → 撰写页面（§4.1 布局）
- AI 润色弹窗交互
- 草稿编辑/删除
- 已发送消息查看详情（目标用户列表、送达统计）

### 7.3 个人中心通知设置

- Profile.vue 新增通知偏好卡片
- 复用现有 `PUT /user/notify-prefs` API

### 7.4 顶部导航红点

- DefaultLayout 顶栏通知图标 → 显示未读计数
- 从 `GET /notifications/unread-count` 获取

---

## 8. 通知通道配置

### 8.1 邮件通道

支持两种模式：

| 模式 | EMAIL_PROVIDER | 说明 |
|------|---------------|------|
| 开发（控制台输出） | `dev` 或 `log` | 不实际发送，仅打印日志 |
| SMTP | `smtp` | 通过外部 SMTP 服务器发送 |

**SMTP 模式环境变量**（以 163 邮箱为例）：

```env
EMAIL_PROVIDER=smtp
EMAIL_HOST=smtp.163.com
EMAIL_PORT=465
EMAIL_USER=your-email@163.com
EMAIL_PASS=your-auth-code     # 163 授权码，不是邮箱密码
EMAIL_FROM=your-email@163.com  # 发件人显示地址（可选，默认用 EMAIL_USER）
```

实现为 `packages/notifications/src/channels/email.ts::SmtpEmailProvider`，使用 nodemailer 直接调用 SMTP。失败时返回 `{ success: false }` 含 `error_message`，触发退回告警。

### 8.2 短信通道

支持三种模式：

| 模式 | SMS_PROVIDER | 说明 |
|------|-------------|------|
| 开发（控制台输出） | `dev` 或 `log` | 不实际发送，仅打印日志 |
| 阿里云短信 | `aliyun` | 通过阿里云短信 API 发送 |

**阿里云短信模式环境变量**：

```env
SMS_PROVIDER=aliyun
ALIYUN_ACCESS_KEY_ID=your-access-key-id
ALIYUN_ACCESS_KEY_SECRET=your-access-key-secret
ALIYUN_SMS_SIGN_NAME=your-sign-name      # 已审核的短信签名
ALIYUN_SMS_TEMPLATE_CODE=SMS_123456789   # 已审核的短信模板编号
```

实现为 `packages/notifications/src/channels/sms.ts::AliyunSmsProvider`。失败时同样触发退回告警。

> **开通教程详见部署文档 `docs/2026-07-06-sse-deployment.md`。**

---

## 9. 数据库迁移

### 9.1 新增表

- `notification_deliveries`
- `system_messages`

### 9.2 修改表

- `notification_logs`: 增加 `title`, `body`, `read_at` 字段；`type` 增加 `broadcast`, `welcome`, `bounce_alert`
- `users`: 增加 `notify_prefs JSONB DEFAULT '{}'`

### 9.3 默认值

新用户创建时 `notify_prefs` 默认：
```json
{
  "sms": { "reminder": true, "escalation": true, "rejected": true, "paid": false },
  "email": { "rejected": true, "paid": false },
  "broadcast": true,
  "in_app": { "rejected": true, "paid": true, "broadcast": true }
}
```

---

## 10. 文件变更清单

| 文件 | 变更类型 | 说明 |
|------|---------|------|
| `packages/shared/src/types/notification-log.ts` | 修改 | 新增字段 |
| `packages/shared/src/types/notification-delivery.ts` | 新建 | delivery 类型 |
| `packages/shared/src/types/system-message.ts` | 新建 | 广播消息类型 |
| `packages/shared/src/enums/notification-trigger.ts` | 修改 | 新增枚举值 |
| `packages/db/src/migrations/002_notifications.sql` | 新建 | DDL |
| `packages/db/src/repositories/pg-notification-repo.ts` | 修改 | 新增查询方法 |
| `packages/core/src/ports/inotification-repo.ts` | 修改 | 新增接口方法 |
| `packages/notifications/src/scheduler.ts` | 修改 | 改用新模型 |
| `packages/notifications/src/channels/email.ts` | 修改 | 新增 SmtpEmailProvider（163邮箱） |
| `packages/notifications/src/channels/sms.ts` | 修改 | 新增 AliyunSmsProvider（阿里云短信） |
| `packages/api/src/routes/notifications.ts` | 新建 | 用户通知 API |
| `packages/api/src/routes/admin-messages.ts` | 新建 | 管理员消息管理 API |
| `packages/api/src/routes/ai.ts` | 修改 | 新增 polish 接口 |
| `packages/api/src/routes/user.ts` | 新建 | 通知偏好 API |
| `packages/api/src/index.ts` | 修改 | 注册新路由 |
| `packages/web/src/pages/Notifications.vue` | 重写 | 真实数据 |
| `packages/web/src/pages/AdminMessages.vue` | 新建 | 管理员消息管理 |
| `packages/web/src/pages/Profile.vue` | 修改 | 新增通知偏好卡片 |
| `packages/web/src/layouts/DefaultLayout.vue` | 修改 | 通知红点动态计数 |
| `packages/web/src/router/index.ts` | 修改 | 新增路由 |

---

> **评审后进入实施阶段。**
