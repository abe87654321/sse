import type { OcrResult } from '@sse/shared';

export interface IInvoiceOCRProvider {
  parseInvoice(fileBuffer: Buffer, fileName: string, fileUrl?: string): Promise<OcrResult>;
}
