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
      authorization: 'Bearer secret',
      api_key: 'secret',
    };
    const safe = sanitizeHistoryEntry(entry);
    expect(safe.rawText).toHaveLength(5000);
    expect((safe as any).apiKey).toBeUndefined();
    expect((safe as any).token).toBeUndefined();
    expect((safe as any).authorization).toBeUndefined();
    expect((safe as any).api_key).toBeUndefined();
  });

  it('redacts nested secret fields while preserving safe values', () => {
    const safe = sanitizeHistoryEntry({
      id: '1',
      createdAt: '2026-11-02T00:00:00.000Z',
      type: 'fill',
      success: true,
      elapsedMs: 5,
      fields: {
        apiKey: 'x',
        nested: { token: 'y', ok: 1 },
      },
    });
    expect((safe.fields as any).apiKey).toBe('[REDACTED]');
    expect((safe.fields as any).nested.token).toBe('[REDACTED]');
    expect((safe.fields as any).nested.ok).toBe(1);
  });

  it('strips endpoint credentials and redacts sensitive query params', () => {
    const safe = sanitizeHistoryEntry({
      id: '1',
      createdAt: '2026-11-02T00:00:00.000Z',
      type: 'connection',
      success: true,
      elapsedMs: 5,
      endpoint: 'https://user:pass@host/v1?token=secret&x=1',
    });
    const url = new URL(safe.endpoint as string);
    expect(url.username).toBe('');
    expect(url.password).toBe('');
    expect(url.searchParams.get('token')).toBe('[REDACTED]');
    expect(url.searchParams.get('x')).toBe('1');
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

  it('sanitizes existing entries when appending', () => {
    const existing: any = {
      id: 'old',
      createdAt: '2026-11-02T00:00:00.000Z',
      type: 'ocr',
      success: true,
      elapsedMs: 1,
      rawText: 'x'.repeat(6000),
      apiKey: 'secret',
    };
    const next = appendHistory([existing], {
      id: 'new',
      createdAt: '2026-11-02T00:00:00.000Z',
      type: 'fill',
      success: true,
      elapsedMs: 1,
    });
    expect(next[1].rawText).toHaveLength(5000);
    expect((next[1] as any).apiKey).toBeUndefined();
  });

  it('does not mutate the original entry', () => {
    const original: any = {
      id: 'old',
      createdAt: '2026-11-02T00:00:00.000Z',
      type: 'ocr',
      success: true,
      elapsedMs: 1,
      rawText: 'x'.repeat(6000),
      apiKey: 'secret',
      fields: { apiKey: 'nested' },
    };
    sanitizeHistoryEntry(original);
    expect(original.apiKey).toBe('secret');
    expect(original.fields.apiKey).toBe('nested');
    expect(original.rawText).toHaveLength(6000);
  });
});
