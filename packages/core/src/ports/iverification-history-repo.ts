import type {
  VerificationHistoryCause,
  VerificationHistoryEventType,
  VerificationHistoryKind,
  VerificationHistoryResponse,
  VerificationHistoryStatus,
  VerificationRun,
  VerificationRunSummary,
} from '@sse/shared';
import type { SqlExecutor } from './sql-executor';

export type VerificationRunItemInput = {
  subjectId: string;
  itemId?: string | null;
  fileName?: string | null;
  status: VerificationHistoryStatus;
  result: Record<string, unknown>;
};

export type VerificationRunActor = {
  type: 'user' | 'system';
  id?: string | null;
  role?: string | null;
};

export type RecordVerificationRunInput = {
  reportId: string;
  kind: VerificationHistoryKind;
  eventType: VerificationHistoryEventType;
  cause: VerificationHistoryCause;
  reason?: string | null;
  actor: VerificationRunActor;
  status: VerificationHistoryStatus;
  summary: VerificationRunSummary;
  checkedAt?: string | Date;
  legacy?: boolean;
  items: VerificationRunItemInput[];
};

export type InvalidateInvoiceReportInput = {
  reportId: string;
  cause: VerificationHistoryCause;
  reason?: string | null;
  actor: VerificationRunActor;
};

export type InvalidateReceiptInput = {
  reportId: string;
  receiptId: string;
  cause: VerificationHistoryCause;
  reason?: string | null;
  actor: VerificationRunActor;
};

export type VerificationHistoryQuery = {
  reportId: string;
  kind?: VerificationHistoryKind;
  limit?: number;
  offset?: number;
};

export interface IVerificationHistoryRepo {
  recordRun(input: RecordVerificationRunInput, db?: SqlExecutor): Promise<VerificationRun>;
  invalidateInvoiceReport(
    input: InvalidateInvoiceReportInput,
    db?: SqlExecutor
  ): Promise<{ runId: string; affected: number } | null>;
  invalidateReceipt(
    input: InvalidateReceiptInput,
    db?: SqlExecutor
  ): Promise<{ runId: string; affected: number } | null>;
  findRunsByReport(
    query: VerificationHistoryQuery,
    db?: SqlExecutor
  ): Promise<VerificationHistoryResponse>;
  findLatestVerifyRunId(subjectId: string, db?: SqlExecutor): Promise<string | null>;
}
