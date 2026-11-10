import { getOntologyStatus } from '../services/ontology-status';

describe('getOntologyStatus', () => {
  it('reports graph counts, outbox state and snapshot version', async () => {
    const queries: string[] = [];
    const status = await getOntologyStatus({
      query: async (sql: string) => {
        queries.push(sql);
        if (sql.includes('dead_letter')) {
          return {
            rows: [{
              pending: '3',
              dead_lettered: '1',
              oldest_pending_age_seconds: '12.5',
              last_error: 'boom',
            }],
          };
        }
        if (sql.includes('last_snapshot_version')) {
          return { rows: [{ last_snapshot_version: '7' }] };
        }
        return { rows: [] };
      },
      counts: async () => ({ quads: 10, subjects: 4 }),
    });

    expect(status).toEqual({
      engine: 'oxigraph',
      counts: { quads: 10, subjects: 4 },
      outbox: {
        pending: 3,
        deadLettered: 1,
        oldestPendingAgeSeconds: 12.5,
        lastError: 'boom',
      },
      version: 7,
    });
    expect(queries.some(sql => sql.includes('ontology_outbox'))).toBe(true);
    expect(queries.some(sql => sql.includes('ontology_projector_state'))).toBe(true);
  });

  it('defaults an empty outbox and missing projector state to zero', async () => {
    const status = await getOntologyStatus({
      query: async (sql: string) => (sql.includes('dead_letter') ? { rows: [{}] } : { rows: [] }),
      counts: async () => ({ quads: 0, subjects: 0 }),
    });

    expect(status.outbox).toEqual({
      pending: 0,
      deadLettered: 0,
      oldestPendingAgeSeconds: 0,
      lastError: null,
    });
    expect(status.version).toBe(0);
  });
});
