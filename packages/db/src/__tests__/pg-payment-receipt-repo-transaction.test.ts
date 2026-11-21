const mockQuery = jest.fn();

jest.mock('../connection', () => ({
  pool: { query: jest.fn() },
}));

import { PgPaymentReceiptRepo } from '../repositories/pg-payment-receipt-repo';

beforeEach(() => {
  mockQuery.mockReset();
});

it('uses the provided transaction client for receipt verification writes', async () => {
  mockQuery.mockResolvedValue({ rows: [] });
  const client = { query: mockQuery };

  await new PgPaymentReceiptRepo().updateVerification(
    'receipt-1',
    'pass',
    { status: 'pass' } as any,
    { ocr: true },
    client as any
  );

  expect(mockQuery).toHaveBeenCalledTimes(1);
  const [sql, params] = mockQuery.mock.calls[0];
  expect(sql).toContain('UPDATE payment_receipts');
  expect(params[0]).toBe('pass');
  expect(params[3]).toBe('receipt-1');
});
