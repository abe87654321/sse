jest.mock('@sse/db', () => {
  const mocks = {
    query: jest.fn(),
    findCredentialsByPhone: jest.fn(),
    findCredentialsById: jest.fn(),
    findByPhone: jest.fn(),
    findById: jest.fn(),
  };

  return {
    __mocks: mocks,
    pool: { query: mocks.query },
    PgUserRepo: jest.fn().mockImplementation(() => ({
      findCredentialsByPhone: mocks.findCredentialsByPhone,
      findCredentialsById: mocks.findCredentialsById,
      findByPhone: mocks.findByPhone,
      findById: mocks.findById,
    })),
    PgApprovalRuleRepo: jest.fn().mockImplementation(() => ({})),
  };
});

jest.mock('../services/notifications', () => ({
  sendNotificationSafe: jest.fn(),
}));

jest.mock('@sse/notifications', () => ({
  welcomeMessage: jest.fn(() => ({
    type: 'welcome',
    title: 'welcome',
    body: 'welcome',
    channels: ['email'],
  })),
}));

import express from 'express';
import type { AddressInfo } from 'net';
import type { Server } from 'http';
import * as db from '@sse/db';
import { hashPassword, signToken, verifyPassword } from '@sse/auth';
import { authRoutes, __resetLoginRateLimitForTests } from '../routes/auth';
import { adminRoutes } from '../routes/admin';
import { errorHandler } from '../middleware/error';

const mocks = (db as any).__mocks as {
  query: jest.Mock;
  findCredentialsByPhone: jest.Mock;
  findCredentialsById: jest.Mock;
  findByPhone: jest.Mock;
  findById: jest.Mock;
};

const activeUser = {
  id: 'u1',
  name: 'Test User',
  phone: '13800000001',
  email: 'test@example.com',
  department: 'tech',
  role: 'employee',
  status: 'active',
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-01T00:00:00Z'),
};

function userRow(overrides: Record<string, any> = {}) {
  return {
    id: 'u1',
    name: 'Test User',
    phone: '13800000001',
    email: 'test@example.com',
    department: 'tech',
    role: 'employee',
    parent_id: null,
    status: 'active',
    deleted_at: null,
    created_at: new Date('2026-01-01T00:00:00Z'),
    updated_at: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

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

function close(instance: Server): Promise<void> {
  return new Promise((resolve) => instance.close(() => resolve()));
}

async function request(
  method: string,
  path: string,
  body?: Record<string, unknown>,
  token?: string
): Promise<Response> {
  return fetch(`${url}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

beforeAll(async () => {
  jest.spyOn(console, 'error').mockImplementation(() => {});
  const app = express();
  app.use(express.json());
  app.use('/auth', authRoutes);
  app.use('/admin', adminRoutes);
  app.use(errorHandler);
  ({ url, server } = await listen(app));
});

afterAll(async () => {
  await close(server);
  (console.error as jest.Mock).mockRestore();
});

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset();
  mocks.query.mockResolvedValue({ rows: [] });
  __resetLoginRateLimitForTests();
  delete process.env.ALLOW_LEGACY_PLAINTEXT_PASSWORDS;
});

describe('POST /auth/login', () => {
  it('signs tokens when the password matches', async () => {
    mocks.findCredentialsByPhone.mockResolvedValue({
      user: activeUser,
      passwordHash: await hashPassword('correct-password'),
    });

    const response = await request('POST', '/auth/login', {
      phone: activeUser.phone,
      password: 'correct-password',
    });

    expect(response.status).toBe(200);
    const body: any = await response.json();
    expect(body.accessToken).toEqual(expect.any(String));
    expect(body.refreshToken).toEqual(expect.any(String));
    expect(body.user).toMatchObject({ id: 'u1', phone: activeUser.phone });
    expect(mocks.query).not.toHaveBeenCalled();
  });

  it('returns a generic 401 for a wrong password', async () => {
    mocks.findCredentialsByPhone.mockResolvedValue({
      user: activeUser,
      passwordHash: await hashPassword('correct-password'),
    });

    const response = await request('POST', '/auth/login', {
      phone: activeUser.phone,
      password: 'wrong-password',
    });

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      error: { message: '手机号或密码错误' },
    });
  });

  it('returns the same generic 401 when the phone does not exist', async () => {
    mocks.findCredentialsByPhone.mockResolvedValue(null);

    const response = await request('POST', '/auth/login', {
      phone: '13900000000',
      password: 'anything',
    });

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      error: { message: '手机号或密码错误' },
    });
  });

  it('keeps the 403 response for a disabled account', async () => {
    mocks.findCredentialsByPhone.mockResolvedValue({
      user: { ...activeUser, status: 'inactive' },
      passwordHash: await hashPassword('correct-password'),
    });

    const response = await request('POST', '/auth/login', {
      phone: activeUser.phone,
      password: 'correct-password',
    });

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      error: { message: '账号已被禁用' },
    });
  });

  it('rejects legacy plaintext when the migration flag is off', async () => {
    mocks.findCredentialsByPhone.mockResolvedValue({
      user: activeUser,
      passwordHash: 'legacy-secret',
    });

    const response = await request('POST', '/auth/login', {
      phone: activeUser.phone,
      password: 'legacy-secret',
    });

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      error: { message: '手机号或密码错误' },
    });
    expect(mocks.query).not.toHaveBeenCalled();
  });

  it('upgrades a legacy plaintext password after a successful login when enabled', async () => {
    process.env.ALLOW_LEGACY_PLAINTEXT_PASSWORDS = '1';
    mocks.findCredentialsByPhone.mockResolvedValue({
      user: activeUser,
      passwordHash: 'legacy-secret',
    });

    const response = await request('POST', '/auth/login', {
      phone: activeUser.phone,
      password: 'legacy-secret',
    });

    expect(response.status).toBe(200);
    expect(mocks.query).toHaveBeenCalledTimes(1);
    const [sql, params] = mocks.query.mock.calls[0];
    expect(sql).toContain('UPDATE users SET password_hash = $1 WHERE id = $2');
    expect(params[1]).toBe('u1');
    await expect(verifyPassword('legacy-secret', params[0])).resolves.toMatchObject({
      ok: true,
    });
  });

  it('rejects SCIM/MDM sentinel values as login credentials', async () => {
    for (const sentinel of ['scim_managed_no_pwd', 'mdm_managed_no_pwd', '!']) {
      __resetLoginRateLimitForTests();
      mocks.findCredentialsByPhone.mockResolvedValue({
        user: activeUser,
        passwordHash: sentinel,
      });

      const response = await request('POST', '/auth/login', {
        phone: activeUser.phone,
        password: sentinel,
      });

      expect(response.status).toBe(401);
      await expect(response.json()).resolves.toMatchObject({
        error: { message: '手机号或密码错误' },
      });
      expect(mocks.query).not.toHaveBeenCalled();
    }
  });

  it('does not reveal an inactive account when the password is wrong', async () => {
    mocks.findCredentialsByPhone.mockResolvedValue({
      user: { ...activeUser, status: 'inactive' },
      passwordHash: await hashPassword('correct-password'),
    });

    const response = await request('POST', '/auth/login', {
      phone: activeUser.phone,
      password: 'wrong-password',
    });

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      error: { message: '手机号或密码错误' },
    });
  });

  it('rejects passwords longer than 72 UTF-8 bytes before any lookup', async () => {
    mocks.findCredentialsByPhone.mockResolvedValue({
      user: activeUser,
      passwordHash: await hashPassword('correct-password'),
    });

    const response = await request('POST', '/auth/login', {
      phone: activeUser.phone,
      password: '密'.repeat(25),
    });

    expect(response.status).toBe(401);
    expect(mocks.findCredentialsByPhone).not.toHaveBeenCalled();
  });

  it('blocks after 10 attempts for the same ip and phone', async () => {
    mocks.findCredentialsByPhone.mockResolvedValue({
      user: activeUser,
      passwordHash: 'legacy-secret',
    });

    for (let attempt = 0; attempt < 10; attempt += 1) {
      const response = await request('POST', '/auth/login', {
        phone: activeUser.phone,
        password: 'wrong-password',
      });
      expect(response.status).toBe(401);
    }

    const blocked = await request('POST', '/auth/login', {
      phone: activeUser.phone,
      password: 'wrong-password',
    });

    expect(blocked.status).toBe(429);
    await expect(blocked.json()).resolves.toMatchObject({
      error: { code: 'RATE_LIMITED' },
    });
  });

  it('resets the attempt counter after a successful login', async () => {
    mocks.findCredentialsByPhone.mockResolvedValue({
      user: activeUser,
      passwordHash: 'legacy-secret',
    });
    for (let attempt = 0; attempt < 9; attempt += 1) {
      const response = await request('POST', '/auth/login', {
        phone: activeUser.phone,
        password: 'wrong-password',
      });
      expect(response.status).toBe(401);
    }

    mocks.findCredentialsByPhone.mockResolvedValue({
      user: activeUser,
      passwordHash: await hashPassword('correct-password'),
    });
    const success = await request('POST', '/auth/login', {
      phone: activeUser.phone,
      password: 'correct-password',
    });
    expect(success.status).toBe(200);

    mocks.findCredentialsByPhone.mockResolvedValue({
      user: activeUser,
      passwordHash: 'legacy-secret',
    });
    const afterReset = await request('POST', '/auth/login', {
      phone: activeUser.phone,
      password: 'wrong-password',
    });
    expect(afterReset.status).toBe(401);
  });
});

describe('PUT /auth/password', () => {
  const userToken = signToken({ userId: 'u1', role: 'employee', department: 'tech' });

  beforeEach(async () => {
    mocks.findCredentialsById.mockResolvedValue({
      user: activeUser,
      passwordHash: await hashPassword('old-password'),
    });
  });

  it('hashes and stores the new password after verifying the old one', async () => {
    const response = await request(
      'PUT',
      '/auth/password',
      { oldPassword: 'old-password', newPassword: 'new-password' },
      userToken
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ message: '密码修改成功' });

    const update = mocks.query.mock.calls.find(
      ([sql]) => typeof sql === 'string' && sql.includes('UPDATE users SET password_hash')
    );
    expect(update).toBeTruthy();
    const stored = update![1][0];
    expect(stored).not.toBe('new-password');
    await expect(verifyPassword('new-password', stored)).resolves.toMatchObject({ ok: true });
  });

  it('rejects a wrong old password without updating the row', async () => {
    const response = await request(
      'PUT',
      '/auth/password',
      { oldPassword: 'wrong-password', newPassword: 'new-password' },
      userToken
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      error: { message: '原密码错误' },
    });
    expect(mocks.query).not.toHaveBeenCalled();
  });

  it('requires the old password', async () => {
    const response = await request(
      'PUT',
      '/auth/password',
      { newPassword: 'new-password' },
      userToken
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: { message: '原密码不能为空' },
    });
  });

  it('validates the new password length', async () => {
    const response = await request(
      'PUT',
      '/auth/password',
      { oldPassword: 'old-password', newPassword: '123' },
      userToken
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: { message: '密码长度至少6位' },
    });
  });
});

describe('admin user password hashing', () => {
  const adminToken = signToken({ userId: 'admin', role: 'admin', department: 'ops' });

  it('requires and hashes a password when creating a user', async () => {
    mocks.findByPhone.mockResolvedValue(null);
    mocks.query.mockResolvedValue({ rows: [userRow({ id: 'u2', phone: '13900000000' })] });

    const response = await request(
      'POST',
      '/admin/users',
      {
        name: 'New User',
        phone: '13900000000',
        department: 'tech',
        role: 'employee',
        password: 'initial-password',
      },
      adminToken
    );

    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body).not.toHaveProperty('password_hash');
    expect(body).not.toHaveProperty('passwordHash');

    expect(mocks.query).toHaveBeenCalledTimes(1);
    const [sql, params] = mocks.query.mock.calls[0];
    expect(sql).toContain('password_hash');
    expect(params[5]).not.toBe('initial-password');
    await expect(verifyPassword('initial-password', params[5])).resolves.toMatchObject({
      ok: true,
    });
  });

  it('rejects a missing password on create', async () => {
    const response = await request(
      'POST',
      '/admin/users',
      { name: 'New User', phone: '13900000000', department: 'tech', role: 'employee' },
      adminToken
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: { message: '密码不能为空' },
    });
    expect(mocks.query).not.toHaveBeenCalled();
  });

  it('rejects a too-short password on create', async () => {
    const response = await request(
      'POST',
      '/admin/users',
      {
        name: 'New User',
        phone: '13900000000',
        department: 'tech',
        role: 'employee',
        password: '123',
      },
      adminToken
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: { message: '密码长度至少6位' },
    });
  });

  it('hashes a password supplied during an update', async () => {
    mocks.findById.mockResolvedValue(activeUser);
    mocks.query.mockResolvedValue({ rows: [userRow()] });

    const response = await request(
      'PUT',
      '/admin/users/u1',
      { name: 'Renamed User', password: 'reset-password' },
      adminToken
    );

    expect(response.status).toBe(200);
    const update = mocks.query.mock.calls[0];
    expect(update[0]).toContain('password_hash');
    await expect(verifyPassword('reset-password', update[1][1])).resolves.toMatchObject({
      ok: true,
    });
  });

  it('leaves the password untouched when an update omits it', async () => {
    mocks.findById.mockResolvedValue(activeUser);
    mocks.query.mockResolvedValue({ rows: [userRow()] });

    const response = await request(
      'PUT',
      '/admin/users/u1',
      { name: 'Renamed User' },
      adminToken
    );

    expect(response.status).toBe(200);
    const update = mocks.query.mock.calls[0];
    expect(update[0]).not.toContain('password_hash');
  });
});
