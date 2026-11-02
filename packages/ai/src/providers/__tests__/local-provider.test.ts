import { LocalProvider } from '../local-provider';

describe('LocalProvider', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('turns an aborted request into an actionable timeout message', async () => {
    const abortError = new Error('aborted');
    abortError.name = 'AbortError';
    global.fetch = jest.fn().mockRejectedValue(abortError) as any;

    const provider = new LocalProvider({
      endpoint: 'http://192.168.3.117:11434/v1/chat/completions',
      modelName: 'glm4.7-flash',
      timeoutMs: 1000,
    });

    await expect(provider.analyzeText('测试：打车50元', 'extract'))
      .rejects.toThrow(/超时/);
  });

  it('accepts a service root and appends /v1/chat/completions', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: 'ok' } }] }),
    }) as any;

    const provider = new LocalProvider({
      endpoint: 'http://192.168.3.117:11434',
      modelName: 'qwen2.5:7b',
    });

    await provider.analyzeText('hello', 'prompt');

    expect(global.fetch).toHaveBeenCalledWith(
      'http://192.168.3.117:11434/v1/chat/completions',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('sends a bearer token when apiKey is configured', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: 'ok' } }] }),
    }) as any;

    const provider = new LocalProvider({
      endpoint: 'https://api.example.com',
      modelName: 'demo',
      apiKey: 'secret',
    });

    await provider.analyzeText('hello', 'prompt');

    expect(global.fetch).toHaveBeenCalledWith(
      'https://api.example.com/v1/chat/completions',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer secret' }),
      }),
    );
  });
});
