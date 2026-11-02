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
});
