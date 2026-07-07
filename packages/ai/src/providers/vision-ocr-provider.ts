import type { OcrResult } from '@sse/shared';
import type { IInvoiceOCRProvider } from '../ports/iocr-provider';
import type { IAIProvider } from '../ports/iai-provider';
import { buildInvoicePrompt } from '../prompts';

export class VisionOCRProvider implements IInvoiceOCRProvider {
  constructor(private provider: IAIProvider) {}

  async parseInvoice(fileBuffer: Buffer, fileName: string): Promise<OcrResult> {
    const base64 = fileBuffer.toString('base64');
    const prompt = buildInvoicePrompt();
    const result = await this.provider.analyzeImage(base64, prompt);

    try {
      const jsonMatch = result.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        return { ...JSON.parse(jsonMatch[0]), status: 'verified' };
      }
    } catch { /* fall through */ }

    return { status: 'unverified' };
  }
}
