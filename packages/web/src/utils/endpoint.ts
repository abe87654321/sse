const CHAT_SUFFIX = '/chat/completions';

export function normalizeEndpoint(input: string): string {
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
