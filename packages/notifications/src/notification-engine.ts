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
