import { appendHistory, sanitizeHistoryEntry } from '../test-history';

describe('test history utils', () => {
  it('truncates raw text and removes secrets', () => {
    const entry: any = {
      id: '1',
      createdAt: '2026-11-02T00:00:00.000Z',
      type: 'ocr',
      success: true,
      elapsedMs: 10,
      rawText: 'x'.repeat(6000),
      apiKey: 'secret',
      token: 'secret',
    };
    const safe = sanitizeHistoryEntry(entry);
    expect(safe.rawText).toHaveLength(5000);
    expect((safe as any).apiKey).toBeUndefined();
    expect((safe as any).token).toBeUndefined();
  });

  it('keeps newest entries first and enforces the limit', () => {
    const entries = Array.from({ length: 55 }, (_, index) => ({
      id: String(index),
      createdAt: '2026-11-02T00:00:00.000Z',
      type: 'fill' as const,
      success: true,
      elapsedMs: 1,
    }));
    const next = appendHistory(entries, {
      id: 'new',
      createdAt: '2026-11-02T00:00:00.000Z',
      type: 'fill',
      success: true,
      elapsedMs: 1,
    });
    expect(next).toHaveLength(50);
    expect(next[0].id).toBe('new');
  });
});
