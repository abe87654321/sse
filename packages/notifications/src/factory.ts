import { createSmsProvider } from './channels/sms';
import { createEmailProvider } from './channels/email';
import { NotificationService } from './notification-service';
import { NotificationEngine } from './notification-engine';

export function createNotificationEngine(): NotificationEngine {
  const { PgNotificationRepo, PgUserRepo } = require('@sse/db') as typeof import('@sse/db');

  return new NotificationEngine(
    new PgNotificationRepo(),
    new PgUserRepo(),
    new NotificationService(createSmsProvider(), createEmailProvider()),
  );
}
