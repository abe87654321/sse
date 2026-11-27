const mockVisionParse = jest.fn();
const mockGetSmartFillVisionEngine = jest.fn();
const mockLoadAiConfig = jest.fn();
const mockFetchModelList = jest.fn();
const mockTestConnection = jest.fn();
const mockAddHistory = jest.fn();

jest.mock('@sse/db', () => ({
  pool: { query: jest.fn() },
  PgUserRepo: jest.fn().mockImplementation(() => ({})),
  PgApprovalRuleRepo: jest.fn().mockImplementation(() => ({})),
  PgApproverAssignmentRepo: jest.fn().mockImplementation(() => ({})),
  PgDepartmentRepo: jest.fn().mockImplementation(() => ({})),
  ApproverConflictError: class ApproverConflictError extends Error {},
}));

jest.mock('../services/notifications', () => ({ sendNotificationSafe: jest.fn() }));
jest.mock('../services/department-ontology', () => ({ syncDepartmentChange: jest.fn() }));
jest.mock('../routes/ontology-helpers', () => ({ resetEngine: jest.fn() }));
jest.mock('@sse/notifications', () => ({
  welcomeMessage: jest.fn(() => ({ type: 'welcome', title: 'w', body: 'w', channels: [] })),
}));

jest.mock('../services/ai-test-history', () => ({
  addTestHistory: (...args: any[]) => mockAddHistory(...args),
  loadTestHistory: jest.fn(() => []),
  clearTestHistory: jest.fn(),
  newHistoryEntry: (entry: any) => ({ id: 'h1', createdAt: 'now', ...entry }),
}));

jest.mock('../services/ai-engine-probe', () => ({
  fetchModelList: (...args: any[]) => mockFetchModelList(...args),
  testConnection: (...args: any[]) => mockTestConnection(...args),
}));

jest.mock('../services/ai-engines', () => ({
  loadAiConfig: () => mockLoadAiConfig(),
  saveAiConfig: jest.fn(),
  createOCREngine: jest.fn(),
  getSmartFillEngine: jest.fn(),
  getSmartFillVisionEngine: (config: any) => mockGetSmartFillVisionEngine(config),
}));

import express from 'express';
import type { AddressInfo } from 'net';
import type { Server } from 'http';
import { signToken } from '@sse/auth';
import { adminRoutes } from '../routes/admin';
import { errorHandler } from '../middleware/error';

const savedConfig = {
  fillEngine: {
    endpoint: 'http://fill-host:11434',
    apiKey: 'fill-key',
    model: 'fill-model',
    enabled: true,
    catalogs: {},
  },
  visionEngine: {
    endpoint: 'http://vision-host:11434',
    apiKey: 'vision-key',
    model: 'qwen3-vl:8b',
    enabled: true,
    catalogs: {},
  },
  ocrEngine: {},
};

let url: string;
let server: Server;
const adminToken = signToken({ userId: 'admin-1', role: 'admin', department: 'ops' });

function listen(app: express.Express): Promise<{ url: string; server: Server }> {
  return new Promise((resolve) => {
    const instance = app.listen(0, '127.0.0.1', () => {
      const { port } = instance.address() as AddressInfo;
      resolve({ url: `http://127.0.0.1:${port}`, server: instance });
    });
  });
}

function post(path: string, body: Record<string, unknown>) {
  return fetch(`${url}${path}`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${adminToken}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
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
  mockVisionParse.mockReset();
  mockGetSmartFillVisionEngine.mockReset();
  mockLoadAiConfig.mockReset();
  mockFetchModelList.mockReset();
  mockTestConnection.mockReset();
  mockAddHistory.mockReset();
  mockLoadAiConfig.mockReturnValue(savedConfig);
});

describe('POST /admin/ai-test/vision', () => {
  it('tests the configured vision model with the built-in screenshot sample', async () => {
    mockGetSmartFillVisionEngine.mockReturnValue({ parseFromImage: mockVisionParse });
    mockVisionParse.mockResolvedValue([
      { categoryName: '交通', amount: 50, expenseDate: '2026-11-27', description: '打车' },
    ]);

    const response = await post('/admin/ai-test/vision', {
      endpoint: 'http://vision-host:11434',
      model: 'qwen3-vl:8b',
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      items: [{ categoryName: '交通', amount: 50 }],
    });
    expect(mockVisionParse).toHaveBeenCalledTimes(1);
    const image = mockVisionParse.mock.calls[0][0];
    expect(typeof image).toBe('string');
    expect(image.length).toBeGreaterThan(100);
  });

  it('reuses the saved vision secret when the endpoint matches', async () => {
    mockGetSmartFillVisionEngine.mockReturnValue({ parseFromImage: mockVisionParse });
    mockVisionParse.mockResolvedValue([
      { categoryName: '餐饮', amount: 88, expenseDate: '2026-11-27', description: '午饭' },
    ]);

    const response = await post('/admin/ai-test/vision', {
      endpoint: 'http://vision-host:11434',
      model: 'qwen3-vl:8b',
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ success: true });
    expect(mockGetSmartFillVisionEngine.mock.calls[0][0].visionEngine.apiKey).toBe('vision-key');
  });

  it('returns a failure result when the vision engine is not configured', async () => {
    mockGetSmartFillVisionEngine.mockReturnValue(null);

    const response = await post('/admin/ai-test/vision', {
      endpoint: 'http://vision-host:11434',
      model: 'qwen3-vl:8b',
    });

    expect(response.status).toBe(200);
    const payload: any = await response.json();
    expect(payload.success).toBe(false);
    expect(payload.message).toContain('未启用或未配置');
  });
});

describe('POST /admin/ai-models (vision)', () => {
  it('resolves the saved vision secret and stores the catalog for the vision engine', async () => {
    mockFetchModelList.mockResolvedValue({
      models: [{ id: 'qwen3-vl:8b', name: 'qwen3-vl:8b' }],
      source: 'ollama',
      elapsedMs: 12,
    });

    const response = await post('/admin/ai-models', {
      engine: 'vision',
      endpoint: 'http://vision-host:11434',
    });

    expect(response.status).toBe(200);
    expect(mockFetchModelList).toHaveBeenCalledWith({
      endpoint: 'http://vision-host:11434',
      apiKey: 'vision-key',
    });
    const payload: any = await response.json();
    expect(payload.catalog.models[0].id).toBe('qwen3-vl:8b');
  });
});

describe('POST /admin/ai-connection-test (vision)', () => {
  it('resolves the saved vision secret for the connection check', async () => {
    mockTestConnection.mockResolvedValue({
      success: true,
      steps: [{ name: 'models', ok: true, modelCount: 1, elapsedMs: 5 }],
    });

    const response = await post('/admin/ai-connection-test', {
      engine: 'vision',
      endpoint: 'http://vision-host:11434',
      model: 'qwen3-vl:8b',
    });

    expect(response.status).toBe(200);
    expect(mockTestConnection).toHaveBeenCalledWith({
      endpoint: 'http://vision-host:11434',
      apiKey: 'vision-key',
      model: 'qwen3-vl:8b',
    });
  });
});
