const mockQuery = jest.fn();
const mockRunVerification = jest.fn();
const mockFindById = jest.fn();
const mockReceiptFindById = jest.fn();
const mockReceiptFindByReportId = jest.fn();
const mockReceiptUpsert = jest.fn();
const mockInvalidateReceipt = jest.fn();

jest.mock('@sse/ai', () => ({ MINERU_PARSER_VERSION: 1 }));
jest.mock('../services/ai-engines', () => ({ createOCREngine: jest.fn() }));
jest.mock('../services/notifications', () => ({ sendNotificationSafe: jest.fn() }));
jest.mock('../services/audit', () => ({ auditFromRequest: jest.fn() }));
jest.mock('../services/payment-receipt-verifier', () => ({
  queuePaymentReceiptVerification: jest.fn(),
  runPaymentReceiptVerification: (...args: any[]) => mockRunVerification(...args),
}));
jest.mock('../middleware/upload', () => ({
  uploadInvoice: { single: () => (_req: any, _res: any, next: any) => next() },
  uploadPaymentReceipt: {
    single: () => (req: any, _res: any, next: any) => {
      req.file = {
        originalname: 'receipt.pdf',
        buffer: Buffer.from('%PDF-1.4'),
        size: 8,
        mimetype: 'application/pdf',
      };
      next();
    },
  },
  validateUploadSignature: () => 'pdf',
}));
jest.mock('../storage/minio-storage', () => ({
  MinioStorage: jest.fn().mockImplementation(() => ({
    calculateChecksum: jest.fn(() => 'checksum'),
    upload: jest.fn(),
    getObject: jest.fn(),
  })),
}));

jest.mock('@sse/db', () => ({
  pool: {
    query: (...args: any[]) => mockQuery(...args),
    connect: jest.fn(async () => ({
      query: (...args: any[]) => mockQuery(...args),
      release: jest.fn(),
    })),
  },
  withTransaction: jest.fn(async (_pool: any, fn: any) =>
    fn({ query: (...args: any[]) => mockQuery(...args) })
  ),
  PgExpenseRepo: jest.fn().mockImplementation(() => ({ findById: mockFindById })),
  PgReportSnapshotRepo: jest.fn().mockImplementation(() => ({})),
  PgVerificationHistoryRepo: jest.fn().mockImplementation(() => ({
    invalidateReceipt: mockInvalidateReceipt,
  })),
  PgInvoiceRepo: jest.fn().mockImplementation(() => ({})),
  PgApprovalRuleRepo: jest.fn().mockImplementation(() => ({ findActive: jest.fn(async () => []) })),
  PgApprovalRecordRepo: jest.fn().mockImplementation(() => ({})),
  PgUserRepo: jest.fn().mockImplementation(() => ({})),
  PgPaymentReceiptRepo: jest.fn().mockImplementation(() => ({
    findById: mockReceiptFindById,
    findByReportId: mockReceiptFindByReportId,
    upsert: (...args: any[]) => mockReceiptUpsert(...args),
  })),
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

beforeAll(async () => {
  jest.spyOn(console, 'error').mockImplementation(() => {});
  const app = express();
  app.use(express.json());
  app.use('/expenses', expenseRoutes);
  app.use(errorHandler);
  await new Promise<void>((resolve) => {
    server = app.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      url = `http://127.0.0.1:${port}`;
      resolve();
    });
  });
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  (console.error as jest.Mock).mockRestore();
});

beforeEach(() => {
  jest.clearAllMocks();
});

it('passes the finance actor into receipt verification history', async () => {
  mockFindById.mockResolvedValue({ id: 'r1', status: 'paid', totalAmount: 100 });
  mockReceiptFindById.mockResolvedValue({ id: 'receipt-1', reportId: 'r1' });
  mockRunVerification.mockResolvedValue({ status: 'pass' });
  const token = signToken({ userId: 'fin-1', role: 'finance', department: '财务部' });

  const response = await fetch(`${url}/expenses/r1/payment-receipts/receipt-1/verify`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ force: true }),
  });

  expect(response.status).toBe(200);
  expect(mockRunVerification).toHaveBeenCalledWith('receipt-1', true, {
    actor: { type: 'user', id: 'fin-1', role: 'finance' },
    cause: 'force_ocr',
  });
});

it('records a receipt_replaced invalidation when uploading a new receipt', async () => {
  mockFindById.mockResolvedValue({ id: 'r1', status: 'approved', totalAmount: 100 });
  mockQuery.mockResolvedValueOnce({ rows: [] }); // report/receipt lock
  mockReceiptFindByReportId.mockResolvedValue({
    id: 'receipt-1',
    reportId: 'r1',
    verificationStatus: 'pass',
  });
  mockInvalidateReceipt.mockResolvedValue({ runId: 'run-inv', affected: 1 });
  mockReceiptUpsert.mockResolvedValue({
    id: 'receipt-1',
    reportId: 'r1',
    fileName: 'receipt.pdf',
  });
  const token = signToken({ userId: 'fin-1', role: 'finance', department: '财务部' });

  const response = await fetch(`${url}/expenses/r1/payment-receipts`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
  });

  expect(response.status).toBe(201);
  expect(mockInvalidateReceipt).toHaveBeenCalledWith(
    expect.objectContaining({
      reportId: 'r1',
      receiptId: 'receipt-1',
      cause: 'receipt_replaced',
    }),
    expect.anything()
  );
});
