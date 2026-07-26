/**
 * 本体语义引擎 — API 集成测试
 *
 * 启动方式: pnpm --filter @sse/api dev 后运行 pnpm test
 * 需要: 数据库迁移完成、Ollama 模型可用（或使用 mock）
 */

const BASE = process.env.TEST_API || 'http://localhost:3000';

let adminToken = '';
let adminId = '';

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
      'Authorization': `Bearer ${adminToken}`,
      ...options.headers,
    },
  });
  return { status: res.status, data: await res.json().catch(() => null) };
}

describe('Ontology Engine', () => {
  beforeAll(async () => {
    const loginRes = await login('13800000001', 'admin123');
    adminToken = loginRes.accessToken;
    adminId = loginRes.user?.id;
  }, 10000);

  // ========== 本体同步 ==========

  test('GET /ontology/sync returns ok', async () => {
    const { status, data } = await api('/ontology/sync');
    expect(status).toBe(200);
    expect(data.message).toContain('同步完成');
  });

  // ========== 本体查询 ==========

  test('GET /ontology/query?type=Report returns array', async () => {
    const { status, data } = await api('/ontology/query?type=Report');
    expect(status).toBe(200);
    expect(Array.isArray(data)).toBe(true);
  });

  test('GET /ontology/query?type=Person returns array', async () => {
    const { status, data } = await api('/ontology/query?type=Person');
    expect(status).toBe(200);
    expect(Array.isArray(data)).toBe(true);
  });

  test('GET /ontology/query without type returns 400', async () => {
    const { status } = await api('/ontology/query');
    expect(status).toBe(400);
  });

  // ========== 自然语言创建报销 ==========

  test('POST /ontology/submit-from-text rejects empty text', async () => {
    const { status } = await api('/ontology/submit-from-text', {
      method: 'POST',
      body: JSON.stringify({ text: '' }),
    });
    expect(status).toBe(400);
  });

  test('POST /ontology/submit-from-text with valid text returns structured result', async () => {
    const { status, data } = await api('/ontology/submit-from-text', {
      method: 'POST',
      body: JSON.stringify({ text: '出差住宿费600元' }),
    });
    // 可能成功（LLM 提取到实体）或返回错误（如用户不存在、类别不匹配）
    expect(status).toBeGreaterThanOrEqual(200);
    expect(status).toBeLessThan(500);
    expect(data).toHaveProperty('success');
    // 无论成败，都应该有 notified 字段
    expect(data).toHaveProperty('notified');
  }, 30000);

  // ========== 实体提取（类型测试） ==========

  test('OntologyEngine types are importable', () => {
    const types = require('@sse/ontology');
    expect(types.OwlStore).toBeDefined();
    expect(types.SemanticMapper).toBeDefined();
    expect(types.EntityExtractor).toBeDefined();
    expect(types.ActionReasoner).toBeDefined();
    expect(types.ActionExecutor).toBeDefined();
    expect(types.NlpGenerator).toBeDefined();
    expect(types.OntologyEngine).toBeDefined();
  });
});
