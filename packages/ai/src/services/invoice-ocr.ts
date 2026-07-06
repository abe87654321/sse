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

    if (ext === 'pdf') {
      return this.parsePdf(fileBuffer);
    }

    const base64 = fileBuffer.toString('base64');
    const prompt = buildInvoicePrompt();
    const result = await this.provider.analyzeImage(base64, prompt);

    return this.extractJson(result);
  }

  private async parsePdf(buffer: Buffer): Promise<OcrResult> {
    try {
      const pdfParse = require('pdf-parse');
      const data = await pdfParse(buffer);
      const text = data.text;

      if (text && text.trim().length > 20) {
        const prompt = buildInvoicePrompt() + '\n\n从以下发票文本中提取信息：\n' + text;
        const result = await this.provider.analyzeText(text, prompt);
        return this.extractJson(result);
      }
    } catch { /* fall through to image approach */ }

    const base64 = buffer.toString('base64');
    const prompt = buildInvoicePrompt();
    const result = await this.provider.analyzeImage(base64, prompt, 'application/pdf');
    return this.extractJson(result);
  }

  private extractJson(result: string): OcrResult {
    try {
      const jsonMatch = result.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        return { ...JSON.parse(jsonMatch[0]), status: 'verified' };
      }
    } catch { /* fall through */ }
    return { status: 'unverified' };
  }
}
