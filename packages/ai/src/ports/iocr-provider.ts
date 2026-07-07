import type { OcrResult } from '@sse/shared';

export interface IInvoiceOCRProvider {
  parseInvoice(fileBuffer: Buffer, fileName: string): Promise<OcrResult>;
}
