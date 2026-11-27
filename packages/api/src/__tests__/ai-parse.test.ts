const mockParseFromText = jest.fn();
const mockParseFromImage = jest.fn();
const mockGetSmartFillEngine = jest.fn();
const mockGetSmartFillVisionEngine = jest.fn();

jest.mock('../services/ai-engines', () => ({
  loadAiConfig: jest.fn(),
  createFillProvider: jest.fn(),
  createOCREngine: jest.fn(),
  getSmartFillEngine: () => mockGetSmartFillEngine(),
  getSmartFillVisionEngine: () => mockGetSmartFillVisionEngine(),
}));

import express from 'express';
import type { AddressInfo } from 'net';
import type { Server } from 'http';
import { signToken } from '@sse/auth';
import { aiRoutes } from '../routes/ai';
import { errorHandler } from '../middleware/error';

let url: string;
let server: Server;
const token = signToken({ userId: 'employee-1', role: 'employee', department: 'ops' });

function listen(app: express.Express): Promise<{ url: string; server: Server }> {
  return new Promise((resolve) => {
    const instance = app.listen(0, '127.0.0.1', () => {
      const { port } = instance.address() as AddressInfo;
      resolve({ url: `http://127.0.0.1:${port}`, server: instance });
    });
  });
}

function parse(payload: Record<string, unknown>) {
  return fetch(`${url}/ai/parse`, {
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
  mockParseFromText.mockReset();
  mockParseFromImage.mockReset();
  mockGetSmartFillEngine.mockReset();
  mockGetSmartFillVisionEngine.mockReset();
});

describe('POST /ai/parse', () => {
  it('parses text with the configured smart-fill engine', async () => {
    mockGetSmartFillEngine.mockReturnValue({ parseFromText: mockParseFromText });
    mockParseFromText.mockResolvedValue([
      { categoryName: '交通', amount: 50, expenseDate: '2026-11-27', description: '打车' },
    ]);

    const response = await parse({ text: '打车50元' });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      items: [{ categoryName: '交通', amount: 50 }],
    });
    expect(mockParseFromText).toHaveBeenCalledWith('打车50元');
    expect(mockGetSmartFillVisionEngine).not.toHaveBeenCalled();
  });

  it('parses screenshots with the configurable vision engine instead of the text model', async () => {
    mockGetSmartFillVisionEngine.mockReturnValue({ parseFromImage: mockParseFromImage });
    mockParseFromImage.mockResolvedValue([
      { categoryName: '餐饮', amount: 88, expenseDate: '2026-11-27', description: '午饭' },
    ]);

    const response = await parse({ image: 'data:image/png;base64,QUJD' });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      items: [{ categoryName: '餐饮', amount: 88 }],
    });
    expect(mockParseFromImage).toHaveBeenCalledWith('QUJD');
    expect(mockGetSmartFillEngine).not.toHaveBeenCalled();
  });

  it('returns a clear error when the vision engine is not configured', async () => {
    mockGetSmartFillVisionEngine.mockReturnValue(null);

    const response = await parse({ image: 'data:image/png;base64,QUJD' });

    expect(response.status).toBe(503);
    const payload: any = await response.json();
    expect(payload.error.code).toBe('VISION_AI_DISABLED');
    expect(payload.error.message).toContain('系统管理');
  });

  it('returns a clear error when the text engine is disabled', async () => {
    mockGetSmartFillEngine.mockReturnValue(null);

    const response = await parse({ text: '打车50元' });

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'AI_DISABLED' },
    });
  });
});
