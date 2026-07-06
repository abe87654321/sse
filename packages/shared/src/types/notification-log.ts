export type NotificationLog = {
  id: string;
  reportId: string;
  recipientId: string;
  channel: string;
  triggerType: string;
  status: string;
  sentAt?: Date;
  errorMessage?: string;
};
