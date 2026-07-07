import type { OcrResult } from '@sse/shared';
import type { IInvoiceOCRProvider } from '../ports/iocr-provider';
import type { AIProviderConfig } from '../ports/iai-provider';

export class MinerUProvider implements IInvoiceOCRProvider {
  constructor(private config: AIProviderConfig) {}

  async parseInvoice(fileBuffer: Buffer, fileName: string): Promise<OcrResult> {
    const formData = new FormData();
    const blob = new Blob([fileBuffer]);
    formData.append('file', blob, fileName);

    const res = await fetch(`${this.config.endpoint}/api/parse`, {
      method: 'POST',
      body: formData,
    });

    if (!res.ok) throw new Error(`MinerU error ${res.status}`);
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
