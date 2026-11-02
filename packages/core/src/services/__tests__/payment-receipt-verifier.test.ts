import { aggregatePaymentReceiptStatus, verifyPaymentReceipt } from '../payment-receipt-verifier';

const baseOcr = {
  status: 'ok',
  totalAmount: 100,
  invoiceDate: '2026-11-02',
  rawText: '转账成功',
};

describe('verifyPaymentReceipt', () => {
  it('passes when amount and date match', () => {
    const result = verifyPaymentReceipt({
      reportTotal: 100,
      paidAt: '2026-11-02T10:00:00.000Z',
      ocrResult: baseOcr,
    });

    expect(result.status).toBe('pass');
    expect(result.checks.find((check) => check.key === 'amount_match')?.ok).toBe(true);
    expect(result.checks.find((check) => check.key === 'receipt_date')?.ok).toBe(true);
  });

  it('passes within the amount tolerance', () => {
    const result = verifyPaymentReceipt({
      reportTotal: 100,
      paidAt: '2026-11-02T10:00:00.000Z',
      ocrResult: { ...baseOcr, totalAmount: 100.01 },
    });

    expect(result.status).toBe('pass');
  });

  it('warns when the amount differs', () => {
    const result = verifyPaymentReceipt({
      reportTotal: 100,
      paidAt: '2026-11-02T10:00:00.000Z',
      ocrResult: { ...baseOcr, totalAmount: 88 },
    });

    expect(result.status).toBe('warning');
    expect(result.checks.find((check) => check.key === 'amount_match')?.ok).toBe(false);
  });

  it('warns when the amount is missing', () => {
    const result = verifyPaymentReceipt({
      reportTotal: 100,
      ocrResult: { status: 'ok', invoiceDate: '2026-11-02', rawText: 'ok' },
    });

    expect(result.status).toBe('warning');
    expect(result.checks.find((check) => check.key === 'amount')?.ok).toBe(false);
  });

  it('warns when the receipt date is missing', () => {
    const result = verifyPaymentReceipt({
      reportTotal: 100,
      paidAt: '2026-11-02T10:00:00.000Z',
      ocrResult: { status: 'ok', totalAmount: 100, rawText: 'ok' },
    });

    expect(result.status).toBe('warning');
    expect(result.checks.find((check) => check.key === 'receipt_date')?.ok).toBe(false);
  });

  it('warns when the date is outside the tolerance', () => {
    const result = verifyPaymentReceipt({
      reportTotal: 100,
      paidAt: '2026-11-20T10:00:00.000Z',
      ocrResult: { ...baseOcr, invoiceDate: '2026-11-02' },
    });

    expect(result.status).toBe('warning');
    expect(result.checks.find((check) => check.key === 'receipt_date')?.ok).toBe(false);
  });

  it('warns on duplicate receipts', () => {
    const result = verifyPaymentReceipt({
      reportTotal: 100,
      paidAt: '2026-11-02T10:00:00.000Z',
      ocrResult: baseOcr,
      duplicateReceipts: [{ receiptId: 'other', reportId: 'r1', serialNo: 'RE-1' }],
    });

    expect(result.status).toBe('warning');
    expect(result.checks.find((check) => check.key === 'duplicate_receipt')?.ok).toBe(false);
  });

  it('returns unverified when OCR is unavailable', () => {
    const result = verifyPaymentReceipt({
      reportTotal: 100,
      paidAt: '2026-11-02T10:00:00.000Z',
      ocrError: 'OCR 引擎未启用',
    });

    expect(result.status).toBe('unverified');
    expect(result.summary).toContain('OCR');
  });

  it('warns when the receipt text contains a risk keyword', () => {
    const result = verifyPaymentReceipt({
      reportTotal: 100,
      paidAt: '2026-11-02T10:00:00.000Z',
      ocrResult: { ...baseOcr, rawText: '转账失败，已退回' },
    });

    expect(result.status).toBe('warning');
    expect(result.checks.find((check) => check.key === 'negative_keyword')?.ok).toBe(false);
  });
});

describe('aggregatePaymentReceiptStatus', () => {
  it('aggregates warning over pass', () => {
    expect(aggregatePaymentReceiptStatus(['pass', 'warning'])).toBe('warning');
  });

  it('treats pending as unverified', () => {
    expect(aggregatePaymentReceiptStatus(['pending', 'pass'])).toBe('unverified');
  });

  it('returns pass when all pass', () => {
    expect(aggregatePaymentReceiptStatus(['pass', 'pass'])).toBe('pass');
  });
});
