import type { ApprovalRule, ReportSnapshot, ReportSnapshotDetail } from '@sse/shared';
import type { SqlExecutor } from './sql-executor';

export type SnapshotCaptureInput = {
  reportId: string;
  snapshotType: 'submit' | 'approve' | 'reject' | 'pay';
  actor: { type: 'user' | 'system'; id?: string; role?: string };
  rule?: ApprovalRule | null;
  action?: {
    recordId: string;
    step: number;
    result: string;
    comment?: string | null;
  } | null;
};

export type SnapshotQuery = {
  reportId?: string;
  snapshotType?: string;
  legacy?: boolean;
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
};

export interface IReportSnapshotRepo {
  capture(input: SnapshotCaptureInput, db?: SqlExecutor): Promise<ReportSnapshot>;
  findByReportId(reportId: string, db?: SqlExecutor): Promise<ReportSnapshot[]>;
  findDetailById(id: string, db?: SqlExecutor): Promise<ReportSnapshotDetail | null>;
  findDetailByReport(
    reportId: string,
    snapshotId: string,
    db?: SqlExecutor
  ): Promise<ReportSnapshotDetail | null>;
  query(
    filter: SnapshotQuery,
    db?: SqlExecutor
  ): Promise<{ items: ReportSnapshot[]; total: number }>;
}
