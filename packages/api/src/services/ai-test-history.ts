import { readFileSync, renameSync, writeFileSync } from 'fs';
import { join } from 'path';
import { randomUUID } from 'crypto';
import {
  appendHistory,
  sanitizeHistoryEntry,
  MAX_HISTORY_ENTRIES,
  type EngineTestHistoryEntry,
} from '@sse/ai';

export const AI_TEST_HISTORY_PATH = join(process.cwd(), 'ai-test-history.json');
const VALID_TYPES = new Set(['connection', 'fill', 'ocr']);

function writeHistoryFile(entries: EngineTestHistoryEntry[]): void {
  const tempPath = `${AI_TEST_HISTORY_PATH}.tmp`;
  writeFileSync(tempPath, JSON.stringify(entries, null, 2), {
    encoding: 'utf-8',
    mode: 0o600,
  });
  renameSync(tempPath, AI_TEST_HISTORY_PATH);
}

export function loadTestHistory(): EngineTestHistoryEntry[] {
  try {
    const parsed = JSON.parse(readFileSync(AI_TEST_HISTORY_PATH, 'utf-8'));
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(entry => entry && VALID_TYPES.has(entry.type))
      .slice(0, MAX_HISTORY_ENTRIES)
      .map(sanitizeHistoryEntry);
  } catch (error: any) {
    if (error?.code !== 'ENOENT') {
      console.warn('[AI test history] 读取失败:', error?.message || error);
    }
    return [];
  }
}

export function addTestHistory(entry: EngineTestHistoryEntry): EngineTestHistoryEntry[] {
  const next = appendHistory(loadTestHistory(), entry);
  try {
    writeHistoryFile(next);
  } catch (error: any) {
    console.warn('[AI test history] 写入失败:', error?.message || error);
  }
  return next;
}

export function clearTestHistory(): void {
  try {
    writeHistoryFile([]);
  } catch (error: any) {
    console.warn('[AI test history] 清空失败:', error?.message || error);
  }
}

export function newHistoryEntry(
  entry: Omit<EngineTestHistoryEntry, 'id' | 'createdAt'>,
): EngineTestHistoryEntry {
  return {
    id: randomUUID(),
    createdAt: new Date().toISOString(),
    ...entry,
  };
}
