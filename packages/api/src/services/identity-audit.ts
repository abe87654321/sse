import { recordAuditEvent } from './audit';

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
  entityType?: string;
  entityId?: string;
}

export function auditIdentityEvent(event: IdentityAuditEvent): void {
  console.error(
    `[identity-audit] ${JSON.stringify({
      ts: new Date().toISOString(),
      ...event,
    })}`
  );

  void recordAuditEvent({
    actorType: 'service',
    actorId: event.source,
    source: event.source,
    action: event.action,
    entityType: event.entityType || 'user',
    entityId: event.entityId || event.localUserId || event.externalId || null,
    outcome: event.outcome === 'success' ? 'success' : event.outcome === 'rejected' ? 'denied' : 'failure',
    ip: event.ip,
    details: {
      externalId: event.externalId,
      role: event.role,
      reason: event.reason,
    },
  });
}
