jest.mock('@sse/db', () => {
  const mocks = {
    query: jest.fn(),
    findById: jest.fn(),
    findByPhone: jest.fn(),
    deptList: jest.fn(),
    deptFindById: jest.fn(),
    deptFindByName: jest.fn(),
    deptCreate: jest.fn(),
    deptRename: jest.fn(),
    deptDelete: jest.fn(),
  };

  return {
    __mocks: mocks,
    pool: { query: mocks.query },
    PgUserRepo: jest.fn().mockImplementation(() => ({
      findById: mocks.findById,
      findByPhone: mocks.findByPhone,
    })),
    PgApprovalRuleRepo: jest.fn().mockImplementation(() => ({})),
    PgDepartmentRepo: jest.fn().mockImplementation(() => ({
      list: mocks.deptList,
      findById: mocks.deptFindById,
      findByName: mocks.deptFindByName,
      create: mocks.deptCreate,
      rename: mocks.deptRename,
      delete: mocks.deptDelete,
    })),
  };
});

jest.mock('../services/notifications', () => ({
  sendNotificationSafe: jest.fn(),
}));

const mockSyncDepartmentChange = jest.fn();
jest.mock('../services/department-ontology', () => ({
  syncDepartmentChange: (...args: any[]) => mockSyncDepartmentChange(...args),
}));

jest.mock('@sse/notifications', () => ({
  welcomeMessage: jest.fn(() => ({ type: 'welcome', title: 'w', body: 'w', channels: [] })),
}));

import express from 'express';
import type { AddressInfo } from 'net';
import type { Server } from 'http';
import * as db from '@sse/db';
import { signToken } from '@sse/auth';
import { adminRoutes } from '../routes/admin';
import { errorHandler } from '../middleware/error';

const mocks = (db as any).__mocks as {
  query: jest.Mock;
  findById: jest.Mock;
  findByPhone: jest.Mock;
  deptList: jest.Mock;
  deptFindById: jest.Mock;
  deptFindByName: jest.Mock;
  deptCreate: jest.Mock;
  deptRename: jest.Mock;
  deptDelete: jest.Mock;
};

const adminToken = signToken({ userId: 'admin-1', role: 'admin', department: '管理部' });

const techDept = {
  id: 'd-tech',
  name: '技术部',
  userCount: 2,
  isProtected: false,
};
const unassigned = {
  id: 'd-unassigned',
  name: '未分配',
  userCount: 0,
  isProtected: true,
};

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

async function request(
  method: string,
  path: string,
  body?: Record<string, unknown>
): Promise<Response> {
  return fetch(`${url}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${adminToken}`,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
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
  jest.restoreAllMocks();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  process.env.AUDIT_EVENTS = '0';
  for (const mock of Object.values(mocks)) mock.mockReset();
  mockSyncDepartmentChange.mockReset();
});

describe('GET /admin/departments', () => {
  it('returns id-based department rows with counts', async () => {
    mocks.deptList.mockResolvedValue([unassigned, techDept]);

    const response = await request('GET', '/admin/departments');

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual([unassigned, techDept]);
  });
});

describe('POST /admin/departments', () => {
  it('creates a department', async () => {
    mocks.deptCreate.mockResolvedValue({
      id: 'd-new',
      name: '市场部',
      userCount: 0,
      isProtected: false,
    });

    const response = await request('POST', '/admin/departments', { name: ' 市场部 ' });

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({ id: 'd-new', name: '市场部' });
    expect(mocks.deptCreate).toHaveBeenCalledWith('市场部');
    expect(mockSyncDepartmentChange).toHaveBeenCalledWith({
      action: 'create',
      name: '市场部',
    });
  });

  it('rejects an empty name', async () => {
    const response = await request('POST', '/admin/departments', { name: '   ' });

    expect(response.status).toBe(400);
    expect(mocks.deptCreate).not.toHaveBeenCalled();
  });

  it('maps a unique violation to DEPARTMENT_EXISTS', async () => {
    mocks.deptCreate.mockRejectedValue({ code: '23505' });

    const response = await request('POST', '/admin/departments', { name: '技术部' });

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'DEPARTMENT_EXISTS' },
    });
  });
});

describe('PATCH /admin/departments/:id', () => {
  it('renames a department and reports affected users', async () => {
    mocks.deptFindById.mockResolvedValue(techDept);
    mocks.deptRename.mockResolvedValue({ ...techDept, name: '研发部' });
    mocks.query.mockResolvedValue({
      rows: [
        {
          id: 'u1',
          name: 'Alice',
          role: 'employee',
          status: 'active',
          deleted_at: null,
          department: '研发部',
        },
      ],
    });

    const response = await request('PATCH', '/admin/departments/d-tech', { name: '研发部' });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      name: '研发部',
      affectedUsers: 1,
    });
    expect(mocks.deptRename).toHaveBeenCalledWith('d-tech', '研发部');
    expect(mockSyncDepartmentChange).toHaveBeenCalledWith({
      action: 'rename',
      name: '研发部',
      previousName: '技术部',
      users: [expect.objectContaining({ id: 'u1', department: '研发部' })],
    });
  });

  it('protects the system department', async () => {
    mocks.deptFindById.mockResolvedValue(unassigned);

    const response = await request('PATCH', '/admin/departments/d-unassigned', {
      name: '改名',
    });

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'DEPARTMENT_PROTECTED' },
    });
    expect(mocks.deptRename).not.toHaveBeenCalled();
  });

  it('rejects unknown departments', async () => {
    mocks.deptFindById.mockResolvedValue(null);

    const response = await request('PATCH', '/admin/departments/missing', { name: '改名' });

    expect(response.status).toBe(404);
  });
});

describe('DELETE /admin/departments/:id', () => {
  it('deletes an empty department', async () => {
    mocks.deptFindById.mockResolvedValue({ ...techDept, userCount: 0 });
    mocks.deptDelete.mockResolvedValue(true);

    const response = await request('DELETE', '/admin/departments/d-tech');

    expect(response.status).toBe(200);
    expect(mocks.deptDelete).toHaveBeenCalledWith('d-tech');
    expect(mockSyncDepartmentChange).toHaveBeenCalledWith({
      action: 'delete',
      name: '技术部',
    });
  });

  it('refuses to delete a department with users', async () => {
    mocks.deptFindById.mockResolvedValue(techDept);

    const response = await request('DELETE', '/admin/departments/d-tech');

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'DEPARTMENT_IN_USE' },
    });
    expect(mocks.deptDelete).not.toHaveBeenCalled();
  });

  it('refuses to delete the protected department', async () => {
    mocks.deptFindById.mockResolvedValue(unassigned);

    const response = await request('DELETE', '/admin/departments/d-unassigned');

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'DEPARTMENT_PROTECTED' },
    });
  });
});

describe('admin user department resolution', () => {
  it('accepts a departmentId when creating a user', async () => {
    mocks.deptFindById.mockResolvedValue(techDept);
    mocks.findByPhone.mockResolvedValue(null);
    mocks.query.mockResolvedValue({
      rows: [
        {
          id: 'u2',
          name: '新用户',
          phone: '13900000002',
          email: null,
          department_id: 'd-tech',
          role: 'employee',
          parent_id: null,
          status: 'active',
          deleted_at: null,
          created_at: new Date('2026-11-22T00:00:00Z'),
          updated_at: new Date('2026-11-22T00:00:00Z'),
        },
      ],
    });

    const response = await request('POST', '/admin/users', {
      name: '新用户',
      phone: '13900000002',
      departmentId: 'd-tech',
      role: 'employee',
      password: 'secret123',
    });

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({
      department: '技术部',
      departmentId: 'd-tech',
    });
    const [, params] = mocks.query.mock.calls[0];
    expect(params[3]).toBe('d-tech');
  });

  it('rejects an unknown department name', async () => {
    mocks.deptFindByName.mockResolvedValue(null);

    const response = await request('POST', '/admin/users', {
      name: '新用户',
      phone: '13900000002',
      department: '不存在部',
      role: 'employee',
      password: 'secret123',
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'UNKNOWN_DEPARTMENT' },
    });
    expect(mocks.query).not.toHaveBeenCalled();
  });
});
