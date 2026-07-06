import type { OcrResult } from '@sse/shared';

const PDF_MAGIC = '%PDF';

export async function parsePdf(buffer: Buffer): Promise<OcrResult> {
  if (buffer.length < 4 || buffer.toString('ascii', 0, 4) !== PDF_MAGIC) {
    return { status: 'unverified' };
  }

  console.log('PDF OCR requires external service configuration');
  return { status: 'unverified' };
}
