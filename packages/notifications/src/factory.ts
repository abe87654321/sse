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
