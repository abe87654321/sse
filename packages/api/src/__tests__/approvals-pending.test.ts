const mockQuery = jest.fn();

jest.mock('@sse/db', () => ({
  pool: { query: (...args: any[]) => mockQuery(...args) },
  withTransaction: jest.fn(),
  PgApprovalRecordRepo: jest.fn().mockImplementation(() => ({})),
  PgExpenseRepo: jest.fn().mockImplementation(() => ({})),
  PgApprovalRuleRepo: jest.fn().mockImplementation(() => ({})),
  PgApproverAssignmentRepo: jest.fn().mockImplementation(() => ({
    findApproverIdForDepartmentName: jest.fn(async () => null),
    findFallbackAdminId: jest.fn(async () => null),
    findDepartmentsForUser: jest.fn(async () => []),
  })),
  PgUserRepo: jest.fn().mockImplementation(() => ({})),
  PgReportSnapshotRepo: jest.fn().mockImplementation(() => ({})),
}));

import express from 'express';
import type { AddressInfo } from 'net';
import type { Server } from 'http';
import { signToken } from '@sse/auth';
import { approvalRoutes } from '../routes/approvals';
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
  app.use('/approvals', approvalRoutes);
  app.use(errorHandler);
  ({ url, server } = await listen(app));
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  (console.error as jest.Mock).mockRestore();
});

beforeEach(() => {
  mockQuery.mockReset();
  mockQuery.mockResolvedValue({ rows: [] });
});

describe('GET /approvals/pending approver identity', () => {
  it('filters finance pending records by user id, with a legacy role fallback', async () => {
    const token = signToken({ userId: 'fin-1', role: 'finance', department: '财务部' });
    const response = await fetch(`${url}/approvals/pending`, {
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.status).toBe(200);
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain('ar.approver_id::text = $2');
    expect(sql).toContain('ar.approver_id::text = $3');
    expect(params).toEqual(['pending', 'fin-1', 'finance']);
  });

  it('filters dept_approver records by user id only (multi-department)', async () => {
    const token = signToken({ userId: 'dept-1', role: 'dept_approver', department: '技术部' });
    const response = await fetch(`${url}/approvals/pending`, {
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.status).toBe(200);
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain('ar.approver_id::text = $2');
    expect(sql).toContain('ar.approver_id::text = $3');
    expect(sql).not.toContain('u.department_id = (SELECT id FROM departments');
    expect(params).toEqual(['pending', 'dept-1', 'dept_approver']);
  });
});
