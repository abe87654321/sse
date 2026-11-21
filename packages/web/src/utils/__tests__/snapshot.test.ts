import { describe, expect, it } from 'vitest';
import {
  formatSnapshotTime,
  shortHash,
  snapshotActorLabel,
  snapshotTypeLabel,
} from '../snapshot';

describe('snapshotTypeLabel', () => {
  it('maps known snapshot types to Chinese labels', () => {
    expect(snapshotTypeLabel('submit')).toBe('提交');
    expect(snapshotTypeLabel('approve')).toBe('审批通过');
    expect(snapshotTypeLabel('reject')).toBe('驳回');
    expect(snapshotTypeLabel('pay')).toBe('付款');
    expect(snapshotTypeLabel('backfill')).toBe('历史回填');
  });

  it('falls back to the raw value', () => {
    expect(snapshotTypeLabel('custom')).toBe('custom');
    expect(snapshotTypeLabel(null)).toBe('-');
  });
});

describe('shortHash', () => {
  it('truncates long hashes and preserves short values', () => {
    expect(shortHash('abcdefghijklmnop', 8)).toBe('abcdefgh…');
    expect(shortHash('abc', 8)).toBe('abc');
    expect(shortHash(null)).toBe('-');
  });
});

describe('formatSnapshotTime', () => {
  it('formats valid timestamps and preserves invalid values', () => {
    expect(formatSnapshotTime('2026-11-21T08:05:00Z')).toMatch(
      /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/
    );
    expect(formatSnapshotTime('not-a-date')).toBe('not-a-date');
    expect(formatSnapshotTime(null)).toBe('-');
  });
});

describe('snapshotActorLabel', () => {
  it('prefers role and handles system actors', () => {
    expect(snapshotActorLabel({ actorType: 'system' })).toBe('系统');
    expect(snapshotActorLabel({ actorType: 'user', actorRole: 'finance' })).toBe('finance');
    expect(snapshotActorLabel({ actorType: 'user', actorId: 'u1' })).toBe('u1');
  });
});
