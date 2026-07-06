export type ApprovalRecord = {
  id: string;
  reportId: string;
  step: number;
  approverId: string;
  stepStartedAt: Date;
  result: string;
  comment?: string;
  approvedAt?: Date;
  reminderSentAt?: Date;
  escalatedAt?: Date;
};
