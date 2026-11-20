export type IdentityAuditOutcome = 'success' | 'rejected' | 'error';

export interface IdentityAuditEvent {
  source: string;
  action: string;
  outcome: IdentityAuditOutcome;
  externalId?: string;
  localUserId?: string;
  role?: string;
  reason?: string;
  ip?: string;
}

export function auditIdentityEvent(event: IdentityAuditEvent): void {
  console.error(
    `[identity-audit] ${JSON.stringify({
      ts: new Date().toISOString(),
      ...event,
    })}`
  );
}
