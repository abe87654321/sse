import { verifyInvoices, aggregateVerificationStatus } from '../invoice-verifier';

const item = (overrides: Record<string, unknown> = {}) => ({
  id: 'item-1',
  amount: 100,
  expenseDate: '2026-08-01',
  ...overrides,
});

const invoice = (overrides: Record<string, unknown> = {}) => ({
  id: 'inv-1',
  itemId: 'item-1',
  fileName: 'invoice.pdf',
  ocrResult: {
    invoiceNo: 'INV-001',
    totalAmount: 100,
    invoiceDate: '2026-08-01',
    status: 'verified',
  },
  duplicates: [],
  ...overrides,
});

describe('verifyInvoices', () => {
  it('passes when invoice amount matches the item and report total', () => {
    const result = verifyInvoices({
      reportTotal: 100,
      items: [item()],
      invoices: [invoice()],
    });

    expect(result.status).toBe('pass');
    expect(result.invoices[0].status).toBe('pass');
  });

  it('passes within the 0.01 tolerance', () => {
    const result = verifyInvoices({
      reportTotal: 100.01,
      items: [item()],
      invoices: [invoice({ ocrResult: { invoiceNo: 'INV-001', totalAmount: 100.01, status: 'verified' } })],
    });

    expect(result.status).toBe('pass');
  });

  it('warns when the invoice amount differs from the item', () => {
    const result = verifyInvoices({
      reportTotal: 100,
      items: [item()],
      invoices: [invoice({ ocrResult: { invoiceNo: 'INV-001', totalAmount: 600, status: 'verified' } })],
    });

    expect(result.status).toBe('warning');
    expect(result.invoices[0].checks.some((c) => c.key === 'item_amount' && !c.ok)).toBe(true);
  });

  it('warns when the invoice sum differs from the report total', () => {
    const result = verifyInvoices({
      reportTotal: 500,
      items: [item({ amount: 100 })],
      invoices: [invoice()],
    });

    expect(result.status).toBe('warning');
    expect(result.checks.some((c) => c.key === 'report_total' && !c.ok)).toBe(true);
  });

  it('warns when the invoice number is missing', () => {
    const result = verifyInvoices({
      reportTotal: 100,
      items: [item()],
      invoices: [invoice({ ocrResult: { totalAmount: 100, status: 'verified' } })],
    });

    expect(result.status).toBe('warning');
    expect(result.invoices[0].checks.some((c) => c.key === 'invoice_no' && !c.ok)).toBe(true);
  });

  it('warns when a duplicate invoice number is supplied', () => {
    const result = verifyInvoices({
      reportTotal: 100,
      items: [item()],
      invoices: [invoice({
        duplicates: [{ invoiceId: 'other', reportId: 'report-2', serialNo: 'BX-2', status: 'pending' }],
      })],
    });

    expect(result.status).toBe('warning');
    expect(result.invoices[0].checks.some((c) => c.key === 'duplicate' && !c.ok)).toBe(true);
  });

  it('warns when the invoice date differs from the item date by more than 7 days', () => {
    const result = verifyInvoices({
      reportTotal: 100,
      items: [item({ expenseDate: '2026-08-20' })],
      invoices: [invoice()],
    });

    expect(result.status).toBe('warning');
    expect(result.invoices[0].checks.some((c) => c.key === 'invoice_date' && !c.ok)).toBe(true);
  });

  it('marks an invoice unverified when OCR is missing', () => {
    const result = verifyInvoices({
      reportTotal: 100,
      items: [item()],
      invoices: [invoice({ ocrResult: null, ocrError: '识别超时' })],
    });

    expect(result.status).toBe('unverified');
    expect(result.invoices[0].status).toBe('unverified');
  });

  it('returns no_invoices when there are no attachments', () => {
    const result = verifyInvoices({ reportTotal: 100, items: [item()], invoices: [] });

    expect(result.status).toBe('no_invoices');
    expect(result.counts.total).toBe(0);
  });

  it('sums multiple invoices attached to the same item', () => {
    const result = verifyInvoices({
      reportTotal: 100,
      items: [item({ amount: 100 })],
      invoices: [
        invoice({ id: 'inv-1', ocrResult: { invoiceNo: 'A', totalAmount: 40, status: 'verified' } }),
        invoice({ id: 'inv-2', ocrResult: { invoiceNo: 'B', totalAmount: 60, status: 'verified' } }),
      ],
    });

    expect(result.status).toBe('pass');
  });
});

describe('aggregateVerificationStatus', () => {
  it('returns no_invoices for an empty list', () => {
    expect(aggregateVerificationStatus([])).toBe('no_invoices');
  });

  it('prioritises warnings over unverified invoices', () => {
    expect(aggregateVerificationStatus(['pass', 'warning', 'pending'])).toBe('warning');
  });

  it('returns unverified when only pending/unverified statuses exist', () => {
    expect(aggregateVerificationStatus(['pass', 'pending'])).toBe('unverified');
  });
});
