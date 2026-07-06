import type { ApprovalRecord } from '@sse/shared';

export interface IApprovalRecordRepo {
  findByReportId(reportId: string): Promise<ApprovalRecord[]>;
  findPendingOverdue(): Promise<ApprovalRecord[]>;
  create(record: Omit<ApprovalRecord, 'id'>): Promise<ApprovalRecord>;
  updateResult(id: string, result: string, comment?: string): Promise<void>;
  markReminderSent(id: string): Promise<void>;
  markEscalated(id: string): Promise<void>;
}
