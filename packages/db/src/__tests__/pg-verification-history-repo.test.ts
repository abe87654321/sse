const mockQuery = jest.fn();

jest.mock('../connection', () => ({
  pool: { query: (...args: any[]) => mockQuery(...args) },
}));

import { PgVerificationHistoryRepo } from '../repositories/pg-verification-history-repo';

beforeEach(() => {
  mockQuery.mockReset();
});

describe('recordRun', () => {
  it('inserts a run and one item per subject with SQL hashes', async () => {
    mockQuery
      .mockResolvedValueOnce({
        rows: [
          {
            id: 'run-1',
            report_id: 'r1',
            kind: 'invoice',
            event_type: 'verify',
            cause: 'manual',
            reason: null,
            actor_type: 'user',
            actor_id: 'u1',
            actor_role: 'finance',
            status: 'pass',
            summary: { status: 'pass' },
            content_hash: 'hash',
            legacy: false,
            checked_at: new Date('2026-11-21T08:00:00Z'),
            created_at: new Date('2026-11-21T08:00:00Z'),
          },
        ],
      })
      .mockResolvedValueOnce({
        rows: [
          {
            id: 'item-1',
            run_id: 'run-1',
            report_id: 'r1',
            kind: 'invoice',
            subject_id: 'inv-1',
            item_id: 'it-1',
            file_name: 'a.pdf',
            status: 'pass',
            result: { ok: true },
            content_hash: 'item-hash',
            created_at: new Date('2026-11-21T08:00:00Z'),
          },
        ],
      });

    const repo = new PgVerificationHistoryRepo();
    const run = await repo.recordRun({
      reportId: 'r1',
      kind: 'invoice',
      eventType: 'verify',
      cause: 'manual',
      actor: { type: 'user', id: 'u1', role: 'finance' },
      status: 'pass',
      summary: { status: 'pass' },
      items: [
        {
          subjectId: 'inv-1',
          itemId: 'it-1',
          fileName: 'a.pdf',
          status: 'pass',
          result: { ok: true },
        },
      ],
    });

    expect(run.id).toBe('run-1');
    expect(run.items).toHaveLength(1);
    const [runSql, runParams] = mockQuery.mock.calls[0];
    expect(runSql).toContain('INSERT INTO verification_runs');
    expect(runSql).toContain('sha256');
    expect(runParams[1]).toBe('r1');
    expect(runParams[2]).toBe('invoice');
    const [itemSql, itemParams] = mockQuery.mock.calls[1];
    expect(itemSql).toContain('INSERT INTO verification_run_items');
    expect(itemSql).toContain('sha256');
    expect(itemParams[1]).toBe('run-1');
    expect(itemParams[4]).toBe('inv-1');
  });
});

describe('invalidateInvoiceReport', () => {
  it('writes an invalidation run and resets affected invoices', async () => {
    mockQuery
      .mockResolvedValueOnce({
        rows: [
          {
            id: 'inv-1',
            item_id: 'it-1',
            file_name: 'a.pdf',
            verification_status: 'pass',
            verification_result: { ok: true },
            verified_at: new Date('2026-11-21T08:00:00Z'),
            previous_run_id: 'run-prev',
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [{ id: 'run-inv', content_hash: 'h', created_at: new Date(), checked_at: new Date() }] })
      .mockResolvedValueOnce({ rows: [{ id: 'item-inv', content_hash: 'h', created_at: new Date() }] })
      .mockResolvedValueOnce({ rows: [] });

    const result = await new PgVerificationHistoryRepo().invalidateInvoiceReport({
      reportId: 'r1',
      cause: 'items_updated',
      reason: '费用明细修改，原核对结果失效',
      actor: { type: 'user', id: 'u1', role: 'employee' },
    });

    expect(result).toEqual({ runId: 'run-inv', affected: 1 });
    const [selectSql, selectParams] = mockQuery.mock.calls[0];
    expect(selectSql).toContain('FOR UPDATE');
    expect(selectSql).toContain('verification_result IS NOT NULL');
    expect(selectParams).toEqual(['r1']);
    const [, insertRunParams] = mockQuery.mock.calls[1];
    expect(insertRunParams[2]).toBe('invoice');
    expect(insertRunParams[3]).toBe('invalidate');
    const resetSql = mockQuery.mock.calls[3][0];
    expect(resetSql).toContain('verification_status = \'pending\'');
    expect(resetSql).toContain('verification_result = NULL');
  });

  it('returns null when no invoice had a result', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const result = await new PgVerificationHistoryRepo().invalidateInvoiceReport({
      reportId: 'r1',
      cause: 'items_updated',
      actor: { type: 'user', id: 'u1', role: 'employee' },
    });

    expect(result).toBeNull();
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });
});

describe('findRunsByReport', () => {
  it('clamps pagination and groups items under runs', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ count: 1 }] })
      .mockResolvedValueOnce({
        rows: [
          {
            id: 'run-1',
            report_id: 'r1',
            kind: 'invoice',
            event_type: 'verify',
            cause: 'manual',
            reason: null,
            actor_type: 'user',
            actor_id: 'u1',
            actor_role: 'finance',
            status: 'pass',
            summary: { status: 'pass' },
            content_hash: 'hash',
            hash_valid: true,
            legacy: false,
            checked_at: new Date('2026-11-21T08:00:00Z'),
            created_at: new Date('2026-11-21T08:00:00Z'),
          },
        ],
      })
      .mockResolvedValueOnce({
        rows: [
          {
            id: 'item-1',
            run_id: 'run-1',
            report_id: 'r1',
            kind: 'invoice',
            subject_id: 'inv-1',
            item_id: 'it-1',
            file_name: 'a.pdf',
            status: 'pass',
            result: { ok: true },
            content_hash: 'item-hash',
            hash_valid: true,
            created_at: new Date('2026-11-21T08:00:00Z'),
          },
        ],
      });

    const result = await new PgVerificationHistoryRepo().findRunsByReport({
      reportId: 'r1',
      limit: 5000,
      offset: -3,
    });

    expect(result.total).toBe(1);
    expect(result.limit).toBe(100);
    expect(result.offset).toBe(0);
    expect(result.items[0].items).toHaveLength(1);
    expect(result.items[0].hashValid).toBe(true);
    const [, listParams] = mockQuery.mock.calls[1];
    expect(listParams.slice(-2)).toEqual([100, 0]);
  });
});

describe('invalidateReceipt', () => {
  it('writes a receipt invalidation run and resets the receipt', async () => {
    mockQuery
      .mockResolvedValueOnce({
        rows: [
          {
            id: 'receipt-1',
            report_id: 'r1',
            file_name: 'receipt.pdf',
            verification_status: 'pass',
            verification_result: { ok: true },
            verified_at: new Date('2026-11-21T09:00:00Z'),
            previous_run_id: 'run-prev',
          },
        ],
      })
      .mockResolvedValueOnce({
        rows: [
          {
            id: 'run-inv',
            content_hash: 'h',
            created_at: new Date(),
            checked_at: new Date(),
          },
        ],
      })
      .mockResolvedValueOnce({
        rows: [{ id: 'item-inv', content_hash: 'h', created_at: new Date() }],
      })
      .mockResolvedValueOnce({ rows: [] });

    const result = await new PgVerificationHistoryRepo().invalidateReceipt({
      reportId: 'r1',
      receiptId: 'receipt-1',
      cause: 'receipt_replaced',
      reason: '打款回单被替换，原核对结果失效',
      actor: { type: 'user', id: 'fin-1', role: 'finance' },
    });

    expect(result).toEqual({ runId: 'run-inv', affected: 1 });
    const [selectSql, selectParams] = mockQuery.mock.calls[0];
    expect(selectSql).toContain('FOR UPDATE');
    expect(selectParams).toEqual(['receipt-1', 'r1']);
    const [, insertRunParams] = mockQuery.mock.calls[1];
    expect(insertRunParams[2]).toBe('payment_receipt');
    expect(insertRunParams[3]).toBe('invalidate');
    const [, insertItemParams] = mockQuery.mock.calls[2];
    expect(insertItemParams[4]).toBe('receipt-1');
    const resetSql = mockQuery.mock.calls[3][0];
    expect(resetSql).toContain('UPDATE payment_receipts');
    expect(resetSql).toContain('verification_status = \'pending\'');
  });

  it('returns null when the receipt has no prior result', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const result = await new PgVerificationHistoryRepo().invalidateReceipt({
      reportId: 'r1',
      receiptId: 'receipt-1',
      cause: 'receipt_replaced',
      actor: { type: 'user', id: 'fin-1', role: 'finance' },
    });

    expect(result).toBeNull();
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });
});

describe('findLatestVerifyRunId', () => {
  it('returns the latest verify run id', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ run_id: 'run-1' }] });

    const result = await new PgVerificationHistoryRepo().findLatestVerifyRunId('inv-1');

    expect(result).toBe('run-1');
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain("event_type = 'verify'");
    expect(params).toEqual(['inv-1']);
  });

  it('returns null when there is no verify run', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const result = await new PgVerificationHistoryRepo().findLatestVerifyRunId('inv-1');

    expect(result).toBeNull();
  });
});
