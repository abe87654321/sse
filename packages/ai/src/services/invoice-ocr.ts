import type { OcrResult } from '@sse/shared';
import type { IAIProvider, IInvoiceOCREngine } from '../ports';
import { buildInvoicePrompt } from '../prompts';
import { parseOfdXml } from './ofd-parser';

export class InvoiceOCREngine implements IInvoiceOCREngine {
  constructor(private provider: IAIProvider) {}

  async parseInvoice(fileBuffer: Buffer, fileName: string): Promise<OcrResult> {
    const ext = fileName.toLowerCase().split('.').pop();

    if (ext === 'ofd') {
      const ofdResult = parseOfdXml(fileBuffer);
      if (ofdResult.invoiceNo || ofdResult.amount) {
        return { ...ofdResult, status: 'verified' };
      }
    }

    const base64 = fileBuffer.toString('base64');
    const prompt = buildInvoicePrompt();
    const mimeMap: Record<string, string> = { pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg' };
    const mimeType = mimeMap[ext || ''] || 'image/jpeg';
    const result = await this.provider.analyzeImage(base64, prompt, mimeType);

    try {
      const jsonMatch = result.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        return { ...JSON.parse(jsonMatch[0]), status: 'verified' };
      }
    } catch { /* fall through */ }

    return { status: 'unverified' };
  }
}
