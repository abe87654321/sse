import type { EngineErrorInfo } from './engine-error';

export type EngineTestType = 'connection' | 'fill' | 'ocr';

export interface EngineTestHistoryEntry {
  id: string;
  createdAt: string;
  type: EngineTestType;
  provider?: string;
  endpoint?: string;
  success: boolean;
  elapsedMs: number;
  fields?: Record<string, any>;
  error?: EngineErrorInfo;
  rawText?: string;
}

export const MAX_HISTORY_ENTRIES = 50;
export const MAX_HISTORY_RAW_TEXT = 5000;
export const MAX_HISTORY_FIELD_TEXT = 2000;

const SENSITIVE_KEY = /api[_-]?key|token|secret|password|authorization|credential|signature/i;

export function truncateText(value: unknown, max: number): string {
  return String(value ?? '').slice(0, max);
}

export function sanitizeEndpoint(endpoint?: string): string | undefined {
  if (!endpoint) return endpoint;
  try {
    const url = new URL(endpoint);
    url.username = '';
    url.password = '';
    url.searchParams.forEach((_value, key) => {
      if (SENSITIVE_KEY.test(key)) {
        url.searchParams.set(key, '[REDACTED]');
      }
    });
    return url.toString();
  } catch {
    return endpoint.replace(/\/\/[^/@]*@/, '//');
  }
}

export function redactValue(value: any, depth = 0): any {
  if (depth > 6) return '[TRUNCATED]';
  if (Array.isArray(value)) {
    return value.map(item => redactValue(item, depth + 1));
  }
  if (value && typeof value === 'object') {
    const result: Record<string, any> = {};
    for (const [key, item] of Object.entries(value)) {
      result[key] = SENSITIVE_KEY.test(key) ? '[REDACTED]' : redactValue(item, depth + 1);
    }
    return result;
  }
  if (typeof value === 'string') {
    return truncateText(value, MAX_HISTORY_FIELD_TEXT);
  }
  return value;
}

export function sanitizeHistoryEntry(entry: EngineTestHistoryEntry): EngineTestHistoryEntry {
  const safe: EngineTestHistoryEntry = {
    id: String(entry?.id ?? ''),
    createdAt: String(entry?.createdAt ?? ''),
    type: entry?.type,
    success: Boolean(entry?.success),
    elapsedMs: Number(entry?.elapsedMs) || 0,
  };

  if (entry?.provider != null) {
    safe.provider = String(entry.provider);
  }
  if (entry?.endpoint != null) {
    const endpoint = sanitizeEndpoint(String(entry.endpoint));
    if (endpoint !== undefined) {
      safe.endpoint = endpoint;
    }
  }
  if (entry?.fields != null) {
    safe.fields = redactValue(entry.fields);
  }
  if (entry?.error) {
    const error: EngineErrorInfo = {
      code: entry.error.code,
      message: truncateText(entry.error.message, MAX_HISTORY_FIELD_TEXT),
      suggestion: truncateText(entry.error.suggestion, MAX_HISTORY_FIELD_TEXT),
    };
    if (entry.error.status !== undefined) {
      error.status = entry.error.status;
    }
    safe.error = error;
  }
  if (entry?.rawText != null) {
    safe.rawText = truncateText(entry.rawText, MAX_HISTORY_RAW_TEXT);
  }

  return safe;
}

export function appendHistory(
  entries: EngineTestHistoryEntry[],
  entry: EngineTestHistoryEntry,
  limit = MAX_HISTORY_ENTRIES,
): EngineTestHistoryEntry[] {
  const safeLimit = Math.max(0, Math.min(Math.floor(limit), MAX_HISTORY_ENTRIES));
  return [sanitizeHistoryEntry(entry), ...entries.map(sanitizeHistoryEntry)].slice(0, safeLimit);
}
