export type NotificationDelivery = {
  id: string;
  notification_id: string;
  channel: 'in_app' | 'sms' | 'email';
  status: 'sent' | 'failed' | 'skipped';
  error_message?: string;
  sent_at?: Date;
  created_at?: Date;
};

export type SystemMessageDelivery = {
  notificationId: string;
  userId: string;
  userName?: string;
  type: string;
  title: string;
  channel: 'in_app' | 'sms' | 'email';
  status: 'sent' | 'failed' | 'skipped';
  errorMessage?: string;
  sentAt?: Date;
};
