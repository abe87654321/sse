import type { OcrResult } from '@sse/shared';
import { shouldReOcr } from '../ocr-freshness';

describe('shouldReOcr', () => {
  const currentVersion = 3;

  function ocr(partial: Partial<OcrResult>): OcrResult {
    return { status: 'verified', ...partial };
  }

  it('always re-runs the OCR engine when the caller forces it', () => {
    expect(shouldReOcr(ocr({ parserVersion: currentVersion, totalAmount: 100 }), true, currentVersion)).toBe(true);
  });

  it('runs the OCR engine when there is no cached result', () => {
    expect(shouldReOcr(null, false, currentVersion)).toBe(true);
    expect(shouldReOcr(undefined, false, currentVersion)).toBe(true);
  });

  it('keeps a fresh cached result that already carries an amount', () => {
    expect(shouldReOcr(ocr({ parserVersion: currentVersion, totalAmount: 100 }), false, currentVersion)).toBe(false);
  });

  it('re-runs the OCR engine when the cached result came from an older parser', () => {
    expect(shouldReOcr(ocr({ parserVersion: currentVersion - 1, totalAmount: 100 }), false, currentVersion)).toBe(true);
  });

  it('re-runs the OCR engine when the cached result has neither amount nor text', () => {
    expect(shouldReOcr(ocr({ parserVersion: currentVersion }), false, currentVersion)).toBe(true);
  });

  it('keeps a cached result that still carries raw text', () => {
    expect(shouldReOcr(ocr({ parserVersion: currentVersion, rawText: '回单编号：12345678' }), false, currentVersion)).toBe(false);
  });

  it('treats a zero amount as a recognised amount', () => {
    expect(shouldReOcr(ocr({ parserVersion: currentVersion, totalAmount: 0 }), false, currentVersion)).toBe(false);
  });

  it('treats a cached result without a parser version as stale', () => {
    expect(shouldReOcr(ocr({ totalAmount: 100 }), false, currentVersion)).toBe(true);
  });
});
