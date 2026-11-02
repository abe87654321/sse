import { LocalProvider } from '../local-provider';

describe('LocalProvider', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
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
});
