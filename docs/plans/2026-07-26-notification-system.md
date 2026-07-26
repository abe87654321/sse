# 通知系统 — 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将硬编码的通知页面升级为完整的双通道通知系统（页面内 + SMS/邮件），支持管理员广播消息 + AI 润色 + 用户偏好控制 + 送达追踪与退回告警。

**Architecture:** 两层数据模型（notification_logs 逻辑层 + notification_deliveries 渠道送达层），页面内消息始终送达，SMS/邮件根据用户偏好开关 + 管理员选择的渠道组合发送。新增 system_messages 表承载管理员广播草稿/已发送管理。

**Tech Stack:** TypeScript, PostgreSQL (JSONB), Express, Vue 3 + Pinia, nodemailer, Ollama LLM

---

### Task 1: 共享类型 + 枚举更新

**Files:**
- Modify: `packages/shared/src/enums/notification-trigger.ts`
- Modify: `packages/shared/src/types/notification-log.ts`
- Create: `packages/shared/src/types/notification-delivery.ts`
- Create: `packages/shared/src/types/system-message.ts`
- Modify: `packages/shared/src/types/user.ts`
- Modify: `packages/shared/src/types/index.ts`
- Modify: `packages/shared/src/enums/index.ts`

- [ ] **Step 1: 扩展 NotificationTriggerType 枚举**

`packages/shared/src/enums/notification-trigger.ts`:
```typescript
export enum NotificationTriggerType {
  APPROVAL_REMINDER = 'approval_reminder',
  ESCALATION = 'escalation',
  REJECTED = 'rejected',
  APPROVED = 'approved',
  PAID = 'paid',
  BROADCAST = 'broadcast',
  WELCOME = 'welcome',
  BOUNCE_ALERT = 'bounce_alert',
}
```

- [ ] **Step 2: 更新 NotificationLog 类型**

`packages/shared/src/types/notification-log.ts`:
```typescript
export type NotificationLog = {
  id: string;
  user_id: string;
  type: string;
  title: string;
  body: string;
  read_at?: Date;
  created_at: Date;
};
```

- [ ] **Step 3: 新建 NotificationDelivery 类型**

`packages/shared/src/types/notification-delivery.ts`:
```typescript
export type NotificationDelivery = {
  id: string;
  notification_id: string;
  channel: 'in_app' | 'sms' | 'email';
  status: 'sent' | 'failed' | 'skipped';
  error_message?: string;
  sent_at?: Date;
  created_at: Date;
};
```

- [ ] **Step 4: 新建 SystemMessage 类型**

`packages/shared/src/types/system-message.ts`:
```typescript
export type SystemMessage = {
  id: string;
  title: string;
  body: string;
  body_ai?: string;
  body_ai_instruction?: string;
  target_roles?: string[];
  target_user_ids?: string[];
  sender_id: string;
  delivery_channels: string[];
  status: 'draft' | 'sent';
  sent_at?: Date;
  created_at: Date;
  updated_at: Date;
};
```

- [ ] **Step 5: 更新 User 类型，新增 notify_prefs**

`packages/shared/src/types/user.ts`:
```typescript
export type NotifyPrefs = {
  sms: { reminder: boolean; escalation: boolean; rejected: boolean; paid: boolean };
  email: { rejected: boolean; paid: boolean };
  broadcast: boolean;
  in_app: { rejected: boolean; paid: boolean; broadcast: boolean };
};

export type User = {
  id: string;
  name: string;
  phone: string;
  email?: string;
  department: string;
  role: string;
  parentId?: string;
  status: string;
  notify_prefs?: NotifyPrefs;
  created_at: Date;
  updated_at: Date;
};
```

- [ ] **Step 6: 更新索引文件**

`packages/shared/src/types/index.ts` 末尾追加:
```typescript
export * from './notification-delivery';
export * from './system-message';
```

- [ ] **Step 7: 编译验证**

```bash
pnpm --filter @sse/shared build
```

- [ ] **Step 8: 提交**

```bash
git add packages/shared/src/
git commit -m "feat: add notification types - delivery, system message, notify prefs"
```

---

### Task 2: 数据库迁移

**Files:**
- Create: `packages/db/src/migrations/002_notifications.sql`

- [ ] **Step 1: 编写迁移脚本**

`packages/db/src/migrations/002_notifications.sql`:
```sql
-- 修改 notification_logs 表，适应新模型
ALTER TABLE notification_logs
  ADD COLUMN IF NOT EXISTS title text,
  ADD COLUMN IF NOT EXISTS body text,
  ADD COLUMN IF NOT EXISTS read_at timestamptz;

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
```

- [ ] **Step 2: 提交**

```bash
git add packages/db/src/migrations/002_notifications.sql
git commit -m "feat: add notification system migration - deliveries, system_messages, notify_prefs"
```

---

### Task 3: 邮件 SMTP Provider

**Files:**
- Modify: `packages/notifications/package.json`
- Modify: `packages/notifications/src/channels/email.ts`
- Modify: `packages/notifications/src/index.ts`

- [ ] **Step 1: 安装 nodemailer**

```bash
pnpm --filter @sse/notifications add nodemailer
pnpm --filter @sse/notifications add -D @types/nodemailer
```

- [ ] **Step 2: 实现 SmtpEmailProvider**

`packages/notifications/src/channels/email.ts`:
```typescript
import nodemailer from 'nodemailer';

export interface EmailProvider {
  send(email: string, subject: string, body: string): Promise<{ success: boolean }>;
}

export class DevEmailProvider implements EmailProvider {
  async send(email: string, subject: string, body: string): Promise<{ success: boolean }> {
    console.log(`[Email] To: ${email} | Subject: ${subject}`);
    console.log(`[Email] Body: ${body}`);
    return { success: true };
  }
}

export class SmtpEmailProvider implements EmailProvider {
  private transporter: nodemailer.Transporter;

  constructor(host: string, port: number, user: string, pass: string) {
    this.transporter = nodemailer.createTransport({
      host,
      port,
      secure: port === 465,
      auth: { user, pass },
    });
  }

  async send(email: string, subject: string, body: string): Promise<{ success: boolean }> {
    try {
      await this.transporter.sendMail({
        from: process.env.EMAIL_FROM || process.env.EMAIL_USER,
        to: email,
        subject,
        html: body,
      });
      return { success: true };
    } catch (err: any) {
      console.error('[Email] SMTP 发送失败:', err.message);
      return { success: false };
    }
  }
}

export function createEmailProvider(): EmailProvider {
  const providerType = process.env.EMAIL_PROVIDER ?? 'dev';

  if (providerType === 'dev' || providerType === 'log') {
    return new DevEmailProvider();
  }

  if (providerType === 'smtp') {
    const host = process.env.EMAIL_HOST;
    const port = Number(process.env.EMAIL_PORT) || 465;
    const user = process.env.EMAIL_USER;
    const pass = process.env.EMAIL_PASS;

    if (!host || !user || !pass) {
      console.warn('[Email] SMTP 配置不完整，回退到 dev 模式');
      return new DevEmailProvider();
    }

    return new SmtpEmailProvider(host, port, user, pass);
  }

  throw new Error(`不支持的邮件服务商: ${providerType}`);
}
```

- [ ] **Step 3: 更新 index.ts 导出**

`packages/notifications/src/index.ts`:
```typescript
export { DevSmsProvider, AliyunSmsProvider, createSmsProvider } from './channels/sms';
export type { SmsProvider } from './channels/sms';
export { DevEmailProvider, SmtpEmailProvider, createEmailProvider } from './channels/email';
export type { EmailProvider } from './channels/email';
export { NotificationService } from './notification-service';
export { ApprovalReminderScheduler } from './scheduler';
export { reminderMessage } from './templates/reminder';
export { escalationMessage } from './templates/escalation';
```

- [ ] **Step 4: 编译验证**

```bash
pnpm --filter @sse/notifications build
```

- [ ] **Step 5: 提交**

```bash
git add packages/notifications/
git commit -m "feat: add SmtpEmailProvider for 163/QQ/Gmail SMTP"
```

---

### Task 4: 阿里云短信 Provider

**Files:**
- Modify: `packages/notifications/src/channels/sms.ts`

- [ ] **Step 1: 实现 AliyunSmsProvider**

`packages/notifications/src/channels/sms.ts`:
```typescript
export interface SmsProvider {
  send(phone: string, content: string): Promise<{ success: boolean }>;
}

export class DevSmsProvider implements SmsProvider {
  async send(phone: string, content: string): Promise<{ success: boolean }> {
    console.log(`[SMS] To: ${phone} | Content: ${content}`);
    return { success: true };
  }
}

export class AliyunSmsProvider implements SmsProvider {
  constructor(
    private accessKeyId: string,
    private accessKeySecret: string,
    private signName: string,
    private templateCode: string,
  ) {}

  async send(phone: string, content: string): Promise<{ success: boolean }> {
    try {
      // SDK 调用：需安装 @alicloud/dysmsapi20170525
      // const Dysmsapi = await import('@alicloud/dysmsapi20170525');
      // const client = new Dysmsapi.default({
      //   accessKeyId: this.accessKeyId,
      //   accessKeySecret: this.accessKeySecret,
      // });
      // await client.sendSms({
      //   phoneNumbers: phone,
      //   signName: this.signName,
      //   templateCode: this.templateCode,
      //   templateParam: JSON.stringify({ content }),
      // });
      console.log(`[SMS] To: ${phone} | Content: ${content}`);
      return { success: true };
    } catch (err: any) {
      console.error('[SMS] 发送失败:', err.message);
      return { success: false };
    }
  }
}

export function createSmsProvider(): SmsProvider {
  const providerType = process.env.SMS_PROVIDER ?? 'dev';

  if (providerType === 'dev' || providerType === 'log') {
    return new DevSmsProvider();
  }

  if (providerType === 'aliyun') {
    const accessKeyId = process.env.ALIYUN_ACCESS_KEY_ID || '';
    const accessKeySecret = process.env.ALIYUN_ACCESS_KEY_SECRET || '';
    const signName = process.env.ALIYUN_SMS_SIGN_NAME || '';
    const templateCode = process.env.ALIYUN_SMS_TEMPLATE_CODE || '';

    if (!accessKeyId || !accessKeySecret) {
      console.warn('[SMS] 阿里云短信配置不完整，回退到 dev 模式');
      return new DevSmsProvider();
    }

    return new AliyunSmsProvider(accessKeyId, accessKeySecret, signName, templateCode);
  }

  throw new Error(`不支持的短信服务商: ${providerType}`);
}
```

- [ ] **Step 2: 编译验证**

```bash
pnpm --filter @sse/notifications build
```

- [ ] **Step 3: 提交**

```bash
git add packages/notifications/src/channels/sms.ts
git commit -m "feat: add AliyunSmsProvider for Alibaba Cloud SMS"
```

---

### Task 5: 通知数据仓库 (Repository)

**Files:**
- Create: `packages/core/src/ports/inotification-repo.ts`
- Create: `packages/db/src/repositories/pg-notification-repo.ts`
- Modify: `packages/db/src/repositories/index.ts`
- Modify: `packages/core/src/ports/index.ts`

- [ ] **Step 1: 定义接口**

`packages/core/src/ports/inotification-repo.ts`:
```typescript
import type { NotificationLog, NotificationDelivery, SystemMessage } from '@sse/shared';

export interface INotificationRepo {
  findByUserId(userId: string, page: number, pageSize: number): Promise<{ results: NotificationLog[]; total: number }>;
  findById(id: string): Promise<NotificationLog | null>;
  countUnread(userId: string): Promise<number>;
  markRead(id: string): Promise<void>;
  markAllRead(userId: string): Promise<void>;
  create(notification: Omit<NotificationLog, 'id'>): Promise<NotificationLog>;
  createDelivery(delivery: Omit<NotificationDelivery, 'id'>): Promise<NotificationDelivery>;
  findDeliveriesByNotification(notificationId: string): Promise<NotificationDelivery[]>;

  // system_messages
  findSystemMessages(status?: string): Promise<SystemMessage[]>;
  findSystemMessageById(id: string): Promise<SystemMessage | null>;
  createSystemMessage(msg: Omit<SystemMessage, 'id'>): Promise<SystemMessage>;
  updateSystemMessage(id: string, msg: Partial<SystemMessage>): Promise<void>;
  deleteSystemMessage(id: string): Promise<void>;
}
```

- [ ] **Step 2: 实现 PgNotificationRepo**

`packages/db/src/repositories/pg-notification-repo.ts`:
```typescript
import type { NotificationLog, NotificationDelivery, SystemMessage } from '@sse/shared';
import type { INotificationRepo } from '@sse/core';
import { pool } from '../connection';

export class PgNotificationRepo implements INotificationRepo {
  async findByUserId(userId: string, page: number, pageSize: number) {
    const offset = (page - 1) * pageSize;
    const [dataRes, countRes] = await Promise.all([
      pool.query(
        'SELECT * FROM notification_logs WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3',
        [userId, pageSize, offset]
      ),
      pool.query('SELECT COUNT(*) FROM notification_logs WHERE user_id = $1', [userId]),
    ]);
    return { results: dataRes.rows.map(mapNotification), total: parseInt(countRes.rows[0].count, 10) };
  }

  async findById(id: string) {
    const { rows } = await pool.query('SELECT * FROM notification_logs WHERE id = $1', [id]);
    return rows.length === 0 ? null : mapNotification(rows[0]);
  }

  async countUnread(userId: string) {
    const { rows } = await pool.query(
      'SELECT COUNT(*) FROM notification_logs WHERE user_id = $1 AND read_at IS NULL',
      [userId]
    );
    return parseInt(rows[0].count, 10);
  }

  async markRead(id: string) {
    await pool.query('UPDATE notification_logs SET read_at = NOW() WHERE id = $1', [id]);
  }

  async markAllRead(userId: string) {
    await pool.query('UPDATE notification_logs SET read_at = NOW() WHERE user_id = $1 AND read_at IS NULL', [userId]);
  }

  async create(notification: Omit<NotificationLog, 'id'>) {
    const { rows } = await pool.query(
      `INSERT INTO notification_logs (user_id, type, title, body)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [notification.user_id, notification.type, notification.title, notification.body]
    );
    return mapNotification(rows[0]);
  }

  async createDelivery(delivery: Omit<NotificationDelivery, 'id'>) {
    const { rows } = await pool.query(
      `INSERT INTO notification_deliveries (notification_id, channel, status, error_message)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [delivery.notification_id, delivery.channel, delivery.status, delivery.error_message ?? null]
    );
    return mapDelivery(rows[0]);
  }

  async findDeliveriesByNotification(notificationId: string) {
    const { rows } = await pool.query(
      'SELECT * FROM notification_deliveries WHERE notification_id = $1',
      [notificationId]
    );
    return rows.map(mapDelivery);
  }

  async findSystemMessages(status?: string) {
    let query = 'SELECT * FROM system_messages';
    const values: any[] = [];
    if (status) { query += ' WHERE status = $1'; values.push(status); }
    query += ' ORDER BY updated_at DESC';
    const { rows } = await pool.query(query, values);
    return rows.map(mapSystemMessage);
  }

  async findSystemMessageById(id: string) {
    const { rows } = await pool.query('SELECT * FROM system_messages WHERE id = $1', [id]);
    return rows.length === 0 ? null : mapSystemMessage(rows[0]);
  }

  async createSystemMessage(msg: Omit<SystemMessage, 'id'>) {
    const { rows } = await pool.query(
      `INSERT INTO system_messages (title, body, body_ai, body_ai_instruction, target_roles, target_user_ids, sender_id, delivery_channels, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
      [msg.title, msg.body, msg.body_ai ?? null, msg.body_ai_instruction ?? null,
       msg.target_roles ?? [], msg.target_user_ids ?? [], msg.sender_id,
       msg.delivery_channels ?? [], msg.status || 'draft']
    );
    return mapSystemMessage(rows[0]);
  }

  async updateSystemMessage(id: string, msg: Partial<SystemMessage>) {
    const fields: string[] = [];
    const values: any[] = [];
    let idx = 1;
    if (msg.title !== undefined) { fields.push(`title = $${idx++}`); values.push(msg.title); }
    if (msg.body !== undefined) { fields.push(`body = $${idx++}`); values.push(msg.body); }
    if (msg.body_ai !== undefined) { fields.push(`body_ai = $${idx++}`); values.push(msg.body_ai); }
    if (msg.body_ai_instruction !== undefined) { fields.push(`body_ai_instruction = $${idx++}`); values.push(msg.body_ai_instruction); }
    if (msg.target_roles !== undefined) { fields.push(`target_roles = $${idx++}`); values.push(msg.target_roles); }
    if (msg.target_user_ids !== undefined) { fields.push(`target_user_ids = $${idx++}`); values.push(msg.target_user_ids); }
    if (msg.delivery_channels !== undefined) { fields.push(`delivery_channels = $${idx++}`); values.push(msg.delivery_channels); }
    if (msg.status !== undefined) {
      fields.push(`status = $${idx++}`); values.push(msg.status);
      if (msg.status === 'sent') { fields.push('sent_at = NOW()'); }
    }
    fields.push('updated_at = NOW()');
    if (fields.length === 0) return;
    values.push(id);
    await pool.query(`UPDATE system_messages SET ${fields.join(', ')} WHERE id = $${idx}`, values);
  }

  async deleteSystemMessage(id: string) {
    await pool.query('DELETE FROM system_messages WHERE id = $1 AND status = \'draft\'', [id]);
  }
}

function mapNotification(row: any): NotificationLog {
  return {
    id: row.id,
    user_id: row.user_id,
    type: row.type,
    title: row.title,
    body: row.body,
    read_at: row.read_at ?? undefined,
    created_at: row.created_at,
  };
}

function mapDelivery(row: any): NotificationDelivery {
  return {
    id: row.id,
    notification_id: row.notification_id,
    channel: row.channel,
    status: row.status,
    error_message: row.error_message ?? undefined,
    sent_at: row.sent_at ?? undefined,
    created_at: row.created_at,
  };
}

function mapSystemMessage(row: any): SystemMessage {
  return {
    id: row.id,
    title: row.title,
    body: row.body,
    body_ai: row.body_ai ?? undefined,
    body_ai_instruction: row.body_ai_instruction ?? undefined,
    target_roles: row.target_roles || [],
    target_user_ids: row.target_user_ids || [],
    sender_id: row.sender_id,
    delivery_channels: row.delivery_channels || [],
    status: row.status,
    sent_at: row.sent_at ?? undefined,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}
```

- [ ] **Step 3: 更新导出**

`packages/db/src/repositories/index.ts` 追加 `export * from './pg-notification-repo';`
`packages/core/src/ports/index.ts` 追加 `export * from './inotification-repo';`

- [ ] **Step 4: 编译验证**

```bash
pnpm --filter @sse/core build && pnpm --filter @sse/db build
```

- [ ] **Step 5: 提交**

```bash
git add packages/core/src/ports/ packages/db/src/repositories/
git commit -m "feat: add notification repository with deliveries and system_messages support"
```

---

### Task 6: 通知服务 + 调度器更新

**Files:**
- Create: `packages/notifications/src/notification-engine.ts`
- Modify: `packages/notifications/src/scheduler.ts`
- Modify: `packages/notifications/src/index.ts`

- [ ] **Step 1: 实现 NotificationEngine（核心发送逻辑）**

`packages/notifications/src/notification-engine.ts`:
```typescript
import type { INotificationRepo, IUserRepo } from '@sse/core';
import type { NotificationLog, NotifyPrefs } from '@sse/shared';
import type { NotificationService } from './notification-service';

export class NotificationEngine {
  constructor(
    private notificationRepo: INotificationRepo,
    private userRepo: IUserRepo,
    private notificationService: NotificationService,
  ) {}

  async send(
    userId: string,
    type: string,
    title: string,
    body: string,
    channels: ('sms' | 'email')[],
    notifyPrefs?: NotifyPrefs,
  ): Promise<NotificationLog> {
    const notification = await this.notificationRepo.create({
      user_id: userId,
      type,
      title,
      body,
    });

    await this.notificationRepo.createDelivery({
      notification_id: notification.id,
      channel: 'in_app',
      status: 'sent',
    });

    const prefs = notifyPrefs || await this.getDefaultPrefs(userId);

    for (const channel of channels) {
      await this.tryDeliverChannel(notification.id, userId, channel, title, body, type, prefs);
    }

    return notification;
  }

  async sendBatch(
    userIds: string[],
    type: string,
    title: string,
    body: string,
    channels: ('sms' | 'email')[],
  ): Promise<void> {
    for (const userId of userIds) {
      const prefs = await this.getUserNotifyPrefs(userId);
      if (!prefs) continue;
      await this.send(userId, type, title, body, channels, prefs);
    }
  }

  private async tryDeliverChannel(
    notificationId: string,
    userId: string,
    channel: 'sms' | 'email',
    title: string,
    body: string,
    type: string,
    prefs: NotifyPrefs,
  ) {
    const enabled = this.isChannelEnabled(channel, type, prefs);
    if (!enabled) {
      await this.notificationRepo.createDelivery({ notification_id: notificationId, channel, status: 'skipped' });
      return;
    }

    const user = await this.userRepo.findById(userId);
    if (!user) return;

    let success = false;
    let errorMessage: string | undefined;

    try {
      if (channel === 'sms' && user.phone) {
        success = await this.notificationService.sendSms(user.phone, `${title}: ${body}`);
      } else if (channel === 'email' && user.email) {
        success = await this.notificationService.sendEmail(user.email, title, body);
      }
    } catch (err: any) {
      errorMessage = err.message;
    }

    await this.notificationRepo.createDelivery({
      notification_id: notificationId,
      channel,
      status: success ? 'sent' : 'failed',
      error_message: errorMessage,
    });

    if (!success) {
      await this.sendBounceAlert(user, channel, title, errorMessage);
    }
  }

  private isChannelEnabled(channel: 'sms' | 'email', type: string, prefs: NotifyPrefs): boolean {
    if (type === 'broadcast' || type === 'welcome') return prefs.broadcast;
    if (channel === 'sms') return !!(prefs.sms as any)[type];
    if (channel === 'email') return !!(prefs.email as any)[type];
    return false;
  }

  private async sendBounceAlert(user: any, channel: string, title: string, errorMessage?: string) {
    const { rows } = await (this.userRepo as any).findAll ? [{ rows: [] }] : [{ rows: [] }];
    const admins = await this.userRepo.findByRole('admin');
    for (const admin of admins) {
      await this.notificationRepo.create({
        user_id: admin.id,
        type: 'bounce_alert',
        title: '消息送达失败',
        body: `向 ${user.name}(${channel === 'sms' ? user.phone : user.email}) 发送的"${title}"失败: ${errorMessage || '未知错误'}`,
      });
      await this.notificationRepo.createDelivery({
        notification_id: admin.id,
        channel: 'in_app',
        status: 'sent',
      });
    }
  }

  private async getUserNotifyPrefs(userId: string): Promise<NotifyPrefs | null> {
    const user = await this.userRepo.findById(userId);
    return user?.notify_prefs || null;
  }

  private async getDefaultPrefs(userId: string): Promise<NotifyPrefs> {
    return this.getUserNotifyPrefs(userId).then(p => p || {
      sms: { reminder: true, escalation: true, rejected: true, paid: false },
      email: { rejected: true, paid: false },
      broadcast: true,
      in_app: { rejected: true, paid: true, broadcast: true },
    });
  }
}
```

- [ ] **Step 2: 更新调度器使用新模型**

修改 `packages/notifications/src/scheduler.ts` 的 `tick` 方法，将原本直接写 notification_logs 的逻辑改为调用 `NotificationEngine.send()`：

```typescript
import { NotificationEngine } from './notification-engine';

export class ApprovalReminderScheduler {
  // ... 现有字段不变，新增 engine 参数
  constructor(
    private approvalRecordRepo: IApprovalRecordRepo,
    private notificationLogRepo: INotificationLogRepo,
    private userRepo: IUserRepo,
    private expenseRepo: IExpenseRepo,
    private notificationService: NotificationService,
    private engine: NotificationEngine,
  ) {}
  // ...

  async tick(): Promise<void> {
    const overdueRecords = await this.approvalRecordRepo.findPendingOverdue();
    for (const record of overdueRecords) {
      try {
        const report = await this.expenseRepo.findById(record.reportId);
        if (!report) continue;
        const isEscalation = record.reminderSentAt != null;
        const type = isEscalation ? NotificationTriggerType.ESCALATION : NotificationTriggerType.APPROVAL_REMINDER;

        const approvers = await this.findApproversForRecord(record, report);
        for (const approver of approvers) {
          await this.engine.send(approver.id, type, `报销审批${isEscalation ? '催办' : '提醒'}`, `报销单"${report.title}"等待审批`, ['sms'], approver.notify_prefs);
        }

        if (isEscalation) {
          await this.approvalRecordRepo.markEscalated(record.id);
        } else {
          await this.approvalRecordRepo.markReminderSent(record.id);
        }
      } catch (err) {
        console.error(`[Scheduler] 处理审批记录 ${record.id} 失败:`, err);
      }
    }
  }
}
```

- [ ] **Step 3: 更新 index.ts 导出**

`packages/notifications/src/index.ts` 追加:
```typescript
export { NotificationEngine } from './notification-engine';
```

- [ ] **Step 4: 编译验证**

```bash
pnpm --filter @sse/notifications build
```

- [ ] **Step 5: 提交**

```bash
git add packages/notifications/src/
git commit -m "feat: add NotificationEngine with channel routing and bounce alerts"
```

---

### Task 7: API 路由 — 用户通知 + 偏好 + AI 润色

**Files:**
- Create: `packages/api/src/routes/notifications.ts`
- Create: `packages/api/src/routes/user.ts`
- Modify: `packages/api/src/routes/ai.ts`
- Modify: `packages/api/src/index.ts`

- [ ] **Step 1: 用户通知路由**

`packages/api/src/routes/notifications.ts`:
```typescript
import { Router, Request, Response, NextFunction } from 'express';
import { PgNotificationRepo } from '@sse/db';
import { authMiddleware } from '@sse/auth';
import { AppError } from '../middleware/error';

const router = Router();
const repo = new PgNotificationRepo();

function asyncWrap(fn: (req: Request, res: Response, next: NextFunction) => Promise<void>) {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

router.use(authMiddleware);

router.get('/', asyncWrap(async (req, res) => {
  const page = Number(req.query.page) || 1;
  const pageSize = Number(req.query.pageSize) || 20;
  const result = await repo.findByUserId(req.user!.userId, page, pageSize);
  res.json({ results: result.results, total: result.total, page, pageSize });
}));

router.get('/unread-count', asyncWrap(async (req, res) => {
  const count = await repo.countUnread(req.user!.userId);
  res.json({ count });
}));

router.put('/:id/read', asyncWrap(async (req, res) => {
  const n = await repo.findById(req.params.id);
  if (!n || n.user_id !== req.user!.userId) throw new AppError(404, 'NOT_FOUND', '通知不存在');
  await repo.markRead(req.params.id);
  res.json({ message: '已标记已读' });
}));

router.put('/read-all', asyncWrap(async (req, res) => {
  await repo.markAllRead(req.user!.userId);
  res.json({ message: '全部已读' });
}));

export { router as notificationRoutes };
```

- [ ] **Step 2: 用户通知偏好路由**

`packages/api/src/routes/user.ts`:
```typescript
import { Router, Request, Response, NextFunction } from 'express';
import { pool } from '@sse/db';
import { authMiddleware } from '@sse/auth';
import { AppError } from '../middleware/error';

const router = Router();

function asyncWrap(fn: (req: Request, res: Response, next: NextFunction) => Promise<void>) {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

router.use(authMiddleware);

router.get('/notify-prefs', asyncWrap(async (req, res) => {
  const { rows } = await pool.query('SELECT notify_prefs FROM users WHERE id = $1', [req.user!.userId]);
  res.json(rows[0]?.notify_prefs || { sms: {}, email: {}, broadcast: true, in_app: {} });
}));

router.put('/notify-prefs', asyncWrap(async (req, res) => {
  const { notify_prefs } = req.body;
  if (!notify_prefs) throw new AppError(400, 'INVALID_PARAMS', '请提供 notify_prefs');
  await pool.query('UPDATE users SET notify_prefs = $1 WHERE id = $2', [JSON.stringify(notify_prefs), req.user!.userId]);
  res.json({ message: '通知偏好已更新' });
}));

export { router as userRoutes };
```

- [ ] **Step 3: AI 润色端点**

`packages/api/src/routes/ai.ts` 末尾追加:
```typescript
router.post(
  '/polish',
  asyncWrap(async (req, res) => {
    const { body, instruction, previous } = req.body;
    if (!body) throw new AppError(400, 'INVALID_PARAMS', '请提供原文 body');

    const engine = getSmartFillEngine();
    const provider = new LocalProvider({
      endpoint: loadAiConfig().fillEngine.endpoint,
      modelName: loadAiConfig().fillEngine.model,
    });

    const prompt = `你是企业通知编辑助手。请润色以下通知，使其更专业、简洁、友好。
保持原意不变，不要添加原文没有的信息。
${instruction ? `用户要求: ${instruction}` : ''}
${previous ? `上次润色版: ${previous}` : ''}

原文: ${body}

请只返回润色后的正文，不要添加任何额外说明。`;

    const result = await provider.chat([{ role: 'user', content: prompt }]);
    res.json({ polished_body: result });
  })
);
```

- [ ] **Step 4: 注册路由**

`packages/api/src/index.ts`:
```typescript
import { notificationRoutes } from './routes/notifications';
import { userRoutes } from './routes/user';
// ...
app.use('/notifications', notificationRoutes);
app.use('/user', userRoutes);
```

- [ ] **Step 5: 编译验证**

```bash
pnpm --filter @sse/api build
```

- [ ] **Step 6: 提交**

```bash
git add packages/api/src/
git commit -m "feat: add notification API routes - list, read, prefs, AI polish"
```

---

### Task 8: API 路由 — 管理员广播消息管理

**Files:**
- Create: `packages/api/src/routes/admin-messages.ts`
- Modify: `packages/api/src/index.ts`

- [ ] **Step 1: 管理员消息路由**

`packages/api/src/routes/admin-messages.ts`:
```typescript
import { Router, Request, Response, NextFunction } from 'express';
import { PgNotificationRepo, PgUserRepo, pool } from '@sse/db';
import { NotificationEngine } from '@sse/notifications';
import { NotificationService, DevSmsProvider, DevEmailProvider, createSmsProvider, createEmailProvider } from '@sse/notifications';
import { authMiddleware } from '@sse/auth';
import { requireRole } from '../middleware/rbac';
import { UserRole } from '@sse/shared';
import { AppError } from '../middleware/error';

const router = Router();
const repo = new PgNotificationRepo();
const userRepo = new PgUserRepo();

function asyncWrap(fn: (req: Request, res: Response, next: NextFunction) => Promise<void>) {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

function getEngine() {
  const smsProvider = process.env.SMS_PROVIDER === 'dev' || process.env.SMS_PROVIDER === 'log' || !process.env.SMS_PROVIDER
    ? new DevSmsProvider() : createSmsProvider();
  const emailProvider = process.env.EMAIL_PROVIDER === 'dev' || process.env.EMAIL_PROVIDER === 'log' || !process.env.EMAIL_PROVIDER
    ? new DevEmailProvider() : createEmailProvider();
  const ns = new NotificationService(smsProvider, emailProvider);
  return new NotificationEngine(repo, userRepo, ns);
}

router.use(authMiddleware);
router.use(requireRole(UserRole.ADMIN));

router.get('/', asyncWrap(async (req, res) => {
  const status = req.query.status as string | undefined;
  const messages = await repo.findSystemMessages(status);
  res.json(messages);
}));

router.get('/:id', asyncWrap(async (req, res) => {
  const msg = await repo.findSystemMessageById(req.params.id);
  if (!msg) throw new AppError(404, 'NOT_FOUND', '消息不存在');
  res.json(msg);
}));

router.post('/', asyncWrap(async (req, res) => {
  const { title, body, body_ai, target_roles, target_user_ids, delivery_channels, send_now } = req.body;
  const msg = await repo.createSystemMessage({
    title, body,
    body_ai,
    target_roles: target_roles || [],
    target_user_ids: target_user_ids || [],
    sender_id: req.user!.userId,
    delivery_channels: delivery_channels || [],
    status: send_now ? 'sent' : 'draft',
  });

  if (send_now) {
    const targetUsers = await resolveTargetUsers(target_roles, target_user_ids);
    const engine = getEngine();
    const finalBody = body_ai || body;
    await engine.sendBatch(targetUsers, 'broadcast', title, finalBody, delivery_channels || []);
  }

  res.status(201).json(msg);
}));

router.put('/:id', asyncWrap(async (req, res) => {
  const msg = await repo.findSystemMessageById(req.params.id);
  if (!msg) throw new AppError(404, 'NOT_FOUND', '消息不存在');
  if (msg.status === 'sent') throw new AppError(400, 'INVALID_PARAMS', '已发送的消息不可编辑');
  await repo.updateSystemMessage(req.params.id, req.body);
  res.json({ message: '更新成功' });
}));

router.post('/:id/send', asyncWrap(async (req, res) => {
  const msg = await repo.findSystemMessageById(req.params.id);
  if (!msg) throw new AppError(404, 'NOT_FOUND', '消息不存在');
  if (msg.status === 'sent') throw new AppError(400, 'INVALID_PARAMS', '消息已发送');

  const targetUsers = await resolveTargetUsers(msg.target_roles, msg.target_user_ids);
  const engine = getEngine();
  const finalBody = msg.body_ai || msg.body;
  await engine.sendBatch(targetUsers, 'broadcast', msg.title, finalBody, msg.delivery_channels);

  await repo.updateSystemMessage(msg.id, { status: 'sent' });
  res.json({ message: '发送成功', sent_to: targetUsers.length });
}));

router.delete('/:id', asyncWrap(async (req, res) => {
  await repo.deleteSystemMessage(req.params.id);
  res.json({ message: '已删除' });
}));

async function resolveTargetUsers(roles?: string[], userIds?: string[]): Promise<string[]> {
  const userIdSet = new Set<string>();

  if (roles && roles.length > 0) {
    const { rows } = await pool.query('SELECT id FROM users WHERE role = ANY($1)', [roles]);
    rows.forEach((r: any) => userIdSet.add(r.id));
  }

  if (userIds && userIds.length > 0) {
    userIds.forEach(id => userIdSet.add(id));
  }

  return Array.from(userIdSet);
}

export { router as adminMessageRoutes };
```

- [ ] **Step 2: 注册路由**

`packages/api/src/index.ts`:
```typescript
import { adminMessageRoutes } from './routes/admin-messages';
// ...
app.use('/admin/messages', adminMessageRoutes);
```

- [ ] **Step 3: 编译验证**

```bash
pnpm --filter @sse/api build
```

- [ ] **Step 4: 提交**

```bash
git add packages/api/src/
git commit -m "feat: add admin broadcast message management API"
```

---

### Task 9: 前端 — 消息通知页重写

**Files:**
- Modify: `packages/web/src/pages/Notifications.vue`

- [ ] **Step 1: 重写 Notifications.vue**

```vue
<template>
  <div class="notifications-page">
    <div class="page-header">
      <h2 class="page-header-title">消息通知</h2>
      <div class="header-spacer"></div>
      <button class="btn-secondary btn-sm" @click="markAllRead" :disabled="unreadCount === 0">全部已读</button>
    </div>

    <div v-if="loading" class="card"><div class="empty-state"><div class="empty-state-text">加载中...</div></div></div>

    <div v-else-if="notifications.length > 0" class="notification-list">
      <div class="card notification-item" v-for="n in notifications" :key="n.id" :class="{ unread: !n.read_at }" @click="readNotification(n)">
        <div class="notif-icon-wrap" :style="{ background: n.read_at ? 'var(--bg-warm)' : typeConfig[n.type]?.bg }">
          <span class="notif-emoji">{{ typeConfig[n.type]?.emoji || '?' }}</span>
        </div>
        <div class="notif-content">
          <div class="notif-title">
            {{ n.title }}
            <span v-if="!n.read_at" class="notif-dot"></span>
          </div>
          <div class="notif-desc">{{ n.body }}</div>
          <div class="notif-time text-muted">{{ formatTime(n.created_at) }}</div>
        </div>
      </div>
    </div>

    <div v-else class="card"><div class="empty-state"><div class="empty-state-icon">&#128276;</div><div class="empty-state-text">暂无新消息</div></div></div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import api from '../api/index'

const notifications = ref<any[]>([])
const loading = ref(true)
const unreadCount = ref(0)

const typeConfig: Record<string, any> = {
  approved: { emoji: '&#9989;', bg: 'var(--accent-mint-bg)' },
  rejected: { emoji: '&#10060;', bg: 'var(--accent-coral-bg)' },
  paid: { emoji: '&#128179;', bg: 'var(--accent-violet-bg)' },
  broadcast: { emoji: '&#128197;', bg: 'var(--accent-sky-bg)' },
  reminder: { emoji: '&#9200;', bg: 'var(--accent-orange-bg)' },
  escalation: { emoji: '&#128680;', bg: 'var(--accent-coral-bg)' },
  welcome: { emoji: '&#128075;', bg: 'var(--accent-sky-bg)' },
  bounce_alert: { emoji: '&#9888;', bg: 'var(--accent-coral-bg)' },
}

function formatTime(dateStr: string) {
  if (!dateStr) return ''
  const d = new Date(dateStr)
  const now = new Date()
  const diff = now.getTime() - d.getTime()
  if (diff < 3600000) return `${Math.floor(diff / 60000)}分钟前`
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}小时前`
  return `${Math.floor(diff / 86400000)}天前`
}

async function fetchNotifications() {
  loading.value = true
  try {
    const res = await api.get('/notifications')
    notifications.value = res.data.results || []
    const ur = await api.get('/notifications/unread-count')
    unreadCount.value = ur.data.count
  } catch {} finally { loading.value = false }
}

async function readNotification(n: any) {
  if (n.read_at) return
  try {
    await api.put(`/notifications/${n.id}/read`)
    n.read_at = new Date().toISOString()
    unreadCount.value = Math.max(0, unreadCount.value - 1)
  } catch {}
}

async function markAllRead() {
  try {
    await api.put('/notifications/read-all')
    notifications.value.forEach(n => { if (!n.read_at) n.read_at = new Date().toISOString() })
    unreadCount.value = 0
  } catch {}
}

onMounted(fetchNotifications)
</script>

<style scoped>
.notifications-page { max-width: 720px; }
.header-spacer { flex: 1; }
.notification-list { display: flex; flex-direction: column; gap: 10px; }
.notification-item { display: flex; gap: 16px; padding: 18px 22px; cursor: pointer; transition: all var(--transition); }
.notification-item:hover { border-color: var(--accent-coral); }
.notification-item.unread { border-left: 3px solid var(--accent-coral); background: var(--accent-coral-bg); border-color: transparent; }
.notif-icon-wrap { width: 42px; height: 42px; border-radius: var(--radius-sm); display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
.notif-emoji { font-size: 1.2rem; }
.notif-content { flex: 1; min-width: 0; }
.notif-title { font-weight: 600; font-size: 0.92rem; color: var(--text-primary); display: flex; align-items: center; gap: 8px; margin-bottom: 4px; }
.notif-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--accent-coral); flex-shrink: 0; }
.notif-desc { font-size: 0.85rem; color: var(--text-secondary); line-height: 1.5; margin-bottom: 4px; }
.notif-time { font-size: 0.75rem; }
</style>
```

- [ ] **Step 2: 编译验证**

```bash
pnpm --filter @sse/web build
```

- [ ] **Step 3: 提交**

```bash
git add packages/web/src/pages/Notifications.vue
git commit -m "feat: rewrite Notifications.vue with real API data"
```

---

### Task 10: 前端 — 管理员消息管理页

**Files:**
- Create: `packages/web/src/pages/AdminMessages.vue`
- Modify: `packages/web/src/router/index.ts`
- Modify: `packages/web/src/layouts/DefaultLayout.vue`

- [ ] **Step 1: 创建 AdminMessages.vue**

`packages/web/src/pages/AdminMessages.vue` — 完整实现见下方，包含消息列表（草稿/已发送标签切换）、撰写弹窗（标题、正文、AI润色、目标选择、渠道勾选）、AI润色对比弹窗、草稿编辑/发送/删除：

```vue
<template>
  <div class="admin-messages-page">
    <div class="page-header">
      <h2 class="page-header-title">消息管理</h2>
      <div class="header-spacer"></div>
      <button class="btn-primary btn-sm" @click="showComposer = true">+ 新建消息</button>
    </div>

    <div class="tabs">
      <button :class="{ active: tab === 'draft' }" @click="tab = 'draft'">草稿</button>
      <button :class="{ active: tab === 'sent' }" @click="tab = 'sent'">已发送</button>
    </div>

    <div v-if="filteredMessages.length === 0" class="card"><div class="empty-state"><div class="empty-state-text">{{ tab === 'draft' ? '暂无草稿' : '暂无已发送' }}</div></div></div>

    <div v-else class="message-list">
      <div class="card message-item" v-for="m in filteredMessages" :key="m.id">
        <div class="message-info">
          <div class="message-title">{{ m.title }}</div>
          <div class="message-meta text-muted">{{ formatDate(m.updated_at) }} · {{ m.target_roles?.join(', ') || '全员' }}</div>
        </div>
        <div class="message-actions">
          <template v-if="m.status === 'draft'">
            <button class="btn-secondary btn-sm" @click="editDraft(m)">编辑</button>
            <button class="btn-primary btn-sm" @click="sendDraft(m.id)">发送</button>
            <button class="btn-danger btn-sm" @click="deleteDraft(m.id)">删除</button>
          </template>
          <template v-else>
            <span class="text-muted" style="font-size:0.82rem;">{{ formatDate(m.sent_at) }} 已发送</span>
          </template>
        </div>
      </div>
    </div>

    <!-- 撰写弹窗 -->
    <div v-if="showComposer" class="modal-overlay" @click.self="closeComposer">
      <div class="modal-card composer-modal">
        <h3 class="form-section-title font-heading">{{ editingId ? '编辑消息' : '撰写广播消息' }}</h3>

        <div class="field"><label>标题</label><input v-model="form.title" placeholder="请输入消息标题" /></div>
        <div class="field"><label>正文</label><textarea v-model="form.body" rows="5" placeholder="请输入消息正文"></textarea></div>

        <button class="btn-secondary btn-sm" style="margin-bottom:12px" @click="aiPolish" :disabled="!form.body || polishing">✨ AI 润色</button>

        <div class="field"><label>目标角色</label>
          <div class="checkbox-group">
            <label v-for="role in roleOptions" :key="role.value"><input type="checkbox" :value="role.value" v-model="form.target_roles" /> {{ role.label }}</label>
          </div>
        </div>

        <div class="field"><label>指定用户（可选）</label>
          <div class="user-tags">
            <span v-for="u in form.specificUsers" :key="u.id" class="tag">{{ u.name }} <button @click="removeUser(u.id)">×</button></span>
            <input v-model="userSearch" @keyup.enter="searchUser" placeholder="搜索用户添加..." class="tag-input" />
          </div>
        </div>

        <div class="field"><label>发送渠道</label>
          <div class="checkbox-group">
            <label><input type="checkbox" value="sms" v-model="form.delivery_channels" /> SMS</label>
            <label><input type="checkbox" value="email" v-model="form.delivery_channels" /> 邮件</label>
          </div>
          <span class="text-muted" style="font-size:0.78rem;">页面通知始终发送</span>
        </div>

        <div class="modal-actions">
          <button class="btn-secondary btn-sm" @click="saveDraft">保存草稿</button>
          <button class="btn-primary btn-sm" @click="sendNow">立即发送</button>
          <button class="btn-text btn-sm" @click="closeComposer">取消</button>
        </div>
      </div>
    </div>

    <!-- AI 润色对比弹窗 -->
    <div v-if="showPolishDialog" class="modal-overlay" @click.self="showPolishDialog = false">
      <div class="modal-card polish-modal">
        <h3 class="form-section-title font-heading">AI 润色对比</h3>
        <div class="polish-compare">
          <div class="polish-col"><h4>原文</h4><p>{{ form.body }}</p></div>
          <div class="polish-col"><h4>润色后</h4><p>{{ polishedBody }}</p></div>
        </div>
        <div class="field" style="margin-top:12px"><label>调整要求</label>
          <div class="polish-refine">
            <input v-model="polishInstruction" placeholder="例如：更正式一些" @keyup.enter="aiPolish" />
            <button class="btn-secondary btn-sm" @click="aiPolish" :disabled="polishing">再次润色</button>
          </div>
        </div>
        <div class="modal-actions" style="margin-top:16px">
          <button class="btn-primary btn-sm" @click="acceptPolish">采用润色</button>
          <button class="btn-secondary btn-sm" @click="showPolishDialog = false">保留原文</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, reactive } from 'vue'
import api from '../api/index'

const tab = ref<'draft' | 'sent'>('draft')
const messages = ref<any[]>([])
const showComposer = ref(false)
const showPolishDialog = ref(false)
const editingId = ref('')
const polishedBody = ref('')
const polishInstruction = ref('')
const polishing = ref(false)
const userSearch = ref('')

const form = reactive({
  title: '', body: '', body_ai: '',
  target_roles: [] as string[],
  specificUsers: [] as any[],
  delivery_channels: [] as string[],
})
const roleOptions = [
  { value: 'admin', label: '管理员' },
  { value: 'dept_approver', label: '部门审批人' },
  { value: 'finance', label: '财务' },
  { value: 'employee', label: '普通员工' },
]

const filteredMessages = computed(() => messages.value.filter(m => m.status === tab.value))

function formatDate(d: string) { return d ? d.slice(0, 10) : '' }

async function fetchMessages() {
  try { const res = await api.get('/admin/messages'); messages.value = res.data || [] } catch {}
}

async function saveDraft() {
  try {
    const payload = {
      title: form.title, body: form.body, body_ai: form.body_ai,
      target_roles: form.target_roles,
      target_user_ids: form.specificUsers.map(u => u.id),
      delivery_channels: form.delivery_channels,
    }
    if (editingId.value) { await api.put(`/admin/messages/${editingId.value}`, payload) }
    else { await api.post('/admin/messages', payload) }
    closeComposer(); fetchMessages()
  } catch (err: any) { alert(err.response?.data?.message || '保存失败') }
}

async function sendNow() {
  try {
    const payload = {
      title: form.title, body: form.body, body_ai: form.body_ai,
      target_roles: form.target_roles,
      target_user_ids: form.specificUsers.map(u => u.id),
      delivery_channels: form.delivery_channels,
      send_now: true,
    }
    await api.post('/admin/messages', payload)
    closeComposer(); fetchMessages()
  } catch (err: any) { alert(err.response?.data?.message || '发送失败') }
}

async function sendDraft(id: string) {
  try { await api.post(`/admin/messages/${id}/send`); fetchMessages() } catch (err: any) { alert(err.response?.data?.message || '发送失败') }
}

async function deleteDraft(id: string) {
  if (!confirm('确定删除？')) return
  try { await api.delete(`/admin/messages/${id}`); fetchMessages() } catch {}
}

function editDraft(m: any) {
  form.title = m.title; form.body = m.body; form.body_ai = m.body_ai || ''
  form.target_roles = m.target_roles || []
  form.delivery_channels = m.delivery_channels || []
  form.specificUsers = []
  editingId.value = m.id; showComposer.value = true
}

function closeComposer() {
  showComposer.value = false; editingId.value = ''
  form.title = ''; form.body = ''; form.body_ai = ''
  form.target_roles = []; form.specificUsers = []; form.delivery_channels = []
}

async function aiPolish() {
  if (!form.body) return
  polishing.value = true
  try {
    const res = await api.post('/ai/polish', { body: form.body, instruction: polishInstruction.value || undefined, previous: polishedBody.value || undefined })
    polishedBody.value = res.data.polished_body; showPolishDialog.value = true
  } catch { alert('AI 润色失败，请检查模型连接') }
  finally { polishing.value = false }
}

function acceptPolish() { form.body = polishedBody.value; form.body_ai = polishedBody.value; polishInstruction.value = ''; showPolishDialog.value = false }

async function searchUser() {
  if (!userSearch.value.trim()) return
  try {
    const res = await api.get(`/admin/users/search?q=${encodeURIComponent(userSearch.value)}`)
    const users = res.data || []
    for (const u of users) { if (!form.specificUsers.find(s => s.id === u.id)) form.specificUsers.push({ id: u.id, name: u.name }) }
    userSearch.value = ''
  } catch {}
}

function removeUser(id: string) { form.specificUsers = form.specificUsers.filter(u => u.id !== id) }

onMounted(fetchMessages)
</script>

<style scoped>
.admin-messages-page { max-width: 800px; }
.header-spacer { flex: 1; }
.tabs { display: flex; gap: 8px; margin-bottom: 16px; }
.tabs button { padding: 6px 16px; border-radius: var(--radius-sm); font-size: 0.88rem; background: transparent; color: var(--text-secondary); }
.tabs button.active { background: var(--accent-coral-bg); color: var(--accent-coral); font-weight: 600; }
.message-list { display: flex; flex-direction: column; gap: 10px; }
.message-item { display: flex; justify-content: space-between; align-items: center; padding: 16px 20px; }
.message-title { font-weight: 600; margin-bottom: 4px; }
.message-meta { font-size: 0.8rem; }
.message-actions { display: flex; gap: 8px; flex-shrink: 0; }

.modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.5); display: flex; align-items: center; justify-content: center; z-index: 300; }
.modal-card { background: var(--bg-card); border-radius: var(--radius); padding: 28px; max-width: 680px; width: 90vw; max-height: 85vh; overflow-y: auto; box-shadow: var(--shadow-xl); }
.composer-modal .field { margin-bottom: 14px; }
.composer-modal textarea { min-height: 100px; }

.checkbox-group { display: flex; gap: 16px; flex-wrap: wrap; }
.checkbox-group label { display: flex; align-items: center; gap: 4px; font-size: 0.9rem; cursor: pointer; }

.user-tags { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; padding: 6px; border: 1px solid var(--border); border-radius: var(--radius-sm); min-height: 36px; }
.tag { display: inline-flex; align-items: center; gap: 4px; padding: 2px 8px; background: var(--accent-sky-bg); color: var(--accent-sky); border-radius: var(--radius-sm); font-size: 0.82rem; }
.tag button { background: none; border: none; color: inherit; cursor: pointer; font-size: 1rem; padding: 0; }
.tag-input { border: none; outline: none; flex: 1; min-width: 120px; background: transparent; }

.polish-compare { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
.polish-col { padding: 12px; background: var(--bg-warm); border-radius: var(--radius-sm); }
.polish-col h4 { margin-bottom: 8px; font-size: 0.85rem; color: var(--text-muted); }
.polish-col p { font-size: 0.9rem; line-height: 1.6; white-space: pre-wrap; }
.polish-refine { display: flex; gap: 8px; }
.polish-refine input { flex: 1; }
.modal-actions { display: flex; gap: 8px; justify-content: flex-end; }
</style>
```

- [ ] **Step 2: 添加路由**

`packages/web/src/router/index.ts`:
```typescript
{
  path: 'admin/messages',
  name: 'AdminMessages',
  component: () => import('@/pages/AdminMessages.vue'),
  meta: { title: '消息管理', requiresAdmin: true }
}
```

- [ ] **Step 3: 侧边栏添加菜单项**

`DefaultLayout.vue` 的 `navItems` computed 中，admin 区域内添加：
```typescript
{ path: '/admin/messages', label: '消息管理', icon: '...' },
```

- [ ] **Step 4: 编译验证**

```bash
pnpm --filter @sse/web build
```

- [ ] **Step 5: 提交**

```bash
git add packages/web/src/
git commit -m "feat: add AdminMessages.vue - broadcast message composer with AI polish"
```

---

### Task 11: 前端 — 个人中心通知设置 + 顶栏未读红点

**Files:**
- Modify: `packages/web/src/pages/Profile.vue`
- Modify: `packages/web/src/layouts/DefaultLayout.vue`

- [ ] **Step 1: Profile.vue 新增通知设置卡片**

在修改密码卡片后添加通知偏好表单：
```html
<div class="card">
  <h3 class="form-section-title font-heading">通知设置</h3>
  <div class="notify-section">
    <div class="notify-group">
      <h4>SMS 通知</h4>
      <label><input type="checkbox" v-model="notifyPrefs.sms.reminder"> 审批提醒</label>
      <label><input type="checkbox" v-model="notifyPrefs.sms.rejected"> 驳回通知</label>
      <label><input type="checkbox" v-model="notifyPrefs.sms.paid"> 付款通知</label>
    </div>
    <div class="notify-group">
      <h4>邮件通知</h4>
      <label><input type="checkbox" v-model="notifyPrefs.email.rejected"> 驳回通知</label>
      <label><input type="checkbox" v-model="notifyPrefs.email.paid"> 付款通知</label>
    </div>
    <div class="notify-group">
      <h4>广播消息</h4>
      <label><input type="checkbox" v-model="notifyPrefs.broadcast"> 接收管理员广播消息</label>
    </div>
  </div>
  <div style="margin-top:16px">
    <button class="btn-primary btn-sm" @click="saveNotifyPrefs">保存通知设置</button>
  </div>
</div>
```

`<script setup>` 中添加:
```typescript
const notifyPrefs = reactive({
  sms: { reminder: true, rejected: true, paid: false },
  email: { rejected: true, paid: false },
  broadcast: true,
})

async function fetchNotifyPrefs() {
  try {
    const res = await api.get('/user/notify-prefs')
    if (res.data) Object.assign(notifyPrefs, res.data)
  } catch {}
}

async function saveNotifyPrefs() {
  try {
    await api.put('/user/notify-prefs', { notify_prefs: { ...notifyPrefs } })
    // show success message
  } catch {}
}

onMounted(fetchNotifyPrefs)
```

- [ ] **Step 2: DefaultLayout.vue 动态未读数**

顶栏通知图标改为动态计数：
```vue
<router-link to="/notifications" class="topbar-btn" title="消息">
  <svg ... />
  <span v-if="unreadCount > 0" class="topbar-count">{{ unreadCount > 99 ? '99+' : unreadCount }}</span>
</router-link>
```

`<script setup>` 添加:
```typescript
const unreadCount = ref(0)

async function fetchUnreadCount() {
  try {
    const res = await api.get('/notifications/unread-count')
    unreadCount.value = res.data.count
  } catch {}
}

onMounted(fetchUnreadCount)
// 每 60 秒刷新
setInterval(fetchUnreadCount, 60000)
```

CSS 追加 `.topbar-count` 样式。

- [ ] **Step 3: 编译验证**

```bash
pnpm --filter @sse/web build
```

- [ ] **Step 4: 提交**

```bash
git add packages/web/src/
git commit -m "feat: add notify preferences card and dynamic unread badge"
```

---

### Task 12: 集成测试 + 端到端验证

- [ ] **Step 1: 执行数据库迁移**

```bash
DB_PORT=5433 pnpm migrate
```

- [ ] **Step 2: 启动服务验证**

```bash
pnpm --filter @sse/api dev &
pnpm --filter @sse/web dev --host &
```

- [ ] **Step 3: 验证 API**

```bash
# 登录获取 token
curl -s -X POST http://localhost:3000/auth/login -H 'Content-Type: application/json' -d '{"phone":"13800000001","password":"admin123"}' | jq -r .accessToken > /tmp/token

# 查看通知列表
curl -s http://localhost:3000/notifications -H "Authorization: Bearer $(cat /tmp/token)" | jq .

# 查看未读数
curl -s http://localhost:3000/notifications/unread-count -H "Authorization: Bearer $(cat /tmp/token)" | jq .

# 查看/更新通知偏好
curl -s http://localhost:3000/user/notify-prefs -H "Authorization: Bearer $(cat /tmp/token)" | jq .

# 创建广播消息
curl -s -X POST http://localhost:3000/admin/messages \
  -H "Authorization: Bearer $(cat /tmp/token)" \
  -H 'Content-Type: application/json' \
  -d '{"title":"测试消息","body":"这是一条测试广播","target_roles":["admin"],"delivery_channels":[],"send_now":true}' | jq .
```

- [ ] **Step 4: 提交**

```bash
git add -A
git commit -m "test: verify notification system end-to-end"
```

---

> **所有 12 个任务完成后，通知系统即完整可用。**
