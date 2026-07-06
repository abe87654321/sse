import type { NotificationLog } from '@sse/shared';

export interface INotificationLogRepo {
  create(log: Omit<NotificationLog, 'id'>): Promise<NotificationLog>;
  findByReportId(reportId: string): Promise<NotificationLog[]>;
  findByRecipient(recipientId: string, page: number, pageSize: number): Promise<{ results: NotificationLog[]; total: number }>;
}
