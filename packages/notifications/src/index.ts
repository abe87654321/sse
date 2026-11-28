export { DevSmsProvider, AliyunSmsProvider, createSmsProvider } from './channels/sms';
export type { SmsProvider } from './channels/sms';
export { DevEmailProvider, SmtpEmailProvider, createEmailProvider } from './channels/email';
export type { EmailProvider } from './channels/email';
export { NotificationService } from './notification-service';
export { ApprovalReminderScheduler } from './scheduler';
export { NotificationEngine } from './notification-engine';
export { reminderMessage } from './templates/reminder';
export { escalationMessage } from './templates/escalation';
export { createNotificationEngine } from './factory';
export {
  BROADCAST_SMS_TITLE_MAX,
  BROADCAST_SMS_BODY_MAX,
  buildBroadcastSmsParams,
  broadcastSmsMessage,
} from './channels/sms-template';
export type { SmsMessage, SmsTemplateKey } from './channels/sms-template';
export * from './events';
