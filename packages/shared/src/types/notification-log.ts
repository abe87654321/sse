export type NotificationLog = {
  id: string;
  user_id: string;
  type: string;
  title: string;
  body: string;
  read_at?: Date;
  created_at: Date;
};
