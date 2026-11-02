import type { OcrResult } from './invoice';
import type { VerificationCheck } from './invoice-verification';

export type PaymentReceiptStatus =
  | 'pending'
  | 'pass'
  | 'warning'
  | 'unverified'
  | 'error';

export type PaymentDuplicateReceiptRef = {
  receiptId: string;
  reportId?: string;
  serialNo?: string;
  status?: string;
  restricted?: boolean;
};

export type PaymentReceiptVerification = {
  status: PaymentReceiptStatus;
  checks: VerificationCheck[];
  summary: string;
  checkedAt: string;
  ocr?: OcrResult;
  duplicateReceipts: PaymentDuplicateReceiptRef[];
};

export type PaymentReceipt = {
  id: string;
  reportId: string;
  fileName: string;
  fileFormat: string;
  fileSize: number;
  storageKey: string;
  storageBucket: string;
  checksum: string;
  uploadedBy?: string;
  uploadedAt: Date;
  ocrResult?: OcrResult;
  verificationStatus: PaymentReceiptStatus;
  verificationResult?: PaymentReceiptVerification;
  verifiedAt?: Date;
};

export type PaymentAuditAction = 'mark_paid' | 'update_payment' | 'revert_payment';

export type PaymentAuditLog = {
  id: string;
  reportId: string;
  action: PaymentAuditAction;
  operatorId?: string;
  operatorName?: string;
  reason?: string;
  before?: unknown;
  after?: unknown;
  createdAt: Date;
};
