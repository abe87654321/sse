import type { VerificationCheck } from './invoice-verification';

export type VerificationHistoryKind = 'invoice' | 'payment_receipt';

export type VerificationHistoryEventType = 'verify' | 'invalidate' | 'backfill';

export type VerificationHistoryCause =
  | 'manual'
  | 'force_ocr'
  | 'items_updated'
  | 'invoice_uploaded'
  | 'receipt_replaced'
  | 'system'
  | 'backfill';

export type VerificationHistoryStatus =
  | 'pass'
  | 'warning'
  | 'unverified'
  | 'error'
  | 'no_invoices'
  | 'invalidated';

export type VerificationRunSummary = {
  status: VerificationHistoryStatus;
  checkedAt?: string | null;
  summary?: string;
  counts?: {
    total: number;
    pass: number;
    warning: number;
    unverified: number;
    pending: number;
  };
  checks?: VerificationCheck[];
  affected?: number;
  note?: string;
};

export type VerificationRunItem = {
  id: string;
  runId: string;
  reportId: string;
  kind: VerificationHistoryKind;
  subjectId: string;
  itemId?: string | null;
  fileName?: string | null;
  status: VerificationHistoryStatus;
  result: Record<string, any>;
  hashValid: boolean;
  createdAt: string | Date;
};

export type VerificationRun = {
  id: string;
  reportId: string;
  kind: VerificationHistoryKind;
  eventType: VerificationHistoryEventType;
  cause: VerificationHistoryCause;
  reason?: string | null;
  actorType: 'user' | 'system';
  actorId?: string | null;
  actorRole?: string | null;
  status: VerificationHistoryStatus;
  summary: VerificationRunSummary;
  contentHash: string;
  hashValid: boolean;
  legacy: boolean;
  checkedAt: string | Date;
  createdAt: string | Date;
  items: VerificationRunItem[];
};

export type VerificationHistoryResponse = {
  items: VerificationRun[];
  total: number;
  limit: number;
  offset: number;
};
