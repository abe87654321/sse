/**
 * Health decisions for the API.
 *
 * PostgreSQL remains the system of record, so the projector is a soft
 * dependency for business writes. It is a hard dependency for graph queries:
 * once ONTOLOGY_V2=on, a stuck outbox means ontology reads are stale, so the
 * readiness probe must fail.
 */

export const ONTOLOGY_OUTBOX_LAG_LIMIT_SECONDS = 300;

export type HealthReason = 'outbox_lag' | 'unavailable';

export interface HealthDecisionInput {
  mode?: string;
  oldestPendingAgeSeconds?: number;
  error?: string;
}

export interface HealthDecision {
  v2: boolean;
  healthy: boolean;
  statusCode: 200 | 503;
  reason?: HealthReason;
}

export function decideHealth(input: HealthDecisionInput): HealthDecision {
  const v2 = input.mode === 'on';
  if (!v2) {
    return { v2: false, healthy: true, statusCode: 200 };
  }

  if (input.error) {
    return { v2: true, healthy: false, statusCode: 503, reason: 'unavailable' };
  }

  const age = Number(input.oldestPendingAgeSeconds ?? 0);
  if (Number.isFinite(age) && age > ONTOLOGY_OUTBOX_LAG_LIMIT_SECONDS) {
    return { v2: true, healthy: false, statusCode: 503, reason: 'outbox_lag' };
  }

  return { v2: true, healthy: true, statusCode: 200 };
}
