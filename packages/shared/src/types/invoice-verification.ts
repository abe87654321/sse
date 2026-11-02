import type { OcrResult } from './invoice';

export type VerificationStatus =
  | 'pending'
  | 'pass'
  | 'warning'
  | 'unverified'
  | 'no_invoices'
  | 'error';

export type VerificationSeverity = 'error' | 'warning' | 'info';

export type VerificationCheck = {
  key: string;
  label: string;
  ok: boolean;
  severity: VerificationSeverity;
  expected?: string | number;
  actual?: string | number;
  message?: string;
};

export type DuplicateInvoiceRef = {
  invoiceId: string;
  reportId?: string;
  serialNo?: string;
  status?: string;
  restricted?: boolean;
};

export type InvoiceVerificationResult = {
  status: VerificationStatus;
  checks: VerificationCheck[];
  summary: string;
  checkedAt: string;
  ocr?: OcrResult;
  duplicates: DuplicateInvoiceRef[];
};

export type VerifiedInvoiceView = {
  invoiceId: string;
  itemId: string;
  fileName: string;
  status: VerificationStatus;
  invoiceNo?: string;
  totalAmount?: number;
  checks: VerificationCheck[];
  duplicates: DuplicateInvoiceRef[];
  message?: string;
};

export type InvoiceVerificationSummary = {
  status: VerificationStatus;
  checkedAt: string;
  summary: string;
  counts: {
    total: number;
    pass: number;
    warning: number;
    unverified: number;
    pending: number;
  };
  checks: VerificationCheck[];
  invoices: VerifiedInvoiceView[];
};
