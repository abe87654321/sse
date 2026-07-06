import type { OcrResult } from '@sse/shared';

export interface PaddleOcrConfig {
  apiUrl: string;
}

export class PaddleOcrAdapter {
  private readonly apiUrl: string;

  constructor(config: PaddleOcrConfig) {
    this.apiUrl = config.apiUrl;
  }

  async recognize(buffer: Buffer): Promise<OcrResult> {
    console.log(`PaddleOCR adapter stub - API URL: ${this.apiUrl}`);
    return { status: 'unverified' };
  }
}
