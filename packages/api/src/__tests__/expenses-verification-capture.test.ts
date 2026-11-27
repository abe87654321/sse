const mockQuery = jest.fn();
const mockFindById = jest.fn();
const mockRecordRun = jest.fn();
const mockInvalidateInvoiceReport = jest.fn();
const mockFindDuplicates = jest.fn();
const mockInvoiceCreate = jest.fn();

jest.mock('@sse/ai', () => ({ MINERU_PARSER_VERSION: 1 }));
jest.mock('../services/ai-engines', () => ({ createOCREngine: jest.fn() }));
jest.mock('../services/notifications', () => ({ sendNotificationSafe: jest.fn() }));
jest.mock('../services/audit', () => ({ auditFromRequest: jest.fn() }));
jest.mock('../services/payment-receipt-verifier', () => ({
  queuePaymentReceiptVerification: jest.fn(),
  runPaymentReceiptVerification: jest.fn(),
}));
jest.mock('../middleware/upload', () => ({
  uploadInvoice: {
    single: () => (req: any, _res: any, next: any) => {
      req.file = {
        originalname: 'a.pdf',
        buffer: Buffer.from('%PDF-1.4'),
        size: 8,
        mimetype: 'application/pdf',
      };
      next();
    },
  },
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
    recordRun: mockRecordRun,
    invalidateInvoiceReport: mockInvalidateInvoiceReport,
  })),
  PgInvoiceRepo: jest.fn().mockImplementation(() => ({
    updateOcrResult: jest.fn(),
    updateVerification: jest.fn(),
    findDuplicatesByInvoiceNo: (...args: any[]) => mockFindDuplicates(...args),
    create: (...args: any[]) => mockInvoiceCreate(...args),
  })),
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
  mockQuery.mockReset();
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

describe('POST /expenses/:id/verify with invoices', () => {
  it('records a verify run with one item when OCR is already cached', async () => {
    const invoiceRow = {
      id: 'inv-1',
      item_id: 'it-1',
      file_name: 'a.pdf',
      file_format: 'pdf',
      file_size: 1024,
      storage_key: 'invoices/a.pdf',
      storage_bucket: 'invoices',
      checksum: 'abc',
      invoice_no: 'NO-1',
      ocr_result: {
        parserVersion: 1,
        invoiceNo: 'NO-1',
        totalAmount: 100,
        invoiceDate: '2026-11-21',
      },
      verification_status: 'pending',
      verification_result: null,
      verified_at: null,
      uploaded_at: new Date('2026-11-21T08:00:00Z'),
    };

    mockFindById.mockResolvedValue(report);
    mockQuery
      .mockResolvedValueOnce({ rows: [{ department: '技术部' }] }) // assertReportAccess
      .mockResolvedValueOnce({ rows: [invoiceRow] }) // initial invoice preload
      .mockResolvedValueOnce({ rows: [{ total_amount: '100' }] }) // report lock
      .mockResolvedValueOnce({
        rows: [
          {
            id: 'it-1',
            report_id: 'r1',
            category_id: 'c1',
            amount: '100',
            expense_date: '2026-11-21',
            description: 'x',
          },
        ],
      }) // items inside transaction
      .mockResolvedValueOnce({ rows: [invoiceRow] }); // invoices inside transaction
    mockFindDuplicates.mockResolvedValue([]);
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
      status: 'pass',
    });
    expect(input.items).toHaveLength(1);
    expect(input.items[0]).toMatchObject({
      subjectId: 'inv-1',
      itemId: 'it-1',
      fileName: 'a.pdf',
      status: 'pass',
    });
    expect(input.items[0].result.status).toBe('pass');
  });
});

describe('PUT /expenses/:id verification invalidation', () => {
  it('records an items_updated invalidation in the edit transaction', async () => {
    mockFindById.mockResolvedValue(report);
    mockQuery
      .mockResolvedValueOnce({ rows: [] }) // BEGIN
      .mockResolvedValueOnce({ rows: [] }) // report lock
      .mockResolvedValueOnce({ rows: [{ id: 'it-1' }] }) // existing item ids
      .mockResolvedValueOnce({ rows: [] }) // update item
      .mockResolvedValueOnce({ rows: [] }) // update report total
      .mockResolvedValueOnce({ rows: [] }); // COMMIT
    mockInvalidateInvoiceReport.mockResolvedValue({ runId: 'run-inv', affected: 1 });
    const token = signToken({ userId: 'owner-1', role: 'employee', department: '技术部' });

    const response = await fetch(`${url}/expenses/r1`, {
      method: 'PUT',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        items: [
          {
            id: 'it-1',
            categoryId: 'c1',
            amount: 100,
            expenseDate: '2026-11-21',
            description: 'x',
          },
        ],
      }),
    });

    expect(response.status).toBe(200);
    const body = (await response.json()) as any;
    expect(body.id).toBe('r1');
    expect(mockInvalidateInvoiceReport).toHaveBeenCalledWith(
      expect.objectContaining({
        actor: { type: 'user', id: 'owner-1', role: 'employee' },
        reason: '费用明细修改，原核对结果失效',
      }),
      expect.anything()
    );
    expect(mockQuery).toHaveBeenCalledTimes(6);
    expect(mockInvalidateInvoiceReport).toHaveBeenCalledWith(
      expect.objectContaining({ reportId: 'r1', cause: 'items_updated' }),
      expect.anything()
    );
  });
});

describe('POST /expenses/:id/items/:itemId/invoice invalidation', () => {
  it('records an invoice_uploaded invalidation', async () => {
    mockFindById.mockResolvedValue(report);
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 'it-1' }] }) // item check
      .mockResolvedValueOnce({ rows: [] }); // report lock inside transaction
    mockInvoiceCreate.mockResolvedValue({
      id: 'inv-1',
      itemId: 'it-1',
      fileName: 'a.pdf',
    });
    mockInvalidateInvoiceReport.mockResolvedValue({ runId: 'run-inv', affected: 1 });
    const token = signToken({ userId: 'owner-1', role: 'employee', department: '技术部' });

    const response = await fetch(`${url}/expenses/r1/items/it-1/invoice`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.status).toBe(201);
    const body = (await response.json()) as any;
    expect(body.id).toBe('inv-1');
    expect(body.fileName).toBe('a.pdf');
    expect(mockInvalidateInvoiceReport).toHaveBeenCalledWith(
      expect.objectContaining({
        actor: { type: 'user', id: 'owner-1', role: 'employee' },
        reason: '发票上传/替换，原核对结果失效',
      }),
      expect.anything()
    );
    expect(mockQuery).toHaveBeenCalledTimes(2);
    expect(mockInvalidateInvoiceReport).toHaveBeenCalledWith(
      expect.objectContaining({ reportId: 'r1', cause: 'invoice_uploaded' }),
      expect.anything()
    );
  });
});
