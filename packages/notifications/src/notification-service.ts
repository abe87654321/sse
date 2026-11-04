import type { INotificationService } from '@sse/core';
import type { SmsProvider } from './channels/sms';
import type { SmsMessage } from './channels/sms-template';
import type { EmailProvider } from './channels/email';

export class NotificationService implements INotificationService {
  constructor(
    private smsProvider: SmsProvider,
    private emailProvider: EmailProvider,
  ) {}

  async sendSms(phone: string, content: string, message?: SmsMessage): Promise<boolean> {
    const result = await this.smsProvider.send(phone, content, message);
    return result.success;
  }

  async sendEmail(email: string, subject: string, body: string): Promise<boolean> {
    const result = await this.emailProvider.send(email, subject, body);
    return result.success;
  }
}
