import { fetchModelList, testConnection } from '../ai-engine-probe';

const originalFetch = global.fetch;

function response(body: any, status = 200) {
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: { get: () => null },
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  } as any;
}

let fetchMock: jest.Mock;

beforeEach(() => {
  fetchMock = jest.fn();
  (global as any).fetch = fetchMock;
});

afterEach(() => {
  global.fetch = originalFetch;
  jest.restoreAllMocks();
});

describe('fetchModelList', () => {
  it('reads an OpenAI model list and sends the API key', async () => {
    fetchMock.mockResolvedValueOnce(response({ data: [{ id: 'gpt-x', owned_by: 'acme' }] }));

    const result = await fetchModelList({ endpoint: 'http://host:11434', apiKey: 'secret' });

    expect(fetchMock.mock.calls[0][0]).toBe('http://host:11434/v1/models');
    expect((fetchMock.mock.calls[0][1] as any).headers.Authorization).toBe('Bearer secret');
    expect(result.source).toBe('openai');
    expect(result.models[0].id).toBe('gpt-x');
  });

  it('falls back to Ollama tags on 404', async () => {
    fetchMock
      .mockResolvedValueOnce(response('not found', 404))
      .mockResolvedValueOnce(response({ models: [{ name: 'llama3' }] }));

    const result = await fetchModelList({ endpoint: 'http://host:11434' });

    expect(fetchMock.mock.calls[0][0]).toBe('http://host:11434/v1/models');
    expect(fetchMock.mock.calls[1][0]).toBe('http://host:11434/api/tags');
    expect(result.source).toBe('ollama');
    expect(result.models[0].id).toBe('llama3');
  });

  it('falls back to Ollama tags when a 200 body is not JSON', async () => {
    fetchMock
      .mockResolvedValueOnce(response('plain text', 200))
      .mockResolvedValueOnce(response({ models: [{ name: 'm' }] }));

    const result = await fetchModelList({ endpoint: 'http://host:11434' });

    expect(fetchMock.mock.calls[1][0]).toBe('http://host:11434/api/tags');
    expect(result.source).toBe('ollama');
    expect(result.models[0].id).toBe('m');
  });

  it('rejects a redirect', async () => {
    fetchMock.mockResolvedValueOnce(response('', 302));

    await expect(fetchModelList({ endpoint: 'http://host:11434' })).rejects.toThrow(/302/);
  });
});

describe('testConnection', () => {
  it('passes when models and chat both succeed', async () => {
    fetchMock
      .mockResolvedValueOnce(response({ data: [{ id: 'm1' }] }))
      .mockResolvedValueOnce(response({ ok: true }));

    const result = await testConnection({ endpoint: 'http://host:11434', model: 'm1' });

    expect(result.success).toBe(true);
    expect(result.steps.map(step => step.name)).toEqual(['models', 'chat']);
    expect(result.steps[0].ok).toBe(true);
    expect(result.steps[1].ok).toBe(true);
    expect(result.steps[1].model).toBe('m1');
  });

  it('fails with NO_RESULT when no models are returned', async () => {
    fetchMock.mockResolvedValueOnce(response({ data: [] }));

    const result = await testConnection({ endpoint: 'http://host:11434' });

    expect(result.success).toBe(false);
    expect(result.steps.find(step => step.name === 'chat')?.error?.code).toBe('NO_RESULT');
  });

  it('reports ADDRESS on a connection refusal', async () => {
    const error: any = new Error('connect failed');
    error.cause = { code: 'ECONNREFUSED' };
    fetchMock.mockRejectedValueOnce(error);

    const result = await testConnection({ endpoint: 'http://host:11434' });

    expect(result.success).toBe(false);
    expect(result.steps[0].name).toBe('models');
    expect(result.steps[0].error?.code).toBe('ADDRESS');
  });
});
