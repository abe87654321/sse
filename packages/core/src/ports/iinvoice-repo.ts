import type { DuplicateInvoiceRef, Invoice, VerificationStatus } from '@sse/shared';

export interface IInvoiceRepo {
  findById(id: string): Promise<Invoice | null>;
  findByItemId(itemId: string): Promise<Invoice | null>;
  create(invoice: Omit<Invoice, 'id' | 'uploadedAt'>): Promise<Invoice>;
  updateOcrResult(id: string, ocrResult: any, invoiceNo?: string): Promise<void>;
  updateVerification(id: string, status: VerificationStatus, result: unknown): Promise<void>;
  findDuplicatesByInvoiceNo(invoiceNo: string, excludeInvoiceId: string): Promise<DuplicateInvoiceRef[]>;
}
