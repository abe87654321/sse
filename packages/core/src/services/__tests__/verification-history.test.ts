import type { VerificationRun } from '@sse/shared';
import { redactVerificationHistory } from '../verification-history';

function invoiceRun(): VerificationRun {
  return {
    id: 'run-1',
    reportId: 'r1',
    kind: 'invoice',
    eventType: 'verify',
    cause: 'manual',
    actorType: 'user',
    actorId: 'u1',
    actorRole: 'employee',
    status: 'warning',
    summary: { status: 'warning', summary: '存在差异' },
    contentHash: 'hash',
    hashValid: true,
    legacy: false,
    checkedAt: '2026-11-21T08:00:00Z',
    createdAt: '2026-11-21T08:00:00Z',
    items: [
      {
        id: 'item-1',
        runId: 'run-1',
        reportId: 'r1',
        kind: 'invoice',
        subjectId: 'inv-1',
        itemId: 'it-1',
        fileName: 'a.pdf',
        status: 'warning',
        result: {
          status: 'warning',
          duplicates: [
            { invoiceId: 'inv-2', reportId: 'r2', serialNo: 'RE-2', status: 'approved' },
          ],
          ocr: { invoiceNo: 'NO-1' },
        },
        hashValid: true,
        createdAt: '2026-11-21T08:00:00Z',
      },
    ],
  };
}

function receiptRun(): VerificationRun {
  return {
    id: 'run-2',
    reportId: 'r1',
    kind: 'payment_receipt',
    eventType: 'verify',
    cause: 'manual',
    actorType: 'user',
    actorId: 'fin-1',
    actorRole: 'finance',
    status: 'pass',
    summary: { status: 'pass', summary: '通过' },
    contentHash: 'hash',
    hashValid: true,
    legacy: false,
    checkedAt: '2026-11-21T09:00:00Z',
    createdAt: '2026-11-21T09:00:00Z',
    items: [
      {
        id: 'item-2',
        runId: 'run-2',
        reportId: 'r1',
        kind: 'payment_receipt',
        subjectId: 'receipt-1',
        itemId: null,
        fileName: 'receipt.pdf',
        status: 'pass',
        result: {
          status: 'pass',
          duplicateReceipts: [{ receiptId: 'receipt-2', serialNo: 'RE-3' }],
        },
        hashValid: true,
        createdAt: '2026-11-21T09:00:00Z',
      },
    ],
  };
}

describe('redactVerificationHistory', () => {
  it('masks invoice duplicate details for employees but keeps OCR', () => {
    const result = redactVerificationHistory(invoiceRun(), {
      canSeeDuplicates: false,
      canSeeReceipts: true,
    });

    expect(result).not.toBeNull();
    expect(result!.items[0].result.duplicates).toEqual([{ restricted: true }]);
    expect(result!.items[0].result.ocr).toEqual({ invoiceNo: 'NO-1' });
  });

  it('keeps invoice duplicate details for approvers and finance', () => {
    const result = redactVerificationHistory(invoiceRun(), {
      canSeeDuplicates: true,
      canSeeReceipts: true,
    });

    expect(result!.items[0].result.duplicates).toEqual([
      { invoiceId: 'inv-2', reportId: 'r2', serialNo: 'RE-2', status: 'approved' },
    ]);
  });

  it('drops receipt runs for roles without payment visibility', () => {
    expect(
      redactVerificationHistory(receiptRun(), {
        canSeeDuplicates: false,
        canSeeReceipts: false,
      })
    ).toBeNull();
  });

  it('masks receipt duplicates for finance when duplicates are restricted', () => {
    const result = redactVerificationHistory(receiptRun(), {
      canSeeDuplicates: false,
      canSeeReceipts: true,
    });

    expect(result!.items[0].result.duplicateReceipts).toEqual([{ restricted: true }]);
  });
});
