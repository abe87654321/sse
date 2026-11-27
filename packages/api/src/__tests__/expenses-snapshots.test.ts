const mockQuery = jest.fn();
const mockFindById = jest.fn();
const mockFindByReportId = jest.fn();
const mockFindDetailByReport = jest.fn();
const mockCapture = jest.fn();
const mockUserFindById = jest.fn();

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
  PgReportSnapshotRepo: jest.fn().mockImplementation(() => ({
    capture: mockCapture,
    findByReportId: mockFindByReportId,
    findDetailByReport: mockFindDetailByReport,
  })),
  PgInvoiceRepo: jest.fn().mockImplementation(() => ({})),
  PgApprovalRuleRepo: jest.fn().mockImplementation(() => ({
    findActive: jest.fn(async () => []),
  })),
  PgApprovalRecordRepo: jest.fn().mockImplementation(() => ({})),
  PgUserRepo: jest.fn().mockImplementation(() => ({ findById: mockUserFindById })),
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
  status: 'pending',
  currentStep: 1,
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe('GET /expenses/:id/snapshots', () => {
  it('allows the owner and returns snapshot metadata', async () => {
    mockFindById.mockResolvedValue(report);
    mockQuery.mockResolvedValue({ rows: [{ department: '技术部' }] });
    mockFindByReportId.mockResolvedValue([
      { id: 's1', reportId: 'r1', snapshotType: 'submit' },
    ]);
    const token = signToken({ userId: 'owner-1', role: 'employee', department: '技术部' });

    const response = await fetch(`${url}/expenses/r1/snapshots`, {
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.status).toBe(200);
    const body = (await response.json()) as any;
    expect(body.items).toHaveLength(1);
    expect(mockFindByReportId).toHaveBeenCalledWith('r1');
  });

  it('blocks unrelated employees', async () => {
    mockFindById.mockResolvedValue(report);
    mockQuery.mockResolvedValue({ rows: [{ department: '技术部' }] });
    const token = signToken({ userId: 'other-1', role: 'employee', department: '市场部' });

    const response = await fetch(`${url}/expenses/r1/snapshots`, {
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.status).toBe(403);
    expect(mockFindByReportId).not.toHaveBeenCalled();
  });
});

describe('POST /expenses/:id/submit snapshot capture', () => {
  it('captures a submit snapshot inside the transaction', async () => {
    mockFindById.mockResolvedValue({ ...report, status: 'draft' });
    mockUserFindById.mockResolvedValue({ id: 'owner-1', department: '技术部' });
    mockQuery
      .mockResolvedValueOnce({ rows: [{ category_id: 'c1' }] })
      .mockResolvedValueOnce({ rows: [] });
    mockCapture.mockResolvedValue({ id: 's1' });
    const token = signToken({ userId: 'owner-1', role: 'employee', department: '技术部' });

    const response = await fetch(`${url}/expenses/r1/submit`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.status).toBe(200);
    expect(mockCapture).toHaveBeenCalledTimes(1);
    expect(mockCapture.mock.calls[0][0]).toEqual({
      reportId: 'r1',
      snapshotType: 'submit',
      actor: { type: 'user', id: 'owner-1', role: 'employee' },
      rule: null,
    });
    expect(mockCapture.mock.calls[0][1]).toBeTruthy();
  });
});

describe('GET /expenses/:id/snapshots/:snapshotId payment redaction', () => {
  function detailFixture() {
    return {
      id: 's1',
      reportId: 'r1',
      snapshotType: 'pay',
      payload: {
        schemaVersion: 1,
        payment: {
          paymentRef: 'BANK-1',
          receipt: {
            id: 'pr1',
            verificationResult: { secret: 'receipt-detail' },
          },
        },
      },
    };
  }

  it('redacts receipt verification details for the report owner', async () => {
    mockFindById.mockResolvedValue({ ...report, status: 'paid' });
    mockQuery.mockResolvedValue({ rows: [{ department: '技术部' }] });
    mockFindDetailByReport.mockResolvedValue(detailFixture());
    const token = signToken({ userId: 'owner-1', role: 'employee', department: '技术部' });

    const response = await fetch(`${url}/expenses/r1/snapshots/s1`, {
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.status).toBe(200);
    const body = (await response.json()) as any;
    expect(body.payload.payment.receipt.verificationResult).toBeNull();
    expect(body.payload.payment.paymentRef).toBe('BANK-1');
  });

  it('keeps receipt verification details for finance', async () => {
    mockFindById.mockResolvedValue({ ...report, status: 'paid' });
    mockFindDetailByReport.mockResolvedValue(detailFixture());
    const token = signToken({ userId: 'fin-1', role: 'finance', department: '财务部' });

    const response = await fetch(`${url}/expenses/r1/snapshots/s1`, {
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.status).toBe(200);
    const body = (await response.json()) as any;
    expect(body.payload.payment.receipt.verificationResult).toEqual({
      secret: 'receipt-detail',
    });
  });
});
