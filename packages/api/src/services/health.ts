/**
 * Health decisions for the API.
 *
 * PostgreSQL remains the system of record, so the projector is a soft
 * dependency for business writes. It is a hard dependency for graph queries:
 * once ONTOLOGY_V2=on, a stuck outbox means ontology reads are stale, so the
 * readiness probe must fail.
 */

import type { Request, Response } from 'express';

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

/**
 * Shared `/health` and `/healthz` handler. Kept separate from index.ts so the
 * route wiring can be exercised without starting the whole API.
 */
export async function healthHandler(_req: Request, res: Response): Promise<void> {
  const timestamp = new Date().toISOString();
  const mode = process.env.ONTOLOGY_V2;

  // Keep the pre-v2 liveness payload unchanged (and DB-free).
  if (mode !== 'on') {
    res.status(200).json({ status: 'ok', timestamp });
    return;
  }

  let oldestPendingAgeSeconds = 0;
  let error: string | undefined;
  try {
    const { pool } = await import('@sse/db');
    const { rows } = await pool.query(
      `SELECT COALESCE(
         EXTRACT(EPOCH FROM (
           NOW() - MIN(occurred_at) FILTER (
             WHERE processed_at IS NULL AND dead_letter = false
           )
         )),
         0
       ) AS oldest_pending_age_seconds
         FROM ontology_outbox`,
    );
    oldestPendingAgeSeconds = Number(rows[0]?.oldest_pending_age_seconds ?? 0);
  } catch (err: any) {
    error = err?.message || 'ontology outbox unavailable';
  }

  const decision = decideHealth({ mode, oldestPendingAgeSeconds, error });
  res.status(decision.statusCode).json({
    status: decision.healthy ? 'ok' : 'degraded',
    timestamp,
    ontology: {
      status: decision.healthy ? 'ok' : 'degraded',
      outbox: { oldestPendingAgeSeconds },
      ...(decision.reason ? { reason: decision.reason } : {}),
    },
  });
}
