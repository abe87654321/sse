import type { INotificationRepo, IUserRepo } from '@sse/core';
import type { NotificationLog, NotifyPrefs } from '@sse/shared';
import type { NotificationService } from './notification-service';

export interface SendOptions {
  notifyPrefs?: NotifyPrefs;
  systemMessageId?: string;
  emailBody?: string;
}

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
    options: SendOptions = {},
  ): Promise<NotificationLog> {
    const notification = await this.notificationRepo.create({
      user_id: userId,
      type,
      title,
      body,
      system_message_id: options.systemMessageId,
    });

    await this.notificationRepo.createDelivery({
      notification_id: notification.id,
      channel: 'in_app',
      status: 'sent',
    });

    const prefs = options.notifyPrefs || await this.getDefaultPrefs(userId);

    for (const channel of channels) {
      await this.tryDeliverChannel(
        notification.id,
        userId,
        channel,
        title,
        body,
        type,
        prefs,
        options.emailBody,
      );
    }

    return notification;
  }

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

  private async tryDeliverChannel(
    notificationId: string,
    userId: string,
    channel: 'sms' | 'email',
    title: string,
    body: string,
    type: string,
    prefs: NotifyPrefs,
    emailBody?: string,
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
    let attempted = false;

    try {
      if (channel === 'sms' && user.phone) {
        attempted = true;
        success = await this.notificationService.sendSms(user.phone, `${title}: ${body}`);
      } else if (channel === 'email' && user.email) {
        attempted = true;
        success = await this.notificationService.sendEmail(user.email, title, emailBody ?? body);
      }
    } catch (err: any) {
      errorMessage = err.message;
    }

    if (!attempted) {
      await this.notificationRepo.createDelivery({
        notification_id: notificationId,
        channel,
        status: 'skipped',
      });
      return;
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
    if (type === 'broadcast') return prefs.broadcast;
    if (type === 'welcome') return channel === 'email';
    const bucket = channel === 'sms' ? prefs.sms : prefs.email;
    return Boolean((bucket as Record<string, boolean>)[type]);
  }

  private async sendBounceAlert(user: any, channel: string, title: string, errorMessage?: string) {
    const admins = await this.userRepo.findByRole('admin');
    for (const admin of admins) {
      const bounceNotif = await this.notificationRepo.create({
        user_id: admin.id,
        type: 'bounce_alert',
        title: '消息送达失败',
        body: `向 ${user.name}(${channel === 'sms' ? user.phone : user.email}) 发送的"${title}"失败: ${errorMessage || '未知错误'}`,
      });
      await this.notificationRepo.createDelivery({
        notification_id: bounceNotif.id,
        channel: 'in_app',
        status: 'sent',
      });
    }
  }

  private async getUserNotifyPrefs(userId: string): Promise<NotifyPrefs> {
    const user = await this.userRepo.findById(userId);
    return user?.notify_prefs || {
      sms: { reminder: true, escalation: true, rejected: true, paid: false },
      email: { rejected: true, paid: false },
      broadcast: true,
      in_app: { rejected: true, paid: true, broadcast: true },
    };
  }

  private async getDefaultPrefs(userId: string): Promise<NotifyPrefs> {
    return this.getUserNotifyPrefs(userId);
  }
}
