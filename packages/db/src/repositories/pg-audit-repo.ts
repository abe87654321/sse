import { pool } from '../connection';

export type AuditActorType = 'user' | 'service' | 'system';
export type AuditOutcome = 'success' | 'failure' | 'denied';

export interface AuditEventInput {
  occurredAt?: Date;
  actorType?: AuditActorType;
  actorId?: string | null;
  actorRole?: string | null;
  source: string;
  action: string;
  entityType?: string | null;
  entityId?: string | null;
  outcome?: AuditOutcome;
  ip?: string | null;
  requestId?: string | null;
  details?: Record<string, unknown>;
}

export interface AuditEvent {
  id: string;
  occurredAt: Date;
  actorType: AuditActorType;
  actorId: string | null;
  actorRole: string | null;
  source: string;
  action: string;
  entityType: string | null;
  entityId: string | null;
  outcome: string;
  ip: string | null;
  requestId: string | null;
  details: Record<string, unknown>;
}

export interface AuditQuery {
  source?: string;
  action?: string;
  actorId?: string;
  entityType?: string;
  entityId?: string;
  outcome?: string;
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
}

const MAX_PAGE_SIZE = 200;
const DEFAULT_PAGE_SIZE = 50;

function mapRow(row: any): AuditEvent {
  return {
    id: row.id,
    occurredAt: row.occurred_at,
    actorType: row.actor_type,
    actorId: row.actor_id,
    actorRole: row.actor_role,
    source: row.source,
    action: row.action,
    entityType: row.entity_type,
    entityId: row.entity_id,
    outcome: row.outcome,
    ip: row.ip,
    requestId: row.request_id,
    details: row.details ?? {},
  };
}

function buildWhere(query: AuditQuery): { where: string; params: any[] } {
  const clauses: string[] = [];
  const params: any[] = [];

  const add = (column: string, value: unknown) => {
    if (value === undefined || value === null || value === '') return;
    params.push(value);
    clauses.push(`${column} = $${params.length}`);
  };

  add('source', query.source);
  add('action', query.action);
  add('actor_id', query.actorId);
  add('entity_type', query.entityType);
  add('entity_id', query.entityId);
  add('outcome', query.outcome);

  if (query.from) {
    params.push(query.from);
    clauses.push(`occurred_at >= $${params.length}::timestamptz`);
  }
  if (query.to) {
    params.push(query.to);
    clauses.push(`occurred_at <= $${params.length}::timestamptz`);
  }

  return {
    where: clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '',
    params,
  };
}

export class PgAuditRepo {
  async insert(event: AuditEventInput): Promise<string> {
    const { rows } = await pool.query(
      `INSERT INTO audit_events
         (occurred_at, actor_type, actor_id, actor_role, source, action,
          entity_type, entity_id, outcome, ip, request_id, details)
       VALUES (COALESCE($1::timestamptz, NOW()), $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb)
       RETURNING id`,
      [
        event.occurredAt ? event.occurredAt.toISOString() : null,
        event.actorType ?? 'system',
        event.actorId ?? null,
        event.actorRole ?? null,
        event.source,
        event.action,
        event.entityType ?? null,
        event.entityId ?? null,
        event.outcome ?? 'success',
        event.ip ?? null,
        event.requestId ?? null,
        JSON.stringify(event.details ?? {}),
      ]
    );
    return rows[0].id;
  }

  async query(query: AuditQuery = {}): Promise<{ items: AuditEvent[]; total: number }> {
    const { where, params } = buildWhere(query);
    const limit = Math.min(
      Math.max(Number(query.limit) || DEFAULT_PAGE_SIZE, 1),
      MAX_PAGE_SIZE
    );
    const offset = Math.max(Number(query.offset) || 0, 0);

    const { rows: countRows } = await pool.query(
      `SELECT COUNT(*)::int AS count FROM audit_events ${where}`,
      params
    );

    const { rows } = await pool.query(
      `SELECT id, occurred_at, actor_type, actor_id, actor_role, source, action,
              entity_type, entity_id, outcome, ip, request_id, details
         FROM audit_events
         ${where}
         ORDER BY occurred_at DESC, id DESC
         LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, limit, offset]
    );

    return {
      items: rows.map(mapRow),
      total: Number(countRows[0]?.count ?? 0),
    };
  }
}
