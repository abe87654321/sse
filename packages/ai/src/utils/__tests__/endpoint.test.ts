import {
  buildChatUrl,
  buildModelsUrl,
  buildOllamaTagsUrl,
  deriveApiBase,
  isHttpUrl,
  normalizeServiceBase,
  resolveChatUrl,
} from '../endpoint';

describe('endpoint utils', () => {
  it('normalizes a service root', () => {
    expect(normalizeServiceBase('http://192.168.3.117:11434/')).toBe('http://192.168.3.117:11434');
  });

  it('strips /v1 and /chat/completions from old full URLs', () => {
    expect(normalizeServiceBase('http://192.168.3.117:11434/v1')).toBe('http://192.168.3.117:11434');
    expect(normalizeServiceBase('http://192.168.3.117:11434/v1/chat/completions'))
      .toBe('http://192.168.3.117:11434');
    expect(normalizeServiceBase('https://openrouter.ai/api/v1'))
      .toBe('https://openrouter.ai/api');
  });

  it('derives OpenAI-compatible URLs from a service base', () => {
    expect(deriveApiBase('http://192.168.3.117:11434')).toBe('http://192.168.3.117:11434/v1');
    expect(buildModelsUrl('http://192.168.3.117:11434')).toBe('http://192.168.3.117:11434/v1/models');
    expect(buildChatUrl('http://192.168.3.117:11434')).toBe('http://192.168.3.117:11434/v1/chat/completions');
    expect(buildModelsUrl('https://openrouter.ai/api')).toBe('https://openrouter.ai/api/v1/models');
    expect(buildOllamaTagsUrl('http://192.168.3.117:11434')).toBe('http://192.168.3.117:11434/api/tags');
  });

  it('keeps a full chat URL untouched for LocalProvider compatibility', () => {
    expect(resolveChatUrl('http://host:11434/v1/chat/completions'))
      .toBe('http://host:11434/v1/chat/completions');
    expect(resolveChatUrl('http://host:11434')).toBe('http://host:11434/v1/chat/completions');
  });

  it('validates http and https only', () => {
    expect(isHttpUrl('http://host:11434')).toBe(true);
    expect(isHttpUrl('https://host')).toBe(true);
    expect(isHttpUrl('file:///etc/passwd')).toBe(false);
    expect(isHttpUrl('not a url')).toBe(false);
    expect(isHttpUrl('')).toBe(false);
  });

  it('returns empty strings for empty input', () => {
    expect(normalizeServiceBase('')).toBe('');
    expect(deriveApiBase('')).toBe('');
    expect(buildModelsUrl('')).toBe('');
    expect(buildChatUrl('')).toBe('');
    expect(buildOllamaTagsUrl('')).toBe('');
    expect(resolveChatUrl('')).toBe('');
  });
});
