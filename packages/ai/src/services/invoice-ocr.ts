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
        const result = await this.provider.analyzeText(
          '从以下发票文本中提取信息，只返回JSON：' + text,
          buildInvoicePrompt()
        );
        return this.extractJson(result);
      }
    } catch { /* pdf-parse failed, try raw text extraction */ }

    const rawText = buffer.toString('utf-8').replace(/[^\x20-\x7E\u4e00-\u9fff\u3400-\u4dbf\uff00-\uffef]/g, '');
    if (rawText.trim().length > 30) {
      const result = await this.provider.analyzeText(
        '从以下发票文本中提取信息，只返回JSON：' + rawText,
        buildInvoicePrompt()
      );
      return this.extractJson(result);
    }

    return { status: 'unverified' };
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
