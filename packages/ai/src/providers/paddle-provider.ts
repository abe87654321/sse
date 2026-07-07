import type { OcrResult } from '@sse/shared';
import type { IInvoiceOCRProvider } from '../ports/iocr-provider';
import type { AIProviderConfig } from '../ports/iai-provider';

export class PaddleProvider implements IInvoiceOCRProvider {
  constructor(private config: AIProviderConfig) {}

  async parseInvoice(fileBuffer: Buffer, fileName: string): Promise<OcrResult> {
    const base64 = fileBuffer.toString('base64');

    const res = await fetch(`${this.config.endpoint}/ocr`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ file: base64, file_name: fileName }),
    });

    if (!res.ok) throw new Error(`PaddleOCR error ${res.status}`);
    const data: any = await res.json();

    return {
      invoiceNo: data.invoice_no || data.invoiceNo,
      amount: data.amount,
      totalAmount: data.total_amount || data.totalAmount,
      invoiceDate: data.invoice_date || data.invoiceDate,
      sellerName: data.seller_name || data.sellerName,
      buyerName: data.buyer_name || data.buyerName,
      taxAmount: data.tax_amount || data.taxAmount,
      status: 'verified',
    };
  }
}
