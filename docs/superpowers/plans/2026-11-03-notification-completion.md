# 通知系统补齐 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把已存在但未闭环的通知能力补齐：业务事件通知、调度器走统一引擎、送达追踪可查询、偏好设置完整。

**Architecture:** 所有发送统一经过 `NotificationEngine`，由它写 `notification_logs`、按 `notify_prefs` 判断渠道、写 `notification_deliveries` 并在失败时生成 `bounce_alert`。业务路由只构造消息并安全调用；广播、调度器、审批/打款/入职事件共用同一引擎。`notification_logs` 新增 `system_message_id` 用于把广播消息与每个用户的送达记录关联起来。

**Tech Stack:** TypeScript、Express、Vue 3、PostgreSQL、Jest + ts-jest、pnpm workspace。

---

## 文件结构

| 文件 | 动作 | 职责 |
|---|---|---|
| `packages/db/src/migrations/012_notification_system_message_link.sql` | 新增 | `notification_logs.system_message_id` + 索引 |
| `packages/shared/src/types/notification-log.ts` | 修改 | 增加 `system_message_id?` |
| `packages/shared/src/types/notification-delivery.ts` | 修改 | 增加 `SystemMessageDelivery` 行类型 |
| `packages/db/src/repositories/pg-notification-repo.ts` | 修改 | 写入/映射 `system_message_id`；按消息查送达明细 |
| `packages/notifications/src/notification-engine.ts` | 修改 | 支持 `systemMessageId`、`emailBody`；修正偏好映射 |
| `packages/notifications/src/factory.ts` | 新增 | 统一构造引擎（SMS/Email provider 选择） |
| `packages/notifications/src/events.ts` | 新增 | 审批/驳回/打款/入职消息构造 |
| `packages/notifications/src/scheduler.ts` | 修改 | 改走 `NotificationEngine`，修复收件人 ID |
| `packages/notifications/src/index.ts` | 修改 | 导出 factory/events |
| `packages/notifications/src/__tests__/notification-engine.test.ts` | 新增 | 引擎偏好/送达/告警测试 |
| `packages/notifications/src/__tests__/events.test.ts` | 新增 | 事件消息测试 |
| `packages/notifications/src/__tests__/scheduler.test.ts` | 新增 | 调度器测试 |
| `packages/notifications/jest.config.js` | 新增 | Jest 配置 |
| `packages/notifications/package.json` | 修改 | `test` 脚本与 Jest 依赖 |
| `packages/api/src/services/notifications.ts` | 新增 | 懒加载引擎 + 安全发送 |
| `packages/api/src/routes/approvals.ts` | 修改 | 通过/驳回事件通知 |
| `packages/api/src/routes/expenses.ts` | 修改 | 打款完成通知 |
| `packages/api/src/routes/admin.ts` | 修改 | 新用户欢迎邮件 |
| `packages/api/src/routes/admin-messages.ts` | 修改 | 使用 factory、写 `systemMessageId`、送达明细接口 |
| `packages/api/src/index.ts` | 修改 | 调度器改用 factory |
| `packages/web/src/pages/Profile.vue` | 修改 | 增加升级催办偏好 |
| `packages/web/src/pages/AdminMessages.vue` | 修改 | 查看送达统计 |
| `docs/2026-11-03-notification-completion.md` | 新增 | 过程记录 |

---

## Task 1: 数据模型与仓储

**Files:**
- Create: `packages/db/src/migrations/012_notification_system_message_link.sql`
- Modify: `packages/shared/src/types/notification-log.ts`
- Modify: `packages/shared/src/types/notification-delivery.ts`
- Modify: `packages/db/src/repositories/pg-notification-repo.ts`

- [ ] **Step 1: 新增迁移**

```sql
ALTER TABLE notification_logs
  ADD COLUMN IF NOT EXISTS system_message_id UUID REFERENCES system_messages(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_notification_logs_system_message
  ON notification_logs(system_message_id);
```

- [ ] **Step 2: 扩展共享类型**

`notification-log.ts`：

```ts
export type NotificationLog = {
  id: string;
  user_id: string;
  type: string;
  title: string;
  body: string;
  system_message_id?: string;
  read_at?: Date;
  created_at?: Date;
};
```

`notification-delivery.ts` 追加：

```ts
export type SystemMessageDelivery = {
  notificationId: string;
  userId: string;
  userName?: string;
  type: string;
  title: string;
  channel: 'in_app' | 'sms' | 'email';
  status: 'sent' | 'failed' | 'skipped';
  errorMessage?: string;
  sentAt?: Date;
};
```

- [ ] **Step 3: 修改仓储写入与映射**

`mapNotification` 增加 `system_message_id: row.system_message_id ?? undefined`。

`create` 改为：

```ts
async create(notification: Omit<NotificationLog, 'id'>) {
  const { rows } = await pool.query(
    `INSERT INTO notification_logs (user_id, type, title, body, system_message_id)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [
      notification.user_id,
      notification.type,
      notification.title,
      notification.body,
      notification.system_message_id ?? null,
    ]
  );
  return mapNotification(rows[0]);
}
```

新增方法：

```ts
async findDeliveriesBySystemMessage(systemMessageId: string): Promise<SystemMessageDelivery[]> {
  const { rows } = await pool.query(
    `SELECT nl.id AS notification_id,
            nl.user_id,
            u.name AS user_name,
            nl.type,
            nl.title,
            nd.channel,
            nd.status,
            nd.error_message,
            nd.sent_at
       FROM notification_logs nl
       JOIN notification_deliveries nd ON nd.notification_id = nl.id
       LEFT JOIN users u ON u.id = nl.user_id
      WHERE nl.system_message_id = $1
      ORDER BY u.name ASC, nd.channel ASC`,
    [systemMessageId]
  );
  return rows.map((row: any) => ({
    notificationId: row.notification_id,
    userId: row.user_id,
    userName: row.user_name ?? undefined,
    type: row.type,
    title: row.title,
    channel: row.channel,
    status: row.status,
    errorMessage: row.error_message ?? undefined,
    sentAt: row.sent_at ?? undefined,
  }));
}
```

导入 `SystemMessageDelivery` 类型。

- [ ] **Step 4: 构建**

Run: `pnpm --filter @sse/shared build; pnpm --filter @sse/db build`
Expected: 两个命令退出码 0。

- [ ] **Step 5: 提交**

```bash
git add packages/shared/src/types/notification-log.ts packages/shared/src/types/notification-delivery.ts packages/db/src/repositories/pg-notification-repo.ts packages/db/src/migrations/012_notification_system_message_link.sql
git commit -m "feat(notifications): link broadcasts to per-user deliveries"
```

---

## Task 2: NotificationEngine 支持广播关联、邮件正文与正确偏好

**Files:**
- Modify: `packages/notifications/src/notification-engine.ts`
- Create: `packages/notifications/jest.config.js`
- Modify: `packages/notifications/package.json`
- Create: `packages/notifications/src/__tests__/notification-engine.test.ts`

- [ ] **Step 1: 配置 Jest**

`packages/notifications/jest.config.js`：

```js
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: ['**/__tests__/**/*.test.ts'],
  moduleNameMapper: {
    '^@sse/(.*)$': '<rootDir>/../$1/src',
  },
};
```

`package.json` 的 scripts 改为 `{ "build": "tsc", "test": "jest" }`，devDependencies 增加 `@types/jest`、`jest`、`ts-jest`。

Run: `pnpm install --filter @sse/notifications...`

- [ ] **Step 2: 写失败测试**

`notification-engine.test.ts`：

```ts
import { NotificationTriggerType } from '@sse/shared';
import { NotificationEngine } from '../notification-engine';

function harness() {
  const notifications: any[] = [];
  const deliveries: any[] = [];
  const sentSms: any[] = [];
  const sentEmail: any[] = [];
  const notificationRepo = {
    async create(input: any) {
      const row = { id: `n${notifications.length + 1}`, ...input };
      notifications.push(row);
      return row;
    },
    async createDelivery(input: any) {
      const row = { id: `d${deliveries.length + 1}`, ...input };
      deliveries.push(row);
      return row;
    },
  };
  const users: Record<string, any> = {
    u1: { id: 'u1', name: '张三', phone: '13800000001', email: 'a@example.com' },
    admin: { id: 'admin', name: '管理员', phone: '13800000000', email: 'admin@example.com' },
  };
  const userRepo = {
    async findById(id: string) {
      return users[id] ?? null;
    },
    async findByRole(role: string) {
      return role === 'admin' ? [users.admin] : [];
    },
  };
  const service = {
    async sendSms(phone: string, content: string) {
      sentSms.push({ phone, content });
      return true;
    },
    async sendEmail(email: string, subject: string, body: string) {
      sentEmail.push({ email, subject, body });
      return true;
    },
  };
  const engine = new NotificationEngine(
    notificationRepo as any,
    userRepo as any,
    service as any
  );
  return { engine, notifications, deliveries, sentSms, sentEmail };
}

const prefs = {
  sms: { reminder: true, escalation: true, rejected: false, paid: false },
  email: { rejected: true, paid: false },
  broadcast: true,
  in_app: { rejected: true, paid: true, broadcast: true },
};

describe('NotificationEngine', () => {
  it('creates an in-app record and delivery with system_message_id', async () => {
    const { engine, notifications, deliveries } = harness();

    await engine.send('u1', NotificationTriggerType.BROADCAST, '公告', '正文', [], {
      systemMessageId: 'm1',
    });

    expect(notifications[0].system_message_id).toBe('m1');
    expect(deliveries).toEqual([
      expect.objectContaining({ channel: 'in_app', status: 'sent' }),
    ]);
  });

  it('skips a channel disabled by preferences', async () => {
    const { engine, deliveries, sentSms } = harness();

    await engine.send('u1', NotificationTriggerType.REJECTED, '驳回', '正文', ['sms'], {
      notifyPrefs: prefs as any,
    });

    expect(sentSms).toHaveLength(0);
    expect(deliveries.at(-1)).toEqual(
      expect.objectContaining({ channel: 'sms', status: 'skipped' })
    );
  });

  it('sends email with the provided email body', async () => {
    const { engine, sentEmail } = harness();

    await engine.send('u1', NotificationTriggerType.REJECTED, '驳回', '短信正文', ['email'], {
      notifyPrefs: prefs as any,
      emailBody: '<p>邮件正文</p>',
    });

    expect(sentEmail).toEqual([
      { email: 'a@example.com', subject: '驳回', body: '<p>邮件正文</p>' },
    ]);
  });

  it('creates a bounce alert for admins when delivery fails', async () => {
    const { engine, notifications, deliveries } = harness();
    (engine as any).notificationService.sendSms = async () => false;

    await engine.send('u1', NotificationTriggerType.PAID, '打款', '正文', ['sms'], {
      notifyPrefs: { ...prefs, sms: { ...prefs.sms, paid: true } } as any,
    });

    expect(deliveries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ channel: 'sms', status: 'failed' }),
      ])
    );
    expect(notifications).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ user_id: 'admin', type: 'bounce_alert' }),
      ])
    );
  });

  it('always sends welcome email and broadcast in-app', async () => {
    const { engine, sentEmail, notifications } = harness();

    await engine.send('u1', NotificationTriggerType.WELCOME, '欢迎', '正文', ['email'], {
      notifyPrefs: { ...prefs, broadcast: false } as any,
    });

    expect(sentEmail).toHaveLength(1);
    expect(notifications[0].type).toBe('welcome');
  });
});
```

Run: `pnpm --filter @sse/notifications test`
Expected: FAIL（构造函数签名/行为未改）。

- [ ] **Step 3: 实现**

`notification-engine.ts` 关键改动：

```ts
export interface SendOptions {
  notifyPrefs?: NotifyPrefs;
  systemMessageId?: string;
  emailBody?: string;
}
```

`send` 签名改为：

```ts
async send(
  userId: string,
  type: string,
  title: string,
  body: string,
  channels: ('sms' | 'email')[],
  options: SendOptions = {},
): Promise<NotificationLog> {
```

`create` 传入 `system_message_id: options.systemMessageId`。
`const prefs = options.notifyPrefs || await this.getDefaultPrefs(userId);`
`tryDeliverChannel(..., options.emailBody)`。

`sendBatch` 增加可选 `systemMessageId`：

```ts
async sendBatch(
  userIds: string[],
  type: string,
  title: string,
  body: string,
  channels: ('sms' | 'email')[],
  systemMessageId?: string,
): Promise<void> {
  for (const userId of userIds) {
    const prefs = await this.getUserNotifyPrefs(userId);
    await this.send(userId, type, title, body, channels, {
      notifyPrefs: prefs,
      systemMessageId,
    });
  }
}
```

`tryDeliverChannel` 增加 `emailBody?: string` 参数，邮件使用 `emailBody ?? body`。

`isChannelEnabled` 改为：

```ts
private isChannelEnabled(channel: 'sms' | 'email', type: string, prefs: NotifyPrefs): boolean {
  if (type === 'broadcast') return prefs.broadcast;
  if (type === 'welcome') return channel === 'email';
  const bucket = channel === 'sms' ? prefs.sms : prefs.email;
  return Boolean((bucket as Record<string, boolean>)[type]);
}
```

- [ ] **Step 4: 测试通过**

Run: `pnpm --filter @sse/notifications test`
Expected: PASS（5 个用例）。

- [ ] **Step 5: 提交**

```bash
git add packages/notifications
git commit -m "feat(notifications): respect preferences and link deliveries"
```

---

## Task 3: 统一工厂与事件消息

**Files:**
- Create: `packages/notifications/src/factory.ts`
- Create: `packages/notifications/src/events.ts`
- Create: `packages/notifications/src/__tests__/events.test.ts`
- Modify: `packages/notifications/src/index.ts`

- [ ] **Step 1: 写事件测试**

```ts
import { NotificationTriggerType } from '@sse/shared';
import {
  expenseApprovedMessage,
  expenseRejectedMessage,
  paymentPaidMessage,
  welcomeMessage,
} from '../events';

const report = { serialNo: 'RE-2026-001', title: '差旅报销' };
const user = { id: 'u1', name: '张三' };

describe('notification events', () => {
  it('builds an in-app only approval message', () => {
    expect(expenseApprovedMessage(report)).toEqual({
      type: NotificationTriggerType.APPROVED,
      title: '报销单已通过',
      body: '你的报销单 RE-2026-001「差旅报销」已全部审批通过。',
      channels: [],
    });
  });

  it('builds a rejection message with comment and email', () => {
    expect(expenseRejectedMessage(report, '发票不符')).toEqual({
      type: NotificationTriggerType.REJECTED,
      title: '报销单被驳回',
      body: '你的报销单 RE-2026-001「差旅报销」被驳回：发票不符',
      channels: ['email'],
    });
  });

  it('builds a paid message with sms', () => {
    expect(paymentPaidMessage(report)).toEqual({
      type: NotificationTriggerType.PAID,
      title: '报销款已支付',
      body: '你的报销单 RE-2026-001「差旅报销」已完成打款。',
      channels: ['sms'],
    });
  });

  it('builds a welcome email', () => {
    expect(welcomeMessage(user)).toEqual({
      type: NotificationTriggerType.WELCOME,
      title: '欢迎加入 SSE',
      body: '张三，你的账号已创建，请登录系统完善个人信息。',
      channels: ['email'],
    });
  });
});
```

Run: `pnpm --filter @sse/notifications test`
Expected: FAIL（模块不存在）。

- [ ] **Step 2: 实现 events**

```ts
import { NotificationTriggerType } from '@sse/shared';

export type NotificationMessage = {
  type: string;
  title: string;
  body: string;
  channels: ('sms' | 'email')[];
};

export function expenseApprovedMessage(report: { serialNo: string; title: string }): NotificationMessage {
  return {
    type: NotificationTriggerType.APPROVED,
    title: '报销单已通过',
    body: `你的报销单 ${report.serialNo}「${report.title}」已全部审批通过。`,
    channels: [],
  };
}

export function expenseRejectedMessage(
  report: { serialNo: string; title: string },
  comment: string,
): NotificationMessage {
  return {
    type: NotificationTriggerType.REJECTED,
    title: '报销单被驳回',
    body: `你的报销单 ${report.serialNo}「${report.title}」被驳回：${comment}`,
    channels: ['email'],
  };
}

export function paymentPaidMessage(report: { serialNo: string; title: string }): NotificationMessage {
  return {
    type: NotificationTriggerType.PAID,
    title: '报销款已支付',
    body: `你的报销单 ${report.serialNo}「${report.title}」已完成打款。`,
    channels: ['sms'],
  };
}

export function welcomeMessage(user: { name: string }): NotificationMessage {
  return {
    type: NotificationTriggerType.WELCOME,
    title: '欢迎加入 SSE',
    body: `${user.name}，你的账号已创建，请登录系统完善个人信息。`,
    channels: ['email'],
  };
}
```

- [ ] **Step 3: 实现 factory**

```ts
import { PgNotificationRepo, PgUserRepo } from '@sse/db';
import { DevSmsProvider, createSmsProvider } from './channels/sms';
import { DevEmailProvider, createEmailProvider } from './channels/email';
import { NotificationService } from './notification-service';
import { NotificationEngine } from './notification-engine';

function smsProvider() {
  const type = process.env.SMS_PROVIDER;
  return !type || type === 'dev' || type === 'log'
    ? new DevSmsProvider()
    : createSmsProvider();
}

function emailProvider() {
  const type = process.env.EMAIL_PROVIDER;
  return !type || type === 'dev' || type === 'log'
    ? new DevEmailProvider()
    : createEmailProvider();
}

export function createNotificationEngine(): NotificationEngine {
  return new NotificationEngine(
    new PgNotificationRepo(),
    new PgUserRepo(),
    new NotificationService(smsProvider(), emailProvider()),
  );
}
```

- [ ] **Step 4: 导出**

`index.ts` 追加：

```ts
export { createNotificationEngine } from './factory';
export * from './events';
```

- [ ] **Step 5: 测试通过**

Run: `pnpm --filter @sse/notifications test`
Expected: PASS（9 个用例）。

- [ ] **Step 6: 提交**

```bash
git add packages/notifications
git commit -m "feat(notifications): add engine factory and event builders"
```

---

## Task 4: 调度器改走统一引擎

**Files:**
- Modify: `packages/notifications/src/scheduler.ts`
- Create: `packages/notifications/src/__tests__/scheduler.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
import { ApprovalReminderScheduler } from '../scheduler';

function harness() {
  const sent: any[] = [];
  const marked: string[] = [];
  const approvalRecordRepo = {
    async findPendingOverdue() {
      return [
        {
          id: 'ar1',
          reportId: 'r1',
          approverId: 'dept_approver',
          step: 1,
          result: 'pending',
          reminderSentAt: null,
        },
      ];
    },
    async markReminderSent(id: string) { marked.push(`reminder:${id}`); },
    async markEscalated(id: string) { marked.push(`escalated:${id}`); },
  };
  const userRepo = {
    async findById(id: string) {
      if (id === 'r1') return { id: 'u1', department: '技术部' };
      return { id, name: '李四', phone: '138', email: 'l@example.com' };
    },
    async findByRole(role: string) {
      return role === 'dept_approver'
        ? [{ id: 'u-approver', name: '李四', phone: '138', email: 'l@example.com' }]
        : [];
    },
  };
  const expenseRepo = {
    async findById() { return { id: 'r1', title: '差旅', userId: 'u1' }; },
  };
  const engine = {
    async send(...args: any[]) { sent.push(args); },
  };
  const scheduler = new ApprovalReminderScheduler(
    approvalRecordRepo as any,
    userRepo as any,
    expenseRepo as any,
    engine as any,
  );
  return { scheduler, sent, marked };
}

describe('ApprovalReminderScheduler', () => {
  it('sends reminders to the approver user id, not the approval record id', async () => {
    const { scheduler, sent, marked } = harness();

    await scheduler.tick();

    expect(sent[0][0]).toBe('u-approver');
    expect(sent[0][1]).toBe('approval_reminder');
    expect(sent[0][4]).toEqual(['sms', 'email']);
    expect(sent[0][5].emailBody).toContain('李四');
    expect(marked).toEqual(['reminder:ar1']);
  });

  it('escalates once a reminder was already sent', async () => {
    const { scheduler, sent, marked } = harness();
    (scheduler as any).approvalRecordRepo.findPendingOverdue = async () => [
      {
        id: 'ar2', reportId: 'r1', approverId: 'dept_approver', step: 1,
        result: 'pending', reminderSentAt: new Date(),
      },
    ];

    await scheduler.tick();

    expect(sent[0][1]).toBe('escalation');
    expect(marked).toEqual(['escalated:ar2']);
  });
});
```

Run: `pnpm --filter @sse/notifications test`
Expected: FAIL（构造函数参数未改）。

- [ ] **Step 2: 重构 scheduler**

构造函数改为：

```ts
constructor(
  private approvalRecordRepo: IApprovalRecordRepo,
  private userRepo: IUserRepo,
  private expenseRepo: IExpenseRepo,
  private notificationEngine: NotificationEngine,
) {}
```

删除 `notificationLogRepo`、`notificationService` 与 `sendSmsAndLog` / `sendEmailAndLog`。

`tick` 内改为：

```ts
for (const approver of approvers) {
  const messages = isEscalation
    ? escalationMessage(report.title, approver.name)
    : reminderMessage(report.title, approver.name);

  await this.notificationEngine.send(
    approver.id,
    triggerType,
    messages.email.subject,
    messages.sms,
    ['sms', 'email'],
    { emailBody: messages.email.body },
  );
}
```

导入改为 `NotificationEngine` 与 `NotificationTriggerType`。保留 `reportId` 不再需要。

- [ ] **Step 3: 修复重复扫描**

`packages/db/src/repositories/pg-approval-record-repo.ts` 的 `findPendingOverdue` 删除无意义 JOIN：

```sql
SELECT ar.* FROM approval_records ar
 WHERE ar.result = 'pending'
   AND ar.step_started_at < NOW() - INTERVAL '24 hours'
```

- [ ] **Step 4: 测试通过**

Run: `pnpm --filter @sse/notifications test`
Expected: PASS（11 个用例）。

- [ ] **Step 5: 提交**

```bash
git add packages/notifications packages/db/src/repositories/pg-approval-record-repo.ts
git commit -m "refactor(notifications): route reminders through the engine"
```

---

## Task 5: 业务事件接线

**Files:**
- Create: `packages/api/src/services/notifications.ts`
- Modify: `packages/api/src/routes/approvals.ts`
- Modify: `packages/api/src/routes/expenses.ts`
- Modify: `packages/api/src/routes/admin.ts`
- Modify: `packages/api/src/index.ts`

- [ ] **Step 1: API 通知服务**

```ts
import {
  createNotificationEngine,
  type NotificationEngine,
  type NotificationMessage,
} from '@sse/notifications';

let engine: NotificationEngine | null = null;

function getEngine(): NotificationEngine {
  if (!engine) engine = createNotificationEngine();
  return engine;
}

export async function sendNotificationSafe(
  userId: string,
  message: NotificationMessage,
): Promise<void> {
  try {
    await getEngine().send(
      userId,
      message.type,
      message.title,
      message.body,
      message.channels,
    );
  } catch (err: any) {
    console.warn('[Notification] 发送失败:', err?.message || err);
  }
}
```

`packages/notifications/src/index.ts` 需导出 `type NotificationMessage`（events 已导出）。

- [ ] **Step 2: 审批通过/驳回**

`approvals.ts` 顶部导入：

```ts
import {
  expenseApprovedMessage,
  expenseRejectedMessage,
} from '@sse/notifications';
import { sendNotificationSafe } from '../services/notifications';
```

在 `POST /:reportId/approve` 的三个「流程结束」分支（无规则、`isLastStep`、`nextRecord` 为空）中，`updateStatus(..., APPROVED)` 之后调用：

```ts
await sendNotificationSafe(
  report.userId,
  expenseApprovedMessage({ serialNo: report.serialNo, title: report.title }),
);
```

在 `POST /:reportId/reject` 的 `updateStatus(..., REJECTED)` 之后调用：

```ts
await sendNotificationSafe(
  report.userId,
  expenseRejectedMessage({ serialNo: report.serialNo, title: report.title }, comment),
);
```

- [ ] **Step 3: 打款完成**

`expenses.ts` 导入 `paymentPaidMessage` 与 `sendNotificationSafe`。在 `POST /:id/pay` 成功事务之后、`res.json` 之前：

```ts
await sendNotificationSafe(
  report.userId,
  paymentPaidMessage({ serialNo: report.serialNo, title: report.title }),
);
```

- [ ] **Step 4: 新用户欢迎**

`admin.ts` 导入 `welcomeMessage` 与 `sendNotificationSafe`。在创建用户成功后：

```ts
const created = mapUserRow(rows[0]);
await sendNotificationSafe(created.id, welcomeMessage({ name: created.name }));
res.status(201).json(created);
```

- [ ] **Step 5: 调度器 wiring**

`packages/api/src/index.ts` 的 `startScheduler` 改为：

```ts
const { PgApprovalRecordRepo, PgUserRepo, PgExpenseRepo } = await import('@sse/db');
const { ApprovalReminderScheduler, createNotificationEngine } = await import('@sse/notifications');

schedulerInstance = new ApprovalReminderScheduler(
  new PgApprovalRecordRepo(),
  new PgUserRepo(),
  new PgExpenseRepo(),
  createNotificationEngine(),
);
```

删除旧的 provider 构造代码。

- [ ] **Step 6: 构建**

Run: `pnpm --filter @sse/notifications build; pnpm --filter @sse/api build`
Expected: 退出码 0。

- [ ] **Step 7: 提交**

```bash
git add packages/api
git commit -m "feat(notifications): notify approval, payment and onboarding events"
```

---

## Task 6: 送达追踪接口与页面

**Files:**
- Modify: `packages/api/src/routes/admin-messages.ts`
- Modify: `packages/web/src/pages/AdminMessages.vue`

- [ ] **Step 1: 广播写入 system_message_id**

`admin-messages.ts` 中构造引擎的两处改为 `createNotificationEngine()`，`sendBatch` 最后一参传消息 ID：

```ts
await engine.sendBatch(
  targetUsers,
  'broadcast',
  title,
  finalBody,
  (delivery_channels || []).filter((c: string) => c === 'sms' || c === 'email') as ('sms' | 'email')[],
  msg.id,
);
```

`POST /:id/send` 同样传 `msg.id`。

- [ ] **Step 2: 新增送达明细接口**

```ts
router.get('/:id/deliveries', asyncWrap(async (req, res) => {
  const msg = await repo.findSystemMessageById(req.params.id);
  if (!msg) throw new AppError(404, 'NOT_FOUND', '消息不存在');
  const deliveries = await repo.findDeliveriesBySystemMessage(req.params.id);
  const summary = deliveries.reduce(
    (acc, row) => {
      acc.total += 1;
      acc[row.status] = (acc[row.status] || 0) + 1;
      return acc;
    },
    { total: 0 } as Record<string, number>,
  );
  res.json({ summary, deliveries });
}));
```

- [ ] **Step 3: 前端查看送达**

`AdminMessages.vue` 已发送项增加按钮：

```html
<button class="btn-secondary btn-sm" @click="openDeliveries(m.id)">查看送达</button>
```

新增弹窗（放在 AI 润色弹窗之后）：

```html
<div v-if="showDeliveries" class="modal-overlay" @click.self="showDeliveries = false">
  <div class="modal-card composer-modal">
    <h3 class="form-section-title font-heading">送达统计</h3>
    <p class="text-muted" style="font-size:0.82rem;">
      共 {{ deliverySummary.total || 0 }} 条 · 成功 {{ deliverySummary.sent || 0 }} ·
      失败 {{ deliverySummary.failed || 0 }} · 跳过 {{ deliverySummary.skipped || 0 }}
    </p>
    <div class="delivery-list">
      <div v-for="row in deliveryRows" :key="`${row.notificationId}-${row.channel}`" class="delivery-row">
        <span>{{ row.userName || row.userId }}</span>
        <span>{{ row.channel }}</span>
        <span :class="`delivery-status status-${row.status}`">{{ row.status }}</span>
        <span v-if="row.errorMessage" class="text-muted">{{ row.errorMessage }}</span>
      </div>
    </div>
    <div class="modal-actions">
      <button class="btn-text btn-sm" @click="showDeliveries = false">关闭</button>
    </div>
  </div>
</div>
```

脚本新增：

```ts
const showDeliveries = ref(false)
const deliveryRows = ref<any[]>([])
const deliverySummary = ref<Record<string, number>>({})

async function openDeliveries(id: string) {
  try {
    const res = await api.get(`/admin/messages/${id}/deliveries`)
    deliveryRows.value = res.data.deliveries || []
    deliverySummary.value = res.data.summary || {}
    showDeliveries.value = true
  } catch (err: any) {
    alert(err.response?.data?.error?.message || '加载送达统计失败')
  }
}
```

样式追加：

```css
.delivery-list { margin-top: 12px; max-height: 320px; overflow-y: auto; }
.delivery-row { display: grid; grid-template-columns: 1fr 80px 70px 1fr; gap: 8px; padding: 6px 0; border-bottom: 1px dashed var(--border-light); font-size: 0.82rem; }
.delivery-status.status-sent { color: #2f9e44; }
.delivery-status.status-failed { color: #c92a2a; }
.delivery-status.status-skipped { color: var(--text-muted); }
```

- [ ] **Step 4: 构建**

Run: `pnpm --filter @sse/api build; pnpm --filter @sse/web build`
Expected: 退出码 0。

- [ ] **Step 5: 提交**

```bash
git add packages/api/src/routes/admin-messages.ts packages/web/src/pages/AdminMessages.vue
git commit -m "feat(notifications): expose broadcast delivery tracking"
```

---

## Task 7: 偏好设置补全

**Files:**
- Modify: `packages/web/src/pages/Profile.vue`

- [ ] **Step 1: 增加升级催办选项**

在 SMS 通知分组中加入：

```html
<label><input type="checkbox" v-model="notifyPrefs.sms.escalation" /> 超时升级催办</label>
```

`notifyPrefs` 初始值改为：

```ts
const notifyPrefs = reactive({
  sms: { reminder: true, escalation: true, rejected: true, paid: false },
  email: { rejected: true, paid: false },
  broadcast: true,
})
```

- [ ] **Step 2: 构建**

Run: `pnpm --filter @sse/web build`
Expected: 退出码 0。

- [ ] **Step 3: 提交**

```bash
git add packages/web/src/pages/Profile.vue
git commit -m "feat(web): add escalation notification preference"
```

---

## Task 8: 文档与全量验证

**Files:**
- Create: `docs/2026-11-03-notification-completion.md`
- Modify: `README.md`

- [ ] **Step 1: 写过程文档**

记录：问题、实现、迁移 012、验证结果、仍需手动验证项（真实 SMTP/短信、真实数据库迁移）。

- [ ] **Step 2: README**

- Features 表 Notifications 行补一句「审批/打款/入职事件通知」。
- Documentation 表增加过程文档链接。

- [ ] **Step 3: 全量验证**

Run: `pnpm build`
Expected: 所有包 Done。

Run: `pnpm test`
Expected: core 33、auth 5、ai 60、db 13、ontology 8、notifications 11、api 17，全部通过。

- [ ] **Step 4: 提交**

```bash
git add README.md docs/2026-11-03-notification-completion.md
git commit -m "docs: record notification completion"
```

---

## 自审清单

- [x] 业务事件（approved/rejected/paid/welcome）均有接线任务。
- [x] 调度器偏好、收件人 ID、delivery 追踪均由 Task 4 覆盖。
- [x] 广播送达追踪有迁移、仓储、接口、页面（Task 1/6）。
- [x] 偏好 UI 补全（Task 7）。
- [x] 每项含失败测试、实现、通过验证、提交命令。
- [x] 无占位符；类型名在任务间一致（`SendOptions`、`NotificationMessage`、`SystemMessageDelivery`）。
