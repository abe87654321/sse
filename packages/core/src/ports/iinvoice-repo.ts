import type { Invoice } from '@sse/shared';

export interface IInvoiceRepo {
  findById(id: string): Promise<Invoice | null>;
  findByItemId(itemId: string): Promise<Invoice | null>;
  create(invoice: Omit<Invoice, 'id' | 'uploadedAt'>): Promise<Invoice>;
  updateOcrResult(id: string, ocrResult: any): Promise<void>;
}
