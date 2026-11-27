const mockQuery = jest.fn();
const mockFindById = jest.fn();
const mockFindRunsByReport = jest.fn();

jest.mock('@sse/ai', () => ({ MINERU_PARSER_VERSION: 1 }));
jest.mock('../services/ai-engines', () => ({ createOCREngine: jest.fn() }));
jest.mock('../services/notifications', () => ({ sendNotificationSafe: jest.fn() }));
jest.mock('../services/audit', () => ({ auditFromRequest: jest.fn() }));
jest.mock('../services/payment-receipt-verifier', () => ({
  queuePaymentReceiptVerification: jest.fn(),
  runPaymentReceiptVerification: jest.fn(),
}));
jest.mock('../storage/minio-storage', () => ({
  MinioStorage: jest.fn().mockImplementation(() => ({ calculateChecksum: jest.fn() })),
}));

jest.mock('@sse/db', () => ({
  pool: { query: (...args: any[]) => mockQuery(...args) },
  withTransaction: jest.fn(async (_pool: any, fn: any) =>
    fn({ query: (...args: any[]) => mockQuery(...args) })
  ),
  PgExpenseRepo: jest.fn().mockImplementation(() => ({ findById: mockFindById })),
  PgReportSnapshotRepo: jest.fn().mockImplementation(() => ({})),
  PgVerificationHistoryRepo: jest.fn().mockImplementation(() => ({
    findRunsByReport: mockFindRunsByReport,
  })),
  PgInvoiceRepo: jest.fn().mockImplementation(() => ({})),
  PgApprovalRuleRepo: jest.fn().mockImplementation(() => ({ findActive: jest.fn(async () => []) })),
  PgApprovalRecordRepo: jest.fn().mockImplementation(() => ({ findByReportId: jest.fn(async () => []) })),
  PgUserRepo: jest.fn().mockImplementation(() => ({ findById: jest.fn() })),
  PgApproverAssignmentRepo: jest.fn().mockImplementation(() => ({
    findApproverIdForDepartmentName: jest.fn(async () => null),
    findFallbackAdminId: jest.fn(async () => null),
    findDepartmentsForUser: jest.fn(async () => []),
  })),
  PgPaymentReceiptRepo: jest.fn().mockImplementation(() => ({})),
  PgPaymentAuditRepo: jest.fn().mockImplementation(() => ({})),
}));

import express from 'express';
import type { AddressInfo } from 'net';
import type { Server } from 'http';
import { signToken } from '@sse/auth';
import { expenseRoutes } from '../routes/expenses';
import { errorHandler } from '../middleware/error';

let url: string;
let server: Server;

function listen(app: express.Express): Promise<{ url: string; server: Server }> {
  return new Promise((resolve) => {
    const instance = app.listen(0, '127.0.0.1', () => {
      const { port } = instance.address() as AddressInfo;
      resolve({ url: `http://127.0.0.1:${port}`, server: instance });
    });
  });
}

beforeAll(async () => {
  jest.spyOn(console, 'error').mockImplementation(() => {});
  const app = express();
  app.use(express.json());
  app.use('/expenses', expenseRoutes);
  app.use(errorHandler);
  ({ url, server } = await listen(app));
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  (console.error as jest.Mock).mockRestore();
});

beforeEach(() => {
  jest.clearAllMocks();
  mockQuery.mockResolvedValue({ rows: [] });
});

const report = {
  id: 'r1',
  serialNo: 'RE-1',
  userId: 'owner-1',
  title: '差旅',
  totalAmount: 100,
  status: 'approved',
  currentStep: 1,
  createdAt: new Date(),
  updatedAt: new Date(),
};

function runFixture(kind: 'invoice' | 'payment_receipt') {
  return {
    id: `run-${kind}`,
    reportId: 'r1',
    kind,
    eventType: 'verify',
    cause: 'manual',
    actorType: 'user',
    actorId: 'u1',
    actorRole: 'employee',
    status: 'pass',
    summary: { status: 'pass', summary: '通过' },
    contentHash: 'h',
    hashValid: true,
    legacy: false,
    checkedAt: '2026-11-21T08:00:00Z',
    createdAt: '2026-11-21T08:00:00Z',
    items: [
      {
        id: `item-${kind}`,
        runId: `run-${kind}`,
        reportId: 'r1',
        kind,
        subjectId: kind === 'invoice' ? 'inv-1' : 'receipt-1',
        itemId: kind === 'invoice' ? 'it-1' : null,
        fileName: kind === 'invoice' ? 'a.pdf' : 'receipt.pdf',
        status: 'pass',
        result:
          kind === 'invoice'
            ? { duplicates: [{ invoiceId: 'inv-2', serialNo: 'RE-2' }], ocr: { invoiceNo: 'NO-1' } }
            : { duplicateReceipts: [{ receiptId: 'receipt-2', serialNo: 'RE-3' }] },
        hashValid: true,
        createdAt: '2026-11-21T08:00:00Z',
      },
    ],
  };
}

describe('GET /expenses/:id/verification-history', () => {
  it('returns invoice history and masks duplicates for employees', async () => {
    mockFindById.mockResolvedValue(report);
    mockQuery.mockResolvedValue({ rows: [{ department: '技术部' }] });
    mockFindRunsByReport.mockResolvedValue({
      items: [runFixture('invoice')],
      total: 1,
      limit: 20,
      offset: 0,
    });
    const token = signToken({ userId: 'owner-1', role: 'employee', department: '技术部' });

    const response = await fetch(`${url}/expenses/r1/verification-history`, {
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.status).toBe(200);
    const body = (await response.json()) as any;
    expect(body.items[0].items[0].result.duplicates).toEqual([{ restricted: true }]);
    expect(mockFindRunsByReport).toHaveBeenCalledWith(
      expect.objectContaining({ reportId: 'r1', kind: 'invoice' })
    );
  });

  it('keeps receipt history for finance and full duplicates', async () => {
    mockFindById.mockResolvedValue(report);
    mockFindRunsByReport.mockResolvedValue({
      items: [runFixture('invoice'), runFixture('payment_receipt')],
      total: 2,
      limit: 20,
      offset: 0,
    });
    const token = signToken({ userId: 'fin-1', role: 'finance', department: '财务部' });

    const response = await fetch(`${url}/expenses/r1/verification-history?kind=all`, {
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.status).toBe(200);
    const body = (await response.json()) as any;
    expect(body.items).toHaveLength(2);
    expect(body.items[0].items[0].result.duplicates[0].serialNo).toBe('RE-2');
    expect(mockFindRunsByReport).toHaveBeenCalledWith(
      expect.objectContaining({ reportId: 'r1', kind: undefined })
    );
  });

  it('blocks receipt history for non-finance roles', async () => {
    mockFindById.mockResolvedValue(report);
    mockQuery.mockResolvedValue({ rows: [{ department: '技术部' }] });
    const token = signToken({ userId: 'owner-1', role: 'employee', department: '技术部' });

    const response = await fetch(
      `${url}/expenses/r1/verification-history?kind=payment_receipt`,
      { headers: { authorization: `Bearer ${token}` } }
    );

    expect(response.status).toBe(403);
    expect(mockFindRunsByReport).not.toHaveBeenCalled();
  });
});
