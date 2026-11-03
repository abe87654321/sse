import type { NotificationLog, NotificationDelivery, SystemMessage, SystemMessageDelivery } from '@sse/shared';

export interface INotificationRepo {
  findByUserId(userId: string, page: number, pageSize: number): Promise<{ results: NotificationLog[]; total: number }>;
  findById(id: string): Promise<NotificationLog | null>;
  countUnread(userId: string): Promise<number>;
  markRead(id: string): Promise<void>;
  markAllRead(userId: string): Promise<void>;
  create(notification: Omit<NotificationLog, 'id'>): Promise<NotificationLog>;
  createDelivery(delivery: Omit<NotificationDelivery, 'id'>): Promise<NotificationDelivery>;
  findDeliveriesByNotification(notificationId: string): Promise<NotificationDelivery[]>;
  findDeliveriesBySystemMessage(systemMessageId: string): Promise<SystemMessageDelivery[]>;
  findSystemMessages(status?: string): Promise<SystemMessage[]>;
  findSystemMessageById(id: string): Promise<SystemMessage | null>;
  createSystemMessage(msg: Omit<SystemMessage, 'id'>): Promise<SystemMessage>;
  updateSystemMessage(id: string, msg: Partial<SystemMessage>): Promise<void>;
  deleteSystemMessage(id: string): Promise<void>;
}
