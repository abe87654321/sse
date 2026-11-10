import {
  applyAiConfigPatch,
  createDefaultAiConfig,
  normalizeAiConfig,
  resolveSecretForEndpoint,
  toPersistedAiConfig,
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

  it('reports mineruTokenSet from the normalized config instead of env', () => {
    const original = process.env.MINERU_TOKEN;
    try {
      process.env.MINERU_TOKEN = 'env-token';
      const config = createDefaultAiConfig({} as any);
      config.ocrEngine.mineruToken = '';
      expect(toPublicAiConfig(config).ocrEngine.mineruTokenSet).toBe(false);

      config.ocrEngine.mineruToken = 'config-token';
      expect(toPublicAiConfig(config).ocrEngine.mineruTokenSet).toBe(true);
    } finally {
      if (original === undefined) {
        delete process.env.MINERU_TOKEN;
      } else {
        process.env.MINERU_TOKEN = original;
      }
    }
  });

  it('returns a deep copy of catalogs in public config', () => {
    const config = createDefaultAiConfig({} as any);
    config.fillEngine.catalogs['http://localhost:11434'] = {
      fetchedAt: 'now',
      source: 'openai',
      models: [],
    };
    const pub = toPublicAiConfig(config);
    pub.fillEngine.catalogs['http://localhost:11434'].models.push({
      id: 'x',
      name: 'x',
      autoTags: [],
      manualTags: [],
      selected: false,
      metadata: {},
    });
    expect(config.fillEngine.catalogs['http://localhost:11434'].models).toHaveLength(0);
  });

  it('applies patches without overwriting a saved secret with blank input on the same endpoint', () => {
    const config = createDefaultAiConfig({ AI_ENDPOINT: 'http://host:11434' } as any);
    config.fillEngine.apiKey = 'saved';
    const next = applyAiConfigPatch(config, {
      fillEngine: { endpoint: 'http://host:11434', apiKey: '', model: 'm' },
    });
    expect(next.fillEngine.apiKey).toBe('saved');
    expect(next.fillEngine.model).toBe('m');
  });

  it('clears a saved fill secret when the endpoint changes with a blank secret', () => {
    const config = createDefaultAiConfig({ AI_ENDPOINT: 'http://old:11434' } as any);
    config.fillEngine.apiKey = 'SECRET';
    const next = applyAiConfigPatch(config, {
      fillEngine: { endpoint: 'http://new:11434', apiKey: '' },
    });
    expect(next.fillEngine.apiKey).toBe('');
  });

  it('keeps a newly provided secret when the endpoint changes', () => {
    const config = createDefaultAiConfig({ AI_ENDPOINT: 'http://old:11434' } as any);
    config.fillEngine.apiKey = 'SECRET';
    const next = applyAiConfigPatch(config, {
      fillEngine: { endpoint: 'http://new:11434', apiKey: 'NEW' },
    });
    expect(next.fillEngine.apiKey).toBe('NEW');
  });

  it('clears a secret only when asked', () => {
    const config = createDefaultAiConfig({} as any);
    config.fillEngine.apiKey = 'saved';
    const next = applyAiConfigPatch(config, { fillEngine: { clearApiKey: true } });
    expect(next.fillEngine.apiKey).toBe('');
  });

  it('clears saved OCR secrets when their endpoints change without new values', () => {
    const config = createDefaultAiConfig({
      AI_ENDPOINT: 'http://old-vision:11434',
      MINERU_ENDPOINT: 'https://old-mineru',
    } as any);
    config.ocrEngine.mineruToken = 'MINERU_SECRET';
    config.ocrEngine.visionApiKey = 'VISION_SECRET';
    const next = applyAiConfigPatch(config, {
      ocrEngine: {
        mineruEndpoint: 'https://new-mineru',
        visionEndpoint: 'http://new-vision:11434',
      },
    });
    expect(next.ocrEngine.mineruToken).toBe('');
    expect(next.ocrEngine.visionApiKey).toBe('');
  });

  it('keeps newly provided OCR secrets when endpoints change', () => {
    const config = createDefaultAiConfig({
      AI_ENDPOINT: 'http://old-vision:11434',
      MINERU_ENDPOINT: 'https://old-mineru',
    } as any);
    config.ocrEngine.mineruToken = 'MINERU_SECRET';
    config.ocrEngine.visionApiKey = 'VISION_SECRET';
    const next = applyAiConfigPatch(config, {
      ocrEngine: {
        mineruEndpoint: 'https://new-mineru',
        mineruToken: 'NEW_MINERU',
        visionEndpoint: 'http://new-vision:11434',
        visionApiKey: 'NEW_VISION',
      },
    });
    expect(next.ocrEngine.mineruToken).toBe('NEW_MINERU');
    expect(next.ocrEngine.visionApiKey).toBe('NEW_VISION');
  });

  it('clears a saved MinerU token only when asked', () => {
    const config = createDefaultAiConfig({} as any);
    config.ocrEngine.mineruToken = 'saved';
    const next = applyAiConfigPatch(config, { ocrEngine: { clearMineruToken: true } });
    expect(next.ocrEngine.mineruToken).toBe('');
  });

  it('ignores malformed catalogs instead of throwing', () => {
    const config = createDefaultAiConfig({} as any);
    config.fillEngine.catalogs['http://localhost:11434'] = {
      fetchedAt: 'old',
      source: 'openai',
      models: [],
    };
    const before = JSON.parse(JSON.stringify(config.fillEngine.catalogs));
    let next;
    expect(() => {
      next = applyAiConfigPatch(config, { fillEngine: { catalog: {} as any } });
    }).not.toThrow();
    expect(next!.fillEngine.catalogs).toEqual(before);
  });

  it('resolves the active model on load when the saved model is absent', () => {
    const config = normalizeAiConfig({
      fillEngine: {
        endpoint: 'http://host:11434',
        model: 'x',
        catalogs: {
          'http://host:11434': {
            fetchedAt: 'now',
            source: 'openai',
            models: [
              { id: 'a', name: 'a', autoTags: [], manualTags: [], selected: true, metadata: {} },
            ],
          },
        },
      },
    });
    expect(config.fillEngine.model).toBe('a');
  });

  it('clears the active model on load when no catalog entry is selected', () => {
    const config = normalizeAiConfig({
      fillEngine: {
        endpoint: 'http://host:11434',
        model: 'x',
        catalogs: {
          'http://host:11434': {
            fetchedAt: 'now',
            source: 'openai',
            models: [
              { id: 'b', name: 'b', autoTags: [], manualTags: [], selected: false, metadata: {} },
            ],
          },
        },
      },
    });
    expect(config.fillEngine.model).toBe('');
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

describe('mineru token source', () => {
  const env = { MINERU_TOKEN: 'env-token' } as any;

  it('falls back to the environment token when the saved token is empty', () => {
    const config = normalizeAiConfig({ ocrEngine: { mineruToken: '' } }, env);
    expect(config.ocrEngine.mineruToken).toBe('env-token');
    expect(config.ocrEngine.mineruTokenSource).toBe('env');
  });

  it('falls back to the environment token when the saved token key is missing', () => {
    const config = normalizeAiConfig({ ocrEngine: {} }, env);
    expect(config.ocrEngine.mineruToken).toBe('env-token');
    expect(config.ocrEngine.mineruTokenSource).toBe('env');
  });

  it('keeps a saved token and reports it as the source', () => {
    const config = normalizeAiConfig({ ocrEngine: { mineruToken: 'saved-token' } }, env);
    expect(config.ocrEngine.mineruToken).toBe('saved-token');
    expect(config.ocrEngine.mineruTokenSource).toBe('saved');
  });

  it('does not fall back to the environment token after an explicit clear', () => {
    const config = normalizeAiConfig(
      { ocrEngine: { mineruToken: '', mineruTokenCleared: true } },
      env,
    );
    expect(config.ocrEngine.mineruToken).toBe('');
    expect(config.ocrEngine.mineruTokenSource).toBe('none');
  });

  it('reports no source when no token is configured anywhere', () => {
    const config = normalizeAiConfig({ ocrEngine: { mineruToken: '' } }, {} as any);
    expect(config.ocrEngine.mineruToken).toBe('');
    expect(config.ocrEngine.mineruTokenSource).toBe('none');
  });

  it('marks an explicitly cleared token so the environment cannot restore it', () => {
    const config = createDefaultAiConfig(env);
    const next = applyAiConfigPatch(config, { ocrEngine: { clearMineruToken: true } });
    expect(next.ocrEngine.mineruToken).toBe('');
    expect(next.ocrEngine.mineruTokenCleared).toBe(true);
    expect(next.ocrEngine.mineruTokenSource).toBe('none');
  });

  it('records a newly provided token as coming from the saved config', () => {
    const config = createDefaultAiConfig(env);
    const next = applyAiConfigPatch(config, { ocrEngine: { mineruToken: 'new-token' } });
    expect(next.ocrEngine.mineruToken).toBe('new-token');
    expect(next.ocrEngine.mineruTokenCleared).toBe(false);
    expect(next.ocrEngine.mineruTokenSource).toBe('saved');
  });

  it('keeps the environment source when the patch carries no token', () => {
    const config = normalizeAiConfig({ ocrEngine: { mineruToken: '' } }, env);
    const next = applyAiConfigPatch(config, { ocrEngine: { provider: 'mineru' } });
    expect(next.ocrEngine.mineruTokenSource).toBe('env');
    expect(next.ocrEngine.mineruTokenCleared).toBe(false);
  });

  it('marks the token as cleared when the MinerU endpoint changes without a new token', () => {
    const config = createDefaultAiConfig(env);
    config.ocrEngine.mineruToken = 'saved-token';
    const next = applyAiConfigPatch(config, { ocrEngine: { mineruEndpoint: 'https://new-mineru' } });
    expect(next.ocrEngine.mineruToken).toBe('');
    expect(next.ocrEngine.mineruTokenCleared).toBe(true);
    expect(next.ocrEngine.mineruTokenSource).toBe('none');
  });

  it('exposes the token source in the public config', () => {
    const config = normalizeAiConfig({ ocrEngine: { mineruToken: 'saved-token' } }, env);
    expect(toPublicAiConfig(config).ocrEngine.mineruTokenSource).toBe('saved');
  });

  it('switches the token back to the environment channel', () => {
    const config = normalizeAiConfig({ ocrEngine: { mineruToken: 'saved-token' } }, env);
    const next = applyAiConfigPatch(config, { ocrEngine: { useEnvMineruToken: true } }, env);
    expect(next.ocrEngine.mineruToken).toBe('env-token');
    expect(next.ocrEngine.mineruTokenSource).toBe('env');
    expect(next.ocrEngine.mineruTokenCleared).toBe(false);
  });

  it('reports no source when switching to the environment channel without an environment token', () => {
    const config = normalizeAiConfig({ ocrEngine: { mineruToken: 'saved-token' } }, {} as any);
    const next = applyAiConfigPatch(config, { ocrEngine: { useEnvMineruToken: true } }, {} as any);
    expect(next.ocrEngine.mineruToken).toBe('');
    expect(next.ocrEngine.mineruTokenSource).toBe('none');
    expect(next.ocrEngine.mineruTokenCleared).toBe(false);
  });
});

describe('persisted ai config', () => {
  const env = { MINERU_TOKEN: 'env-token' } as any;

  it('does not persist a token that comes from the environment', () => {
    const config = normalizeAiConfig({ ocrEngine: { mineruToken: '' } }, env);
    const persisted = toPersistedAiConfig(config);
    expect(persisted.ocrEngine.mineruToken).toBe('');
    expect(persisted.ocrEngine.mineruTokenCleared).toBe(false);
  });

  it('persists a token that comes from the saved config', () => {
    const config = normalizeAiConfig({ ocrEngine: { mineruToken: 'saved-token' } }, env);
    expect(toPersistedAiConfig(config).ocrEngine.mineruToken).toBe('saved-token');
  });

  it('still resolves the environment token after the config was persisted and reloaded', () => {
    const config = normalizeAiConfig({ ocrEngine: { mineruToken: '' } }, env);
    const reloaded = normalizeAiConfig(toPersistedAiConfig(config), env);
    expect(reloaded.ocrEngine.mineruToken).toBe('env-token');
    expect(reloaded.ocrEngine.mineruTokenSource).toBe('env');
  });
});
