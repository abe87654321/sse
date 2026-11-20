const mockQuery = jest.fn();

jest.mock('../connection', () => ({
  pool: { query: (...args: any[]) => mockQuery(...args) },
}));

import { PgAuditRepo } from '../repositories/pg-audit-repo';

beforeEach(() => {
  mockQuery.mockReset();
});

describe('PgAuditRepo.insert', () => {
  it('inserts a parameterized audit event and returns its id', async () => {
    mockQuery.mockResolvedValue({ rows: [{ id: 'evt-1' }] });

    const id = await new PgAuditRepo().insert({
      actorType: 'user',
      actorId: 'u1',
      actorRole: 'admin',
      source: 'auth',
      action: 'login.success',
      entityType: 'user',
      entityId: 'u1',
      outcome: 'success',
      ip: '127.0.0.1',
      requestId: 'req-1',
      details: { method: 'POST' },
    });

    expect(id).toBe('evt-1');
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain('INSERT INTO audit_events');
    expect(sql).toContain('$12::jsonb');
    expect(params).toEqual([
      null,
      'user',
      'u1',
      'admin',
      'auth',
      'login.success',
      'user',
      'u1',
      'success',
      '127.0.0.1',
      'req-1',
      JSON.stringify({ method: 'POST' }),
    ]);
  });
});

describe('PgAuditRepo.query', () => {
  it('filters, clamps the page size and returns a total', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ count: 2 }] })
      .mockResolvedValueOnce({
        rows: [
          {
            id: 'evt-1',
            occurred_at: new Date('2026-11-20T00:00:00Z'),
            actor_type: 'user',
            actor_id: 'u1',
            actor_role: 'admin',
            source: 'auth',
            action: 'login.success',
            entity_type: 'user',
            entity_id: 'u1',
            outcome: 'success',
            ip: '127.0.0.1',
            request_id: 'req-1',
            details: {},
          },
        ],
      });

    const result = await new PgAuditRepo().query({
      source: 'auth',
      action: 'login.success',
      actorId: 'u1',
      entityType: 'user',
      entityId: 'u1',
      outcome: 'success',
      from: '2026-11-01T00:00:00Z',
      to: '2026-11-21T00:00:00Z',
      limit: 5000,
      offset: -3,
    });

    expect(result.total).toBe(2);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      id: 'evt-1',
      actorId: 'u1',
      action: 'login.success',
      details: {},
    });

    const [countSql, countParams] = mockQuery.mock.calls[0];
    expect(countSql).toContain('SELECT COUNT(*)::int AS count FROM audit_events');
    expect(countSql).toContain('source = $1');
    expect(countSql).toContain('action = $2');
    expect(countParams[0]).toBe('auth');
    expect(countParams[1]).toBe('login.success');

    const [listSql, listParams] = mockQuery.mock.calls[1];
    expect(listSql).toContain('ORDER BY occurred_at DESC, id DESC');
    expect(listParams.slice(-2)).toEqual([200, 0]);
  });
});
