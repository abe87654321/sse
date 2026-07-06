import type { OcrResult } from '@sse/shared';

export interface IOcrService {
  parsePdf(fileBuffer: Buffer): Promise<OcrResult>;
  parseOfd(fileBuffer: Buffer): Promise<OcrResult>;
}
