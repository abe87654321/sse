import { describe, expect, it } from 'vitest';
import {
  formatHistoryTime,
  historyActorLabel,
  historyCauseLabel,
  historyEventLabel,
  historyStatusLabel,
  historySummary,
  itemPreviousStatus,
} from '../verification-history';

describe('verification history labels', () => {
  it('maps event types', () => {
    expect(historyEventLabel('verify')).toBe('核对');
    expect(historyEventLabel('invalidate')).toBe('失效');
    expect(historyEventLabel('backfill')).toBe('历史回填');
    expect(historyEventLabel('custom')).toBe('custom');
    expect(historyEventLabel(null)).toBe('-');
  });

  it('maps causes', () => {
    expect(historyCauseLabel('manual')).toBe('手动核对');
    expect(historyCauseLabel('force_ocr')).toBe('重新识别');
    expect(historyCauseLabel('items_updated')).toBe('明细修改');
    expect(historyCauseLabel('invoice_uploaded')).toBe('换发票');
    expect(historyCauseLabel('receipt_replaced')).toBe('换回单');
    expect(historyCauseLabel('system')).toBe('系统自动');
    expect(historyCauseLabel('backfill')).toBe('历史回填');
  });

  it('maps statuses', () => {
    expect(historyStatusLabel('pass')).toBe('通过');
    expect(historyStatusLabel('warning')).toBe('存在差异');
    expect(historyStatusLabel('unverified')).toBe('未核对');
    expect(historyStatusLabel('error')).toBe('核对失败');
    expect(historyStatusLabel('no_invoices')).toBe('无发票');
    expect(historyStatusLabel('invalidated')).toBe('已失效');
    expect(historyStatusLabel('custom')).toBe('custom');
    expect(historyStatusLabel(null)).toBe('-');
  });
});

describe('historySummary', () => {
  it('prefers the run summary text', () => {
    expect(historySummary({ summary: { summary: '全部通过' } })).toBe('全部通过');
  });

  it('describes invalidation runs', () => {
    expect(
      historySummary({ eventType: 'invalidate', summary: { affected: 2 } })
    ).toBe('2 项旧结果已失效');
  });

  it('falls back to a dash', () => {
    expect(historySummary({ summary: {} })).toBe('-');
  });
});

describe('historyActorLabel', () => {
  it('labels system actors', () => {
    expect(historyActorLabel({ actorType: 'system' })).toBe('系统');
  });

  it('prefers role then id', () => {
    expect(historyActorLabel({ actorType: 'user', actorRole: 'finance' })).toBe('finance');
    expect(historyActorLabel({ actorType: 'user', actorId: 'u1' })).toBe('u1');
    expect(historyActorLabel({})).toBe('-');
  });
});

describe('formatHistoryTime', () => {
  it('formats valid timestamps and preserves invalid values', () => {
    expect(formatHistoryTime('2026-11-21T08:05:00Z')).toMatch(
      /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/
    );
    expect(formatHistoryTime('not-a-date')).toBe('not-a-date');
    expect(formatHistoryTime(null)).toBe('-');
  });
});

describe('itemPreviousStatus', () => {
  it('reads the previous status from invalidation results', () => {
    expect(itemPreviousStatus({ result: { previousStatus: 'pass' } })).toBe('pass');
    expect(itemPreviousStatus({ result: {} })).toBe('-');
  });
});
