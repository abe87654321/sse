const mockQuery = jest.fn();
const mockAuditQuery = jest.fn();

jest.mock('@sse/db', () => ({
  pool: { query: (...args: any[]) => mockQuery(...args) },
  PgUserRepo: jest.fn().mockImplementation(() => ({})),
  PgApprovalRuleRepo: jest.fn().mockImplementation(() => ({})),
  PgAuditRepo: jest.fn().mockImplementation(() => ({ query: mockAuditQuery })),
}));

import express from 'express';
import type { AddressInfo } from 'net';
import type { Server } from 'http';
import { signToken } from '@sse/auth';
import { adminRoutes } from '../routes/admin';
import { errorHandler } from '../middleware/error';

let url: string;
let server: Server;
const adminToken = signToken({ userId: 'admin', role: 'admin', department: 'ops' });
const employeeToken = signToken({ userId: 'u1', role: 'employee', department: 'tech' });

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
  app.use('/admin', adminRoutes);
  app.use(errorHandler);
  ({ url, server } = await listen(app));
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  (console.error as jest.Mock).mockRestore();
});

beforeEach(() => {
  mockQuery.mockReset();
  mockAuditQuery.mockReset();
  mockAuditQuery.mockResolvedValue({ items: [], total: 0 });
});

describe('GET /admin/audit-events', () => {
  it('clamps pagination and passes filters to the repository', async () => {
    const response = await fetch(
      `${url}/admin/audit-events?limit=5000&offset=-2&source=auth&action=login.failure`,
      { headers: { authorization: `Bearer ${adminToken}` } }
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      total: 0,
      limit: 200,
      offset: 0,
      items: [],
    });
    expect(mockAuditQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'auth',
        action: 'login.failure',
        limit: 200,
        offset: 0,
      })
    );
  });

  it('rejects an invalid time filter', async () => {
    const response = await fetch(`${url}/admin/audit-events?from=not-a-date`, {
      headers: { authorization: `Bearer ${adminToken}` },
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'INVALID_PARAMS' },
    });
  });

  it('requires the admin role', async () => {
    const response = await fetch(`${url}/admin/audit-events`, {
      headers: { authorization: `Bearer ${employeeToken}` },
    });
    expect(response.status).toBe(403);
  });
});
