import type { OcrResult } from '@sse/shared';
import type { IInvoiceOCRProvider } from '../ports/iocr-provider';
import type { IAIProvider } from '../ports/iai-provider';
import { buildInvoicePrompt } from '../prompts';
import { prepareOcrImage } from '../services/document-image';

export class VisionOCRProvider implements IInvoiceOCRProvider {
  constructor(private provider: IAIProvider) {}

  async parseInvoice(fileBuffer: Buffer, fileName: string): Promise<OcrResult> {
    // 视觉模型只吃图片：PDF 必须先渲染，否则模型会拿到无法解码的字节
    const image = await prepareOcrImage(fileBuffer, fileName);
    if (!image) {
      throw new Error('无法转换为图片，仅支持 PDF、PNG、JPG 格式的附件');
    }

    const base64 = image.buffer.toString('base64');
    const prompt = buildInvoicePrompt();
    const result = await this.provider.analyzeImage(base64, prompt, image.mimeType);

    try {
      const jsonMatch = result.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        return { ...mapModelFields(JSON.parse(jsonMatch[0])), status: 'verified' };
      }
    } catch { /* fall through */ }

    return { status: 'unverified' };
  }
}

/** 模型按提示词返回 snake_case，这里映射成 OcrResult 的 camelCase 字段 */
function mapModelFields(parsed: any): Partial<OcrResult> {
  return {
    invoiceNo: pickString(parsed.invoice_no, parsed.invoiceNo),
    amount: pickNumber(parsed.amount),
    taxAmount: pickNumber(parsed.tax_amount, parsed.taxAmount),
    totalAmount: pickNumber(parsed.total_amount, parsed.totalAmount),
    invoiceDate: pickString(parsed.invoice_date, parsed.invoiceDate),
    sellerName: pickString(parsed.seller_name, parsed.sellerName),
    buyerName: pickString(parsed.buyer_name, parsed.buyerName),
    rawText: pickString(parsed.rawText),
    parserVersion: pickNumber(parsed.parserVersion),
  };
}

function pickString(...values: any[]): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return undefined;
}

function pickNumber(...values: any[]): number | undefined {
  for (const value of values) {
    if (value === undefined || value === null || value === '') continue;
    const normalized = typeof value === 'string' ? value.replace(/[,\s]/g, '') : value;
    const number = Number(normalized);
    if (Number.isFinite(number)) return number;
  }
  return undefined;
}
