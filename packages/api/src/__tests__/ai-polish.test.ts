const mockAnalyzeText = jest.fn();
const mockCreateFillProvider = jest.fn();
const mockLoadAiConfig = jest.fn();

jest.mock('../services/ai-engines', () => ({
  loadAiConfig: () => mockLoadAiConfig(),
  createFillProvider: (config: any) => mockCreateFillProvider(config),
  createOCREngine: jest.fn(),
  getSmartFillEngine: jest.fn(),
}));

import express from 'express';
import type { AddressInfo } from 'net';
import type { Server } from 'http';
import { signToken } from '@sse/auth';
import { aiRoutes } from '../routes/ai';
import { errorHandler } from '../middleware/error';

let url: string;
let server: Server;
const token = signToken({ userId: 'admin-1', role: 'admin', department: 'ops' });

const savedConfig = {
  fillEngine: {
    endpoint: 'http://configured-model.local:11434',
    apiKey: 'saved-key',
    model: 'admin-selected-model',
    enabled: true,
    catalogs: {},
  },
  ocrEngine: {},
};

function listen(app: express.Express): Promise<{ url: string; server: Server }> {
  return new Promise((resolve) => {
    const instance = app.listen(0, '127.0.0.1', () => {
      const { port } = instance.address() as AddressInfo;
      resolve({ url: `http://127.0.0.1:${port}`, server: instance });
    });
  });
}

function polish(payload: Record<string, unknown>) {
  return fetch(`${url}/ai/polish`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
}

beforeAll(async () => {
  jest.spyOn(console, 'error').mockImplementation(() => {});
  const app = express();
  app.use(express.json());
  app.use('/ai', aiRoutes);
  app.use(errorHandler);
  ({ url, server } = await listen(app));
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  (console.error as jest.Mock).mockRestore();
});

beforeEach(() => {
  mockAnalyzeText.mockReset();
  mockCreateFillProvider.mockReset();
  mockLoadAiConfig.mockReset();
  mockLoadAiConfig.mockReturnValue(savedConfig);
  mockCreateFillProvider.mockReturnValue({ analyzeText: mockAnalyzeText });
});

describe('POST /ai/polish', () => {
  it('uses the AI model saved in system management and forwards the polish requirements', async () => {
    mockAnalyzeText.mockResolvedValue('```\n润色后：这是润色后的正文\n```');

    const response = await polish({
      body: '这是一段原始正文',
      instruction: '更正式一些',
      previous: '上一版润色',
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      polished_body: '这是润色后的正文',
      model: 'admin-selected-model',
    });

    expect(mockCreateFillProvider).toHaveBeenCalledWith(
      expect.objectContaining({
        fillEngine: expect.objectContaining({
          endpoint: 'http://configured-model.local:11434',
          apiKey: 'saved-key',
          model: 'admin-selected-model',
        }),
      })
    );
    expect(mockAnalyzeText).toHaveBeenCalledTimes(1);
    const [text, prompt] = mockAnalyzeText.mock.calls[0];
    expect(text).toBe('这是一段原始正文');
    expect(prompt).toContain('更正式一些');
    expect(prompt).toContain('上一版润色');
  });

  it('rejects a request when the configured engine is disabled', async () => {
    mockLoadAiConfig.mockReturnValue({
      ...savedConfig,
      fillEngine: { ...savedConfig.fillEngine, enabled: false },
    });

    const response = await polish({ body: '正文' });

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'AI_DISABLED' },
    });
    expect(mockCreateFillProvider).not.toHaveBeenCalled();
  });

  it('rejects a request when no model has been configured', async () => {
    mockLoadAiConfig.mockReturnValue({
      ...savedConfig,
      fillEngine: { ...savedConfig.fillEngine, model: '' },
    });

    const response = await polish({ body: '正文' });

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'AI_NOT_CONFIGURED' },
    });
  });

  it('surfaces the provider failure instead of a generic 500', async () => {
    mockAnalyzeText.mockRejectedValue(new Error('connect ECONNREFUSED 10.0.0.2:11434'));

    const response = await polish({ body: '正文' });

    expect(response.status).toBe(502);
    const payload: any = await response.json();
    expect(payload.error.code).toBe('AI_FAILED');
    expect(payload.error.message).toContain('ECONNREFUSED');
  });

  it('requires a non-empty body', async () => {
    const response = await polish({ body: '   ' });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'INVALID_PARAMS' },
    });
  });
});
