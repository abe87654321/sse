const mockQuery = jest.fn();
const mockFindById = jest.fn();

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
  withTransaction: jest.fn(),
  PgExpenseRepo: jest.fn().mockImplementation(() => ({ findById: mockFindById })),
  PgReportSnapshotRepo: jest.fn().mockImplementation(() => ({})),
  PgVerificationHistoryRepo: jest.fn().mockImplementation(() => ({})),
  PgInvoiceRepo: jest.fn().mockImplementation(() => ({})),
  PgApprovalRuleRepo: jest.fn().mockImplementation(() => ({ findActive: jest.fn(async () => []) })),
  PgApprovalRecordRepo: jest.fn().mockImplementation(() => ({ findByReportId: jest.fn(async () => []) })),
  PgUserRepo: jest.fn().mockImplementation(() => ({ findById: jest.fn() })),
  PgApproverAssignmentRepo: jest.fn().mockImplementation(() => ({
    findApproverIdForDepartmentName: jest.fn(async () => null),
    findFallbackAdminId: jest.fn(async () => null),
    findDepartmentsForUser: jest.fn(async () => []),
  })),
  PgPaymentReceiptRepo: jest.fn().mockImplementation(() => ({ findByReportId: jest.fn(async () => null) })),
  PgPaymentAuditRepo: jest.fn().mockImplementation(() => ({ findByReportId: jest.fn(async () => []) })),
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

beforeEach(() => {
  jest.clearAllMocks();
  mockFindById.mockResolvedValue(report);
});

it('masks duplicate invoice details for the report owner', async () => {
  mockQuery
    .mockResolvedValueOnce({ rows: [{ department: '技术部' }] }) // assertReportAccess
    .mockResolvedValueOnce({ rows: [{ id: 'it-1', report_id: 'r1', category_id: 'c1', amount: '100', expense_date: '2026-11-21', description: 'x' }] }) // items
    .mockResolvedValueOnce({ rows: [{ category_id: 'c1' }] }) // category ids
    .mockResolvedValueOnce({ rows: [{ id: 'inv-1', item_id: 'it-1', file_name: 'a.pdf', verification_status: 'warning', verification_result: { duplicates: [{ invoiceId: 'inv-2', serialNo: 'RE-2' }], ocr: { invoiceNo: 'NO-1' } } }] }); // invoices

  const token = signToken({ userId: 'owner-1', role: 'employee', department: '技术部' });
  const response = await fetch(`${url}/expenses/r1`, {
    headers: { authorization: `Bearer ${token}` },
  });

  expect(response.status).toBe(200);
  const body = (await response.json()) as any;
  expect(body.invoices[0].verificationResult.duplicates).toEqual([{ restricted: true }]);
  expect(body.invoices[0].verificationResult.ocr).toEqual({ invoiceNo: 'NO-1' });
});

it('keeps duplicate invoice details for finance', async () => {
  mockQuery
    .mockResolvedValueOnce({ rows: [{ department: '财务部' }] }) // assertReportAccess
    .mockResolvedValueOnce({ rows: [{ id: 'it-1', report_id: 'r1', category_id: 'c1', amount: '100', expense_date: '2026-11-21', description: 'x' }] }) // items
    .mockResolvedValueOnce({ rows: [{ category_id: 'c1' }] }) // category ids
    .mockResolvedValueOnce({ rows: [{ id: 'inv-1', item_id: 'it-1', file_name: 'a.pdf', verification_status: 'warning', verification_result: { duplicates: [{ invoiceId: 'inv-2', serialNo: 'RE-2' }] } }] }); // invoices

  const token = signToken({ userId: 'fin-1', role: 'finance', department: '财务部' });
  const response = await fetch(`${url}/expenses/r1`, {
    headers: { authorization: `Bearer ${token}` },
  });

  expect(response.status).toBe(200);
  const body = (await response.json()) as any;
  expect(body.invoices[0].verificationResult.duplicates[0].serialNo).toBe('RE-2');
});

it('keeps duplicate invoice details for department approvers', async () => {
  mockQuery
    .mockResolvedValueOnce({ rows: [{ department: '技术部' }] }) // assertReportAccess
    .mockResolvedValueOnce({ rows: [{ id: 'it-1', report_id: 'r1', category_id: 'c1', amount: '100', expense_date: '2026-11-21', description: 'x' }] }) // items
    .mockResolvedValueOnce({ rows: [{ category_id: 'c1' }] }) // category ids
    .mockResolvedValueOnce({ rows: [{ id: 'inv-1', item_id: 'it-1', file_name: 'a.pdf', verification_status: 'warning', verification_result: { duplicates: [{ invoiceId: 'inv-2', serialNo: 'RE-2' }] } }] }); // invoices

  const token = signToken({ userId: 'dept-1', role: 'dept_approver', department: '技术部' });
  const response = await fetch(`${url}/expenses/r1`, {
    headers: { authorization: `Bearer ${token}` },
  });

  expect(response.status).toBe(200);
  const body = (await response.json()) as any;
  expect(body.invoices[0].verificationResult.duplicates[0].serialNo).toBe('RE-2');
});

it('returns invoice unchanged when verificationResult is missing', async () => {
  mockQuery
    .mockResolvedValueOnce({ rows: [{ department: '技术部' }] }) // assertReportAccess
    .mockResolvedValueOnce({ rows: [{ id: 'it-1', report_id: 'r1', category_id: 'c1', amount: '100', expense_date: '2026-11-21', description: 'x' }] }) // items
    .mockResolvedValueOnce({ rows: [{ category_id: 'c1' }] }) // category ids
    .mockResolvedValueOnce({ rows: [{ id: 'inv-1', item_id: 'it-1', file_name: 'a.pdf', verification_status: 'pending' }] }); // invoices

  const token = signToken({ userId: 'owner-1', role: 'employee', department: '技术部' });
  const response = await fetch(`${url}/expenses/r1`, {
    headers: { authorization: `Bearer ${token}` },
  });

  expect(response.status).toBe(200);
  const body = (await response.json()) as any;
  expect(body.invoices[0].verificationResult).toBeUndefined();
});
