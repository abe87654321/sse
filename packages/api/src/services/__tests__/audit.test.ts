const mockInsert = jest.fn();

jest.mock('@sse/db', () => ({
  PgAuditRepo: jest.fn().mockImplementation(() => ({ insert: mockInsert })),
}));

import {
  auditFromRequest,
  classifyMutation,
  recordAuditEvent,
  sanitizeAuditDetails,
} from '../audit';

beforeEach(() => {
  mockInsert.mockReset();
  mockInsert.mockResolvedValue('evt-1');
  process.env.AUDIT_EVENTS = '1';
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  (console.error as jest.Mock).mockRestore();
  delete process.env.AUDIT_EVENTS;
});

describe('sanitizeAuditDetails', () => {
  it('redacts secret-bearing keys recursively', () => {
    const details = sanitizeAuditDetails({
      tool: 'search_expenses',
      password: 'p',
      nested: {
        token: 't',
        Authorization: 'Bearer x',
        apiKey: 'k',
        clientSecret: 's',
        safe: 'ok',
      },
      list: [{ refreshToken: 'r', id: '1' }],
    });

    expect(details).toEqual({
      tool: 'search_expenses',
      password: '[REDACTED]',
      nested: {
        token: '[REDACTED]',
        Authorization: '[REDACTED]',
        apiKey: '[REDACTED]',
        clientSecret: '[REDACTED]',
        safe: 'ok',
      },
      list: [{ refreshToken: '[REDACTED]', id: '1' }],
    });
  });

  it('drops oversized payloads instead of storing them', () => {
    const details = sanitizeAuditDetails({ note: 'x'.repeat(9000) });
    expect(details).toEqual({ truncated: true });
  });
});

describe('classifyMutation', () => {
  it.each([
    ['POST', '/expenses', '/', 'expense.create'],
    ['PUT', '/expenses', '/:id', 'expense.update'],
    ['DELETE', '/expenses', '/:id', 'expense.delete'],
    ['POST', '/approvals', '/:id/approve', 'approval.approve'],
    ['POST', '/approvals', '/:id/reject', 'approval.reject'],
    ['POST', '/admin/users', '/', 'user.create'],
    ['PUT', '/admin/users', '/:id', 'user.update'],
    ['DELETE', '/admin/users', '/:id', 'user.delete'],
    ['PUT', '/admin/ai-config', '/', 'ai_config.update'],
    ['POST', '/admin/ai-engines', '/test', 'ai_config.test'],
    ['POST', '/admin/reasoning-rules', '/preview', 'reasoning_rule.preview'],
    ['POST', '/admin/messages', '/', 'broadcast.create'],
    ['PUT', '/auth/password', '/', 'user_credential.update'],
  ])('%s %s%s -> %s', (method, baseUrl, routePath, action) => {
    expect(classifyMutation(method, baseUrl, routePath)).toEqual(
      expect.objectContaining({ action })
    );
  });

  it('ignores reads and routes with dedicated audit handling', () => {
    expect(classifyMutation('GET', '/expenses', '/')).toBeNull();
    expect(classifyMutation('POST', '/auth', '/login')).toBeNull();
    expect(classifyMutation('POST', '/auth', '/api-key-login')).toBeNull();
    expect(classifyMutation('POST', '/scim', '/Users')).toBeNull();
    expect(classifyMutation('POST', '/webhook', '/mdm')).toBeNull();
  });
});

describe('recordAuditEvent', () => {
  it('persists sanitized events', async () => {
    await recordAuditEvent({
      actorType: 'user',
      actorId: 'u1',
      actorRole: 'admin',
      source: 'admin',
      action: 'user.update',
      entityType: 'user',
      entityId: 'u2',
      details: { password: 'secret', role: 'employee' },
    });

    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'admin',
        action: 'user.update',
        details: { password: '[REDACTED]', role: 'employee' },
      })
    );
  });

  it('never throws when persistence fails', async () => {
    mockInsert.mockRejectedValue(new Error('db down'));
    await expect(
      recordAuditEvent({ source: 'auth', action: 'login.failure' })
    ).resolves.toBeUndefined();
  });

  it('is disabled by AUDIT_EVENTS=0', async () => {
    process.env.AUDIT_EVENTS = '0';
    await recordAuditEvent({ source: 'auth', action: 'login.success' });
    expect(mockInsert).not.toHaveBeenCalled();
  });
});

describe('auditFromRequest', () => {
  it('takes the actor, ip and request id from the request', async () => {
    const req = {
      user: { userId: 'u1', role: 'admin', department: 'ops' },
      ip: '127.0.0.1',
      headers: { 'x-request-id': 'req-1' },
    } as any;

    await auditFromRequest(req, {
      source: 'admin',
      action: 'user.delete',
      entityType: 'user',
      entityId: 'u2',
    });
    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        actorType: 'user',
        actorId: 'u1',
        actorRole: 'admin',
        ip: '127.0.0.1',
        requestId: 'req-1',
      })
    );
  });
});
