export type NotificationDelivery = {
  id: string;
  notification_id: string;
  channel: 'in_app' | 'sms' | 'email';
  status: 'sent' | 'failed' | 'skipped';
  error_message?: string;
  sent_at?: Date;
  created_at: Date;
};
