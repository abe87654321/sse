import type { DuplicateInvoiceRef, Invoice, VerificationStatus } from '@sse/shared';
import type { SqlExecutor } from './sql-executor';

export interface IInvoiceRepo {
  findById(id: string, db?: SqlExecutor): Promise<Invoice | null>;
  findByItemId(itemId: string, db?: SqlExecutor): Promise<Invoice | null>;
  create(invoice: Omit<Invoice, 'id' | 'uploadedAt'>, db?: SqlExecutor): Promise<Invoice>;
  updateOcrResult(
    id: string,
    ocrResult: any,
    invoiceNo?: string,
    db?: SqlExecutor
  ): Promise<void>;
  updateVerification(
    id: string,
    status: VerificationStatus,
    result: unknown,
    db?: SqlExecutor
  ): Promise<void>;
  findDuplicatesByInvoiceNo(
    invoiceNo: string,
    excludeInvoiceId: string,
    db?: SqlExecutor
  ): Promise<DuplicateInvoiceRef[]>;
}
