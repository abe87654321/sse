import type { ApprovalRecord } from '@sse/shared';
import type { SqlExecutor } from './sql-executor';

export interface IApprovalRecordRepo {
  findByReportId(reportId: string): Promise<ApprovalRecord[]>;
  findPendingOverdue(): Promise<ApprovalRecord[]>;
  create(record: Omit<ApprovalRecord, 'id'>, db?: SqlExecutor): Promise<ApprovalRecord>;
  updateResult(id: string, result: string, comment?: string, db?: SqlExecutor): Promise<void>;
  markReminderSent(id: string): Promise<void>;
  markEscalated(id: string): Promise<void>;
}
