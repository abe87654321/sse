const mockQuery = jest.fn();

jest.mock('../connection', () => ({
  pool: { query: jest.fn() },
}));

import { PgInvoiceRepo } from '../repositories/pg-invoice-repo';

beforeEach(() => {
  mockQuery.mockReset();
});

it('uses the provided transaction client for verification writes', async () => {
  mockQuery.mockResolvedValue({ rows: [] });
  const client = { query: mockQuery };

  await new PgInvoiceRepo().updateVerification('inv-1', 'pass', { ok: true }, client as any);

  expect(mockQuery).toHaveBeenCalledTimes(1);
  const [sql, params] = mockQuery.mock.calls[0];
  expect(sql).toContain('UPDATE invoices');
  expect(params[0]).toBe('pass');
  expect(params[2]).toBe('inv-1');
});
