import type { IOcrService } from '@sse/core';
import type { OcrResult } from '@sse/shared';
import { parsePdf as parsePdfBuffer } from './pdf';
import { parseOfd as parseOfdBuffer } from './ofd';

export class OcrParser implements IOcrService {
  async parsePdf(fileBuffer: Buffer): Promise<OcrResult> {
    return parsePdfBuffer(fileBuffer);
  }

  async parseOfd(fileBuffer: Buffer): Promise<OcrResult> {
    return parseOfdBuffer(fileBuffer);
  }
}
