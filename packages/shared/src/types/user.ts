export type NotifyPrefs = {
  sms: { reminder: boolean; escalation: boolean; rejected: boolean; paid: boolean };
  email: { rejected: boolean; paid: boolean };
  broadcast: boolean;
  in_app: { rejected: boolean; paid: boolean; broadcast: boolean };
};

export type User = {
  id: string;
  name: string;
  phone: string;
  email?: string;
  department: string;
  role: string;
  parentId?: string;
  status: string;
  avatarUrl?: string;
  notify_prefs?: NotifyPrefs;
  deletedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
};
