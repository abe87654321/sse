import type { OcrResult } from '@sse/shared';
import type { IInvoiceOCRProvider } from '../ports/iocr-provider';

export class InvoiceOCREngine {
  constructor(private provider: IInvoiceOCRProvider) {}

  async parseInvoice(fileBuffer: Buffer, fileName: string, fileUrl?: string): Promise<OcrResult> {
    return this.provider.parseInvoice(fileBuffer, fileName, fileUrl);
  }
}
