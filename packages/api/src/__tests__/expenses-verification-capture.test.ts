const mockQuery = jest.fn();
const mockFindById = jest.fn();
const mockRecordRun = jest.fn();
const mockInvalidateInvoiceReport = jest.fn();

jest.mock('@sse/ai', () => ({ MINERU_PARSER_VERSION: 1 }));
jest.mock('../services/ai-engines', () => ({ createOCREngine: jest.fn() }));
jest.mock('../services/notifications', () => ({ sendNotificationSafe: jest.fn() }));
jest.mock('../services/audit', () => ({ auditFromRequest: jest.fn() }));
jest.mock('../services/payment-receipt-verifier', () => ({
  queuePaymentReceiptVerification: jest.fn(),
  runPaymentReceiptVerification: jest.fn(),
}));
jest.mock('../storage/minio-storage', () => ({
  MinioStorage: jest.fn().mockImplementation(() => ({
    calculateChecksum: jest.fn(),
  })),
}));

jest.mock('@sse/db', () => ({
  pool: { query: (...args: any[]) => mockQuery(...args) },
  withTransaction: jest.fn(async (_pool: any, fn: any) =>
    fn({ query: (...args: any[]) => mockQuery(...args) })
  ),
  PgExpenseRepo: jest.fn().mockImplementation(() => ({ findById: mockFindById })),
  PgReportSnapshotRepo: jest.fn().mockImplementation(() => ({})),
  PgVerificationHistoryRepo: jest.fn().mockImplementation(() => ({
    recordRun: mockRecordRun,
    invalidateInvoiceReport: mockInvalidateInvoiceReport,
  })),
  PgInvoiceRepo: jest.fn().mockImplementation(() => ({
    updateOcrResult: jest.fn(),
    updateVerification: jest.fn(),
    findDuplicatesByInvoiceNo: jest.fn(async () => []),
  })),
  PgApprovalRuleRepo: jest.fn().mockImplementation(() => ({ findActive: jest.fn(async () => []) })),
  PgApprovalRecordRepo: jest.fn().mockImplementation(() => ({ findByReportId: jest.fn(async () => []) })),
  PgUserRepo: jest.fn().mockImplementation(() => ({ findById: jest.fn() })),
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
  status: 'draft',
  currentStep: 0,
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe('POST /expenses/:id/verify history capture', () => {
  it('records a no_invoices run when the report has no invoices', async () => {
    mockFindById.mockResolvedValue(report);
    mockQuery
      .mockResolvedValueOnce({ rows: [{ department: '技术部' }] }) // assertReportAccess
      .mockResolvedValueOnce({ rows: [] }) // initial invoice preload
      .mockResolvedValueOnce({ rows: [{ total_amount: '100' }] }) // report lock
      .mockResolvedValueOnce({ rows: [] }) // items inside transaction
      .mockResolvedValueOnce({ rows: [] }); // invoices inside transaction
    mockRecordRun.mockResolvedValue({ id: 'run-1' });
    const token = signToken({ userId: 'owner-1', role: 'employee', department: '技术部' });

    const response = await fetch(`${url}/expenses/r1/verify`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({}),
    });

    expect(response.status).toBe(200);
    expect(mockRecordRun).toHaveBeenCalledTimes(1);
    const input = mockRecordRun.mock.calls[0][0];
    expect(input).toMatchObject({
      reportId: 'r1',
      kind: 'invoice',
      eventType: 'verify',
      cause: 'manual',
      status: 'no_invoices',
    });
    expect(input.items).toEqual([]);
    expect(mockRecordRun.mock.calls[0][1]).toBeTruthy();
  });
});
