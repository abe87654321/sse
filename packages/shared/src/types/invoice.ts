export type OcrResult = {
  invoiceNo?: string;
  amount?: number;
  taxAmount?: number;
  totalAmount?: number;
  invoiceDate?: string;
  sellerName?: string;
  buyerName?: string;
  rawText?: string;
  parserVersion?: number;
  status: string;
};

import type { InvoiceVerificationResult, VerificationStatus } from './invoice-verification';

export type Invoice = {
  id: string;
  itemId: string;
  fileName: string;
  fileFormat: string;
  fileSize: number;
  storageKey: string;
  storageBucket: string;
  checksum: string;
  invoiceNo?: string;
  ocrResult?: OcrResult;
  verificationStatus?: VerificationStatus;
  verificationResult?: InvoiceVerificationResult;
  verifiedAt?: Date;
  uploadedAt: Date;
};
