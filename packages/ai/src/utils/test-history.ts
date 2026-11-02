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

export function sanitizeHistoryEntry(entry: EngineTestHistoryEntry): EngineTestHistoryEntry {
  const {
    apiKey,
    token,
    mineruToken,
    visionApiKey,
    ...rest
  } = entry as any;
  const safe = JSON.parse(JSON.stringify(rest)) as EngineTestHistoryEntry;
  if (safe.rawText) {
    safe.rawText = safe.rawText.slice(0, MAX_HISTORY_RAW_TEXT);
  }
  return safe;
}

export function appendHistory(
  entries: EngineTestHistoryEntry[],
  entry: EngineTestHistoryEntry,
  limit = MAX_HISTORY_ENTRIES,
): EngineTestHistoryEntry[] {
  return [sanitizeHistoryEntry(entry), ...entries].slice(0, limit);
}
