import type { OcrResult } from '@sse/shared';

export function shouldReOcr(
  ocr: OcrResult | null | undefined,
  force: boolean,
  currentParserVersion: number,
): boolean {
  if (force) return true;
  if (!ocr) return true;

  const hasAmount =
    (ocr.totalAmount !== undefined && ocr.totalAmount !== null) ||
    (ocr.amount !== undefined && ocr.amount !== null);

  return ocr.parserVersion !== currentParserVersion || (!hasAmount && !ocr.rawText);
}
