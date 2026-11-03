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
    u1: {
      id: 'u1',
      name: '张三',
      phone: '13800000001',
      email: 'a@example.com',
      notify_prefs: { ...prefs, broadcast: false },
    },
    u2: {
      id: 'u2',
      name: '李四',
      phone: '13800000002',
      email: 'b@example.com',
      notify_prefs: { ...prefs, broadcast: false },
    },
    admin: { id: 'admin', name: '管理员', phone: '13800000000', email: 'admin@example.com', notify_prefs: prefs },
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
      notifyPrefs: prefs as any,
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

  it('maps approval_reminder to the reminder preference key', async () => {
    const enabled = harness();

    await enabled.engine.send(
      'u1',
      NotificationTriggerType.APPROVAL_REMINDER,
      '提醒',
      '正文',
      ['sms'],
      { notifyPrefs: { ...prefs, sms: { ...prefs.sms, reminder: true } } as any },
    );

    expect(enabled.sentSms).toEqual([{ phone: '13800000001', content: '提醒: 正文' }]);

    const disabled = harness();

    await disabled.engine.send(
      'u1',
      NotificationTriggerType.APPROVAL_REMINDER,
      '提醒',
      '正文',
      ['sms'],
      { notifyPrefs: { ...prefs, sms: { ...prefs.sms, reminder: false } } as any },
    );

    expect(disabled.sentSms).toHaveLength(0);
    expect(disabled.deliveries.at(-1)).toEqual(
      expect.objectContaining({ channel: 'sms', status: 'skipped' })
    );
  });

  it('allows email reminders via defaults when the email pref omits the key', async () => {
    const { engine, sentEmail } = harness();

    await engine.send(
      'u1',
      NotificationTriggerType.APPROVAL_REMINDER,
      '提醒',
      '正文',
      ['email'],
    );

    expect(sentEmail).toHaveLength(1);
  });

  it('returns null and creates nothing for an unknown user', async () => {
    const { engine, notifications, deliveries } = harness();

    const result = await engine.send('missing', NotificationTriggerType.REJECTED, '驳回', '正文', ['sms']);

    expect(result).toBeNull();
    expect(notifications).toHaveLength(0);
    expect(deliveries).toHaveLength(0);
  });

  it('skips broadcast for a user who disabled broadcasts', async () => {
    const direct = harness();

    const result = await direct.engine.send(
      'u1',
      NotificationTriggerType.BROADCAST,
      '公告',
      '正文',
      [],
    );

    expect(result).toBeNull();
    expect(direct.notifications).toHaveLength(0);
    expect(direct.deliveries).toHaveLength(0);

    const batch = harness();

    await batch.engine.sendBatch(['u2'], NotificationTriggerType.BROADCAST, '公告', '正文', []);

    expect(batch.notifications).toHaveLength(0);
    expect(batch.deliveries).toHaveLength(0);
  });

  it('falls back to defaults without throwing when preferences are malformed', async () => {
    const { engine, notifications, deliveries } = harness();

    await expect(
      engine.send('u1', NotificationTriggerType.REJECTED, '驳回', '正文', ['sms'], {
        notifyPrefs: {} as any,
      })
    ).resolves.toBeTruthy();

    expect(notifications).toHaveLength(1);
    expect(deliveries).toEqual([
      expect.objectContaining({ channel: 'in_app', status: 'sent' }),
      expect.objectContaining({ channel: 'sms', status: 'sent' }),
    ]);
  });
});
