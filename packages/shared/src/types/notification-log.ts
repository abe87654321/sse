export type NotificationLog = {
  id: string;
  user_id: string;
  type: string;
  title: string;
  body: string;
  system_message_id?: string;
  read_at?: Date;
  created_at?: Date;
};
