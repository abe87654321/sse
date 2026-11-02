import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import {
  appendHistory,
  sanitizeHistoryEntry,
  type EngineTestHistoryEntry,
} from '@sse/ai';

export const AI_TEST_HISTORY_PATH = join(process.cwd(), 'ai-test-history.json');

export function loadTestHistory(): EngineTestHistoryEntry[] {
  try {
    if (!existsSync(AI_TEST_HISTORY_PATH)) return [];
    const parsed = JSON.parse(readFileSync(AI_TEST_HISTORY_PATH, 'utf-8'));
    return Array.isArray(parsed) ? parsed.map(sanitizeHistoryEntry) : [];
  } catch {
    return [];
  }
}

export function addTestHistory(entry: EngineTestHistoryEntry): EngineTestHistoryEntry[] {
  const next = appendHistory(loadTestHistory(), entry);
  writeFileSync(AI_TEST_HISTORY_PATH, JSON.stringify(next, null, 2), {
    encoding: 'utf-8',
    mode: 0o600,
  });
  return next;
}

export function clearTestHistory(): void {
  writeFileSync(AI_TEST_HISTORY_PATH, '[]', { encoding: 'utf-8', mode: 0o600 });
}

export function newHistoryEntry(
  entry: Omit<EngineTestHistoryEntry, 'id' | 'createdAt'>,
): EngineTestHistoryEntry {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    createdAt: new Date().toISOString(),
    ...entry,
  };
}
