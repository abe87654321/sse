import {
  applyAiConfigPatch,
  createDefaultAiConfig,
  normalizeAiConfig,
  resolveSecretForEndpoint,
  toPublicAiConfig,
} from '../ai-config';

describe('ai config', () => {
  it('normalizes old full endpoints and keeps secrets', () => {
    const config = normalizeAiConfig({
      fillEngine: {
        endpoint: 'http://host:11434/v1/chat/completions',
        apiKey: 'k',
        model: 'qwen2.5:7b',
      },
      ocrEngine: {
        mineruEndpoint: 'https://mineru.net/',
        mineruToken: 't',
        visionEndpoint: 'http://host:11434/v1/chat/completions',
        visionApiKey: 'v',
      },
    });
    expect(config.fillEngine.endpoint).toBe('http://host:11434');
    expect(config.ocrEngine.visionEndpoint).toBe('http://host:11434');
    expect(config.fillEngine.apiKey).toBe('k');
    expect(config.ocrEngine.mineruToken).toBe('t');
    expect(config.ocrEngine.visionApiKey).toBe('v');
  });

  it('masks secrets in public config and exposes catalogs', () => {
    const config = createDefaultAiConfig({ AI_ENDPOINT: 'http://host:11434' } as any);
    config.fillEngine.apiKey = 'secret';
    config.fillEngine.catalogs['http://host:11434'] = {
      fetchedAt: '2026-11-02T00:00:00.000Z',
      source: 'openai',
      models: [],
    };
    const pub = toPublicAiConfig(config);
    expect(pub.fillEngine.apiKey).toBe('');
    expect(pub.fillEngine.apiKeySet).toBe(true);
    expect(pub.fillEngine.catalogs['http://host:11434']).toBeDefined();
    expect(pub.ocrEngine.mineruToken).toBe('');
    expect(pub.ocrEngine.visionApiKey).toBe('');
  });

  it('applies patches without overwriting a saved secret with blank input', () => {
    const config = createDefaultAiConfig({} as any);
    config.fillEngine.apiKey = 'saved';
    const next = applyAiConfigPatch(config, {
      fillEngine: { endpoint: 'http://host:11434', apiKey: '', model: 'm' },
    });
    expect(next.fillEngine.apiKey).toBe('saved');
    expect(next.fillEngine.model).toBe('m');
  });

  it('clears a secret only when asked', () => {
    const config = createDefaultAiConfig({} as any);
    config.fillEngine.apiKey = 'saved';
    const next = applyAiConfigPatch(config, { fillEngine: { clearApiKey: true } });
    expect(next.fillEngine.apiKey).toBe('');
  });

  it('reuses a saved secret only for the same endpoint', () => {
    expect(resolveSecretForEndpoint('http://host:11434', '', 'http://host:11434', 'saved'))
      .toBe('saved');
    expect(resolveSecretForEndpoint('http://other:11434', '', 'http://host:11434', 'saved'))
      .toBe('');
    expect(resolveSecretForEndpoint('http://other:11434', 'new', 'http://host:11434', 'saved'))
      .toBe('new');
  });
});
