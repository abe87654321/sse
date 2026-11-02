import { MinerUProvider } from '../mineru-provider';

describe('MinerUProvider', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('reports invalid or expired credentials with an actionable message', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 401 }) as any;

    const provider = new MinerUProvider({
      endpoint: 'https://mineru.net',
      apiKey: 'expired-token',
    });

    await expect(provider.parseInvoice(Buffer.from('pdf'), 'invoice.pdf'))
      .rejects.toThrow(/认证失败/);
  });

  it('reports auth failure when MinerU returns token error codes in a 200 response', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ code: 'A0202', msg: 'token error' }),
    }) as any;

    const provider = new MinerUProvider({
      endpoint: 'https://mineru.net',
      apiKey: 'expired-token',
    });

    await expect(provider.parseInvoice(Buffer.from('pdf'), 'invoice.pdf'))
      .rejects.toThrow(/认证失败/);
  });

  it('accepts an endpoint that already includes the /api/v4 prefix', async () => {
    const fetchMock = jest.fn().mockResolvedValue({ ok: false, status: 401 });
    global.fetch = fetchMock as any;

    const provider = new MinerUProvider({
      endpoint: 'https://mineru.net/api/v4',
      apiKey: 'token-123',
    });

    await expect(provider.parseInvoice(Buffer.from('pdf'), 'invoice.pdf')).rejects.toThrow();

    const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://mineru.net/api/v4/file-urls/batch');
  });

  it('sends the configured token with surrounding whitespace removed', async () => {
    const fetchMock = jest.fn().mockResolvedValue({ ok: false, status: 401 });
    global.fetch = fetchMock as any;

    const provider = new MinerUProvider({
      endpoint: 'https://mineru.net',
      apiKey: '  token-123  ',
    });

    await expect(provider.parseInvoice(Buffer.from('pdf'), 'invoice.pdf')).rejects.toThrow();

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.headers).toMatchObject({ Authorization: 'Bearer token-123' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does not fall back to an environment token when no apiKey is provided', async () => {
    const originalToken = process.env.MINERU_TOKEN;
    process.env.MINERU_TOKEN = 'env-token';
    try {
      const provider = new MinerUProvider({ endpoint: 'https://mineru.net' });
      await expect(provider.parseInvoice(Buffer.from('pdf'), 'invoice.pdf'))
        .rejects.toThrow(/未配置/);
    } finally {
      if (originalToken === undefined) delete process.env.MINERU_TOKEN;
      else process.env.MINERU_TOKEN = originalToken;
    }
  });
});
