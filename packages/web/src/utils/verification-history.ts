const EVENT_TYPE_LABELS: Record<string, string> = {
  verify: '核对',
  invalidate: '失效',
  backfill: '历史回填',
};

const CAUSE_LABELS: Record<string, string> = {
  manual: '手动核对',
  force_ocr: '重新识别',
  items_updated: '明细修改',
  invoice_uploaded: '换发票',
  receipt_replaced: '换回单',
  system: '系统自动',
  backfill: '历史回填',
};

const STATUS_LABELS: Record<string, string> = {
  pass: '通过',
  warning: '存在差异',
  unverified: '未核对',
  error: '核对失败',
  no_invoices: '无发票',
  invalidated: '已失效',
};

export function historyEventLabel(value?: string | null): string {
  if (!value) return '-';
  return EVENT_TYPE_LABELS[value] || value;
}

export function historyCauseLabel(value?: string | null): string {
  if (!value) return '-';
  return CAUSE_LABELS[value] || value;
}

export function historyStatusLabel(value?: string | null): string {
  if (!value) return '-';
  return STATUS_LABELS[value] || value;
}

export function historySummary(run: any): string {
  if (run?.summary?.summary) return run.summary.summary;
  if (run?.eventType === 'invalidate') {
    const affected = Number(run?.summary?.affected || 0);
    return `${affected} 项旧结果已失效`;
  }
  return '-';
}

export function historyActorLabel(run: any): string {
  if (run?.actorType === 'system') return '系统';
  return run?.actorRole || run?.actorId || '-';
}

export function formatHistoryTime(value?: string | null): string {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(
    date.getHours()
  )}:${pad(date.getMinutes())}`;
}

export function itemPreviousStatus(item: any): string {
  return item?.result?.previousStatus || '-';
}
