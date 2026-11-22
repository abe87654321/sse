const mockAudit = jest.fn();
const mockService = {
  listBackups: jest.fn(async () => []),
  startCreate: jest.fn(async () => ({ id: 'job-1', status: 'running' })),
  startVerify: jest.fn(async () => ({ id: 'job-2', status: 'running' })),
  startRestore: jest.fn(async () => ({ id: 'job-3', status: 'running' })),
  startDrillCleanup: jest.fn(async () => ({ id: 'job-4', status: 'running' })),
  listDrills: jest.fn(() => []),
  get: jest.fn(() => undefined),
  listJobs: jest.fn(() => []),
  download: jest.fn(async (_id: string, res: any) => res.end('archive')),
  upload: jest.fn(async () => undefined),
  remove: jest.fn(async () => undefined),
};

jest.mock('../services/backup-service', () => ({
  getBackupService: () => mockService,
}));
jest.mock('../services/audit', () => ({ auditFromRequest: (...args: any[]) => mockAudit(...args) }));

import express from 'express';
import type { AddressInfo } from 'net';
import type { Server } from 'http';
import { signToken } from '@sse/auth';
import { adminBackupRoutes } from '../routes/admin-backups';
import { errorHandler } from '../middleware/error';

let url: string;
let server: Server;

beforeAll(async () => {
  process.env.BACKUP_RESTORE_ENABLED = 'true';
  process.env.DB_NAME = 'sse';
  const app = express();
  app.use(express.json());
  app.use('/admin/backups', adminBackupRoutes);
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
  delete process.env.BACKUP_RESTORE_ENABLED;
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  mockAudit.mockReset();
  jest.clearAllMocks();
});

const admin = () => signToken({ userId: 'a1', role: 'admin', department: '管理部' });
const employee = () => signToken({ userId: 'u1', role: 'employee', department: '技术部' });

test('requires authentication and admin role', async () => {
  expect((await fetch(`${url}/admin/backups`)).status).toBe(401);
  expect(
    (await fetch(`${url}/admin/backups`, { headers: { authorization: `Bearer ${employee()}` } })).status
  ).toBe(403);
});

test('starts a backup job and audits it', async () => {
  const response = await fetch(`${url}/admin/backups`, {
    method: 'POST',
    headers: { authorization: `Bearer ${admin()}`, 'content-type': 'application/json' },
    body: JSON.stringify({ includeSecrets: false, upload: true }),
  });
  expect(response.status).toBe(202);
  expect(mockAudit).toHaveBeenCalledWith(
    expect.anything(),
    expect.objectContaining({ action: 'backup.create' })
  );
});

test('rejects a wrong restore confirmation phrase', async () => {
  const response = await fetch(`${url}/admin/backups/b1/restore`, {
    method: 'POST',
    headers: { authorization: `Bearer ${admin()}`, 'content-type': 'application/json' },
    body: JSON.stringify({ targetDb: 'sse_drill_1', confirm: 'yes' }),
  });
  expect(response.status).toBe(400);
});

test('cleans up a drill and audits it', async () => {
  const response = await fetch(`${url}/admin/backups/drills/restore-1/cleanup`, {
    method: 'POST',
    headers: { authorization: `Bearer ${admin()}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      targetDb: 'sse_drill_1',
      targetMinioPrefix: 'drills/b1/',
      confirm: 'CLEANUP sse_drill_1',
    }),
  });
  expect(response.status).toBe(202);
  expect(mockAudit).toHaveBeenCalledWith(
    expect.anything(),
    expect.objectContaining({ action: 'backup.drill_cleanup' })
  );
});

test('streams a backup download', async () => {
  const response = await fetch(`${url}/admin/backups/b1/download`, {
    headers: { authorization: `Bearer ${admin()}` },
  });
  expect(response.status).toBe(200);
  expect(await response.text()).toBe('archive');
});
