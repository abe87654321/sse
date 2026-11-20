import { randomUUID } from 'crypto';
import type { NextFunction, Request, Response } from 'express';
import { PgAuditRepo } from '@sse/db';

export interface AuditEventInput {
  actorType?: 'user' | 'service' | 'system';
  actorId?: string | null;
  actorRole?: string | null;
  source: string;
  action: string;
  entityType?: string | null;
  entityId?: string | null;
  outcome?: 'success' | 'failure' | 'denied';
  ip?: string | null;
  requestId?: string | null;
  details?: Record<string, unknown>;
}

const REDACTED = '[REDACTED]';
const MAX_DETAILS_BYTES = 8192;
const SECRET_KEY_PATTERN = /pass(word)?|secret|token|authorization|api[-_]?key|credential/i;

let auditRepo: PgAuditRepo | null = null;

function getAuditRepo(): PgAuditRepo {
  if (!auditRepo) auditRepo = new PgAuditRepo();
  return auditRepo;
}

function sanitizeValue(value: unknown, depth = 0): unknown {
  if (depth > 6) return '[TRUNCATED]';
  if (Array.isArray(value)) return value.map((item) => sanitizeValue(item, depth + 1));
  if (value && typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      result[key] = SECRET_KEY_PATTERN.test(key)
        ? REDACTED
        : sanitizeValue(child, depth + 1);
    }
    return result;
  }
  return value;
}

export function sanitizeAuditDetails(
  details: Record<string, unknown> | undefined
): Record<string, unknown> {
  if (!details) return {};
  const sanitized = sanitizeValue(details) as Record<string, unknown>;
  try {
    if (JSON.stringify(sanitized).length > MAX_DETAILS_BYTES) {
      return { truncated: true };
    }
  } catch {
    return { truncated: true };
  }
  return sanitized;
}

export async function recordAuditEvent(event: AuditEventInput): Promise<void> {
  if (process.env.AUDIT_EVENTS === '0') return;

  try {
    await getAuditRepo().insert({
      actorType: event.actorType,
      actorId: event.actorId,
      actorRole: event.actorRole,
      source: event.source,
      action: event.action,
      entityType: event.entityType,
      entityId: event.entityId,
      outcome: event.outcome,
      ip: event.ip,
      requestId: event.requestId,
      details: sanitizeAuditDetails(event.details),
    });
  } catch (error) {
    console.error('[audit] failed to persist audit event', {
      source: event.source,
      action: event.action,
      message: error instanceof Error ? error.message : 'unknown',
    });
  }
}

function headerValue(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

export function getRequestId(req: Request): string | undefined {
  return (req as Request & { requestId?: string }).requestId
    || headerValue(req.headers['x-request-id']);
}

export function attachRequestId(req: Request, res: Response, next: NextFunction): void {
  const requestId = headerValue(req.headers['x-request-id']) || randomUUID();
  (req as Request & { requestId?: string }).requestId = requestId;
  res.setHeader('X-Request-Id', requestId);
  next();
}

export async function auditFromRequest(
  req: Request,
  event: Omit<AuditEventInput, 'actorType' | 'actorId' | 'actorRole' | 'ip' | 'requestId'>
): Promise<void> {
  await recordAuditEvent({
    ...event,
    actorType: req.user ? 'user' : 'system',
    actorId: req.user?.userId ?? null,
    actorRole: req.user?.role ?? null,
    ip: req.ip ?? null,
    requestId: getRequestId(req) ?? null,
  });
}

export interface MutationClassification {
  action: string;
  entityType: string;
}

const SPECIAL_ACTIONS: Record<string, string> = {
  approve: 'approve',
  reject: 'reject',
  pay: 'pay',
  submit: 'submit',
  verify: 'verify',
  revert: 'revert',
  rotate: 'rotate',
  test: 'test',
  preview: 'preview',
  sync: 'sync',
  reconcile: 'reconcile',
};

function methodVerb(method: string): string {
  switch (method.toUpperCase()) {
    case 'POST':
      return 'create';
    case 'PUT':
    case 'PATCH':
      return 'update';
    case 'DELETE':
      return 'delete';
    default:
      return 'mutate';
  }
}

function entityTypeFor(path: string): string {
  if (path.includes('/admin/users')) return 'user';
  if (path.includes('/admin/rules')) return 'approval_rule';
  if (path.includes('/admin/reasoning-rules')) return 'reasoning_rule';
  if (path.includes('/admin/ai-config') || path.includes('/admin/ai-engines')) return 'ai_config';
  if (path.includes('/admin/messages')) return 'broadcast';
  if (path.includes('/admin/mcp-keys')) return 'mcp_key';
  if (path.includes('/payment-receipts') || path.includes('/payment')) return 'payment';
  if (path.includes('/invoice')) return 'invoice';
  if (path.includes('/expenses')) return 'expense';
  if (path.includes('/approvals')) return 'approval';
  if (path.includes('/auth/password')) return 'user_credential';
  if (path.includes('/user')) return 'user_profile';
  if (path.includes('/notifications')) return 'notification_preference';
  return 'http';
}

export function classifyMutation(
  method: string,
  baseUrl: string,
  routePath: string
): MutationClassification | null {
  const upper = method.toUpperCase();
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(upper)) return null;

  const path = `${baseUrl}${routePath}`.replace(/\/+/g, '/');
  if (path.startsWith('/scim') || path.startsWith('/webhook')) return null;
  if (path === '/auth/login' || path === '/auth/api-key-login') return null;

  const segments = path.split('/').filter(Boolean);
  const last = segments[segments.length - 1] || '';
  const verb = SPECIAL_ACTIONS[last] || methodVerb(upper);
  const entityType = entityTypeFor(path);

  return { action: `${entityType}.${verb}`, entityType };
}

export function auditMutations(req: Request, res: Response, next: NextFunction): void {
  res.on('finish', () => {
    const routePath = req.route?.path || '';
    const classification = classifyMutation(req.method, req.baseUrl, routePath);
    if (!classification) return;

    const params = (req.params || {}) as Record<string, string | undefined>;
    const entityId =
      params.id || params.reportId || params.itemId || params.invoiceId || params.receiptId;
    const body = (req.body || {}) as Record<string, unknown>;
    const details: Record<string, unknown> = {
      method: req.method,
      path: `${req.baseUrl}${routePath}`,
      status: res.statusCode,
    };
    if (typeof body.role === 'string') details.role = body.role;
    if (typeof body.status === 'string') details.status = body.status;
    if (typeof req.query.type === 'string') details.deleteType = req.query.type;

    void recordAuditEvent({
      actorType: req.user ? 'user' : 'system',
      actorId: req.user?.userId ?? null,
      actorRole: req.user?.role ?? null,
      source: 'api',
      action: classification.action,
      entityType: classification.entityType,
      entityId: entityId ?? null,
      outcome: res.statusCode < 400 ? 'success' : 'failure',
      ip: req.ip ?? null,
      requestId: getRequestId(req) ?? null,
      details,
    });
  });

  next();
}
