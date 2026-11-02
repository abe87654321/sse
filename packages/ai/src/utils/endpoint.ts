const CHAT_SUFFIX = '/chat/completions';

export function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(String(value || '').trim());
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

export function normalizeServiceBase(input: string): string {
  let value = String(input || '').trim().replace(/\/+$/, '');
  if (!value) return '';
  if (value.toLowerCase().endsWith(CHAT_SUFFIX)) {
    value = value.slice(0, -CHAT_SUFFIX.length).replace(/\/+$/, '');
  }
  if (value.toLowerCase().endsWith('/v1')) {
    value = value.slice(0, -3).replace(/\/+$/, '');
  }
  return value;
}

export function deriveApiBase(base: string): string {
  const normalized = normalizeServiceBase(base);
  if (!normalized) return '';
  return `${normalized}/v1`;
}

export function buildModelsUrl(base: string): string {
  const apiBase = deriveApiBase(base);
  return apiBase ? `${apiBase}/models` : '';
}

export function buildChatUrl(base: string): string {
  const apiBase = deriveApiBase(base);
  return apiBase ? `${apiBase}/chat/completions` : '';
}

export function buildOllamaTagsUrl(base: string): string {
  const normalized = normalizeServiceBase(base);
  return normalized ? `${normalized}/api/tags` : '';
}

export function resolveChatUrl(input: string): string {
  const trimmed = String(input || '').trim().replace(/\/+$/, '');
  if (!trimmed) return '';
  if (trimmed.toLowerCase().endsWith(CHAT_SUFFIX)) return trimmed;
  return buildChatUrl(trimmed);
}
