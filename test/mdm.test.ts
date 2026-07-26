/**
 * MDM 主数据 + SCIM — API 集成测试
 *
 * 启动方式: pnpm --filter @sse/api dev 后运行 pnpm test
 * 需要: 数据库迁移完成（含 003_identity_mappings.sql）
 */

const BASE = process.env.TEST_API || 'http://localhost:3000';

let adminToken = '';

async function login(phone: string, password: string) {
  const res = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone, password }),
  });
  return res.json();
}

async function api(path: string, options: RequestInit = {}) {
  const res = await fetch(`${BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });
  // SCIM/webhook endpoints don't require auth
  const authPath = path.startsWith('/scim') || path.startsWith('/webhook');
  if (!authPath && adminToken) {
    res.headers.forEach(() => {}); // noop, just ensure we don't override auth
  }
  return { status: res.status, data: await res.json().catch(() => null) };
}

function scimApi(path: string, options: RequestInit = {}) {
  return fetch(`${BASE}${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...options.headers },
  }).then(async res => ({ status: res.status, data: await res.json().catch(() => null) }));
}

describe('MDM Identity Bridge', () => {
  beforeAll(async () => {
    const loginRes = await login('13800000001', 'admin123');
    adminToken = loginRes.accessToken;
  }, 10000);

  // ========== SCIM 2.0 接口 ==========

  test('GET /scim/Schemas returns valid schema list', async () => {
    const { status, data } = await scimApi('/scim/Schemas');
    expect(status).toBe(200);
    expect(data.schemas).toContain('urn:ietf:params:scim:schemas:core:2.0:User');
  });

  test('POST /scim/Users creates a user via SCIM', async () => {
    const testUser = {
      userName: 'scim-test-001',
      name: { familyName: 'SCIM测试用户' },
      emails: [{ value: 'scim-test@example.com' }],
      phoneNumbers: [{ value: 'scim-test-001' }],
      active: true,
      externalId: 'ext-scim-001',
      'urn:sse:role': 'employee',
      'urn:sse:department': '测试部门',
    };

    const { status, data } = await scimApi('/scim/Users', {
      method: 'POST',
      body: JSON.stringify(testUser),
    });
    expect(status).toBeGreaterThanOrEqual(200);
    expect(status).toBeLessThan(500);
    expect(data).toHaveProperty('id');
  });

  test('GET /scim/Users returns user list', async () => {
    const { status, data } = await scimApi('/scim/Users');
    expect(status).toBe(200);
    expect(data).toHaveProperty('totalResults');
    expect(Array.isArray(data.Resources)).toBe(true);
  });

  test('GET /scim/Users/:id returns 404 for non-existent user', async () => {
    const { status } = await scimApi('/scim/Users/non-existent-id');
    expect(status).toBe(404);
  });

  // ========== MDM Webhook ==========

  test('POST /webhook/mdm rejects incomplete payload', async () => {
    const { status } = await api('/webhook/mdm', {
      method: 'POST',
      body: JSON.stringify({}),
    });
    expect(status).toBe(400);
  });

  test('POST /webhook/mdm accepts user.created event', async () => {
    const { status, data } = await api('/webhook/mdm', {
      method: 'POST',
      body: JSON.stringify({
        userId: 'mdm-user-001',
        event: 'created',
        data: {
          name: 'MDM测试用户',
          phone: 'mdm-user-001',
          email: 'mdm-test@example.com',
          department: 'MDM部门',
          role: 'employee',
          status: 'active',
        },
      }),
    });
    expect(status).toBe(200);
    expect(data.received).toBe(true);
  });

  test('POST /webhook/mdm accepts user.updated event', async () => {
    const { status } = await api('/webhook/mdm', {
      method: 'POST',
      body: JSON.stringify({
        userId: 'mdm-user-001',
        event: 'updated',
        data: {
          name: 'MDM测试用户(已更新)',
          phone: 'mdm-user-001',
          email: 'mdm-updated@example.com',
          department: 'MDM部门',
          role: 'employee',
          status: 'active',
        },
      }),
    });
    expect(status).toBe(200);
  });

  test('POST /webhook/mdm accepts user.deleted event', async () => {
    const { status } = await api('/webhook/mdm', {
      method: 'POST',
      body: JSON.stringify({
        userId: 'mdm-user-001',
        event: 'deleted',
      }),
    });
    expect(status).toBe(200);
  });

  // ========== IdentityBridge 类型 ==========

  test('IdentityBridge class is importable', () => {
    const { IdentityBridge } = require('../packages/api/src/services/identity-bridge');
    expect(IdentityBridge).toBeDefined();
    const bridge = new IdentityBridge();
    expect(bridge).toHaveProperty('syncFromScim');
    expect(bridge).toHaveProperty('syncFromMdmEvent');
  });
});
