const mockQuery = jest.fn();
const mockSnapshotQuery = jest.fn();
const mockFindDetailById = jest.fn();

jest.mock('@sse/db', () => ({
  pool: { query: (...args: any[]) => mockQuery(...args) },
  PgReportSnapshotRepo: jest.fn().mockImplementation(() => ({
    query: mockSnapshotQuery,
    findDetailById: mockFindDetailById,
  })),
}));

import express from 'express';
import type { AddressInfo } from 'net';
import type { Server } from 'http';
import { signToken } from '@sse/auth';
import { adminSnapshotRoutes } from '../routes/admin-snapshots';
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
  app.use('/admin/snapshots', adminSnapshotRoutes);
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

describe('GET /admin/snapshots', () => {
  it('rejects non-admin users', async () => {
    const token = signToken({ userId: 'f1', role: 'finance', department: '财务部' });

    const response = await fetch(`${url}/admin/snapshots`, {
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.status).toBe(403);
    expect(mockSnapshotQuery).not.toHaveBeenCalled();
  });

  it('returns filtered snapshots for admins', async () => {
    mockSnapshotQuery.mockResolvedValue({ items: [{ id: 's1' }], total: 1 });
    const token = signToken({ userId: 'a1', role: 'admin', department: '管理部' });

    const response = await fetch(
      `${url}/admin/snapshots?reportId=r1&snapshotType=pay&legacy=false&limit=10&offset=0`,
      { headers: { authorization: `Bearer ${token}` } }
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as any;
    expect(body.total).toBe(1);
    expect(mockSnapshotQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        reportId: 'r1',
        snapshotType: 'pay',
        legacy: false,
        limit: 10,
        offset: 0,
      })
    );
  });
});
