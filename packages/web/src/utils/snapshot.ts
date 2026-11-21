export const SNAPSHOT_TYPE_LABELS: Record<string, string> = {
  submit: '提交',
  approve: '审批通过',
  reject: '驳回',
  pay: '付款',
  backfill: '历史回填',
};

export function snapshotTypeLabel(type?: string | null): string {
  if (!type) return '-';
  return SNAPSHOT_TYPE_LABELS[type] || type;
}

export function shortHash(hash?: string | null, length = 12): string {
  if (!hash) return '-';
  return hash.length <= length ? hash : `${hash.slice(0, length)}…`;
}

export function formatSnapshotTime(value?: string | null): string {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(
    date.getHours()
  )}:${pad(date.getMinutes())}`;
}

export function snapshotActorLabel(snapshot: {
  actorType?: string;
  actorRole?: string;
  actorId?: string | null;
}): string {
  if (snapshot.actorType === 'system') return '系统';
  return snapshot.actorRole || snapshot.actorId || '-';
}
