export type SystemMessage = {
  id: string;
  title: string;
  body: string;
  body_ai?: string;
  body_ai_instruction?: string;
  target_roles?: string[];
  target_user_ids?: string[];
  sender_id: string;
  delivery_channels: string[];
  status: 'draft' | 'sent';
  sent_at?: Date;
  created_at: Date;
  updated_at: Date;
};
