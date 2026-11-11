jest.mock('@sse/db', () => ({
  pool: { query: jest.fn() },
}));

import { pool } from '@sse/db';
import { SemanticMapper } from '../semantic-mapper';
import type { OwlStore } from '../owl-store';

const query = pool.query as jest.Mock;

function fakeStore(): OwlStore {
  return {
    addEntity: jest.fn(),
    addRelation: jest.fn(),
  } as unknown as OwlStore;
}

describe('SemanticMapper legacy aliases', () => {
  const original = process.env.ONTOLOGY_V2;
  let errorSpy: jest.SpyInstance;

  beforeEach(() => {
    query.mockReset();
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    process.env.ONTOLOGY_V2 = original;
    errorSpy.mockRestore();
  });

  it('is a no-op with a deprecation log only when ONTOLOGY_V2=on', async () => {
    process.env.ONTOLOGY_V2 = 'on';
    const store = fakeStore();
    const mapper = new SemanticMapper(store);

    await mapper.syncReportToOntology('r1');
    await mapper.syncAll();

    expect(query).not.toHaveBeenCalled();
    expect(store.addEntity).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledTimes(2);
    expect(String(errorSpy.mock.calls[0][0])).toContain('ONTOLOGY_V2=on');
  });

  it.each(['0', 'shadow'])('keeps the legacy report sync when ONTOLOGY_V2=%s', async (mode) => {
    process.env.ONTOLOGY_V2 = mode;
    query.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM expense_reports WHERE id = $1')) {
        return {
          rows: [{
            id: 'r1',
            user_id: 'u1',
            status: 'pending',
            serial_no: 'RE-1',
            title: 't',
            total_amount: '10',
            created_at: '2026-11-10T00:00:00Z',
          }],
        };
      }
      if (sql.includes('FROM users')) {
        return { rows: [{ id: 'u1', name: 'Alice', department: '技术部' }] };
      }
      if (sql.includes('FROM expense_items')) return { rows: [] };
      return { rows: [] };
    });

    const store = fakeStore();
    const mapper = new SemanticMapper(store);
    await mapper.syncReportToOntology('r1');

    expect(query).toHaveBeenCalledWith('SELECT * FROM expense_reports WHERE id = $1', ['r1']);
    expect(store.addEntity).toHaveBeenCalledWith(
      'https://sse.local/report/r1',
      'PendingReport',
      expect.objectContaining({ status: 'pending' }),
    );
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it.each(['0', 'shadow'])('keeps the legacy bulk sync when ONTOLOGY_V2=%s', async (mode) => {
    process.env.ONTOLOGY_V2 = mode;
    query.mockImplementation(async (sql: string) => {
      if (sql.startsWith('SELECT id FROM expense_reports')) return { rows: [{ id: 'r1' }] };
      if (sql.includes('FROM expense_reports WHERE id = $1')) {
        return {
          rows: [{
            id: 'r1',
            user_id: 'u1',
            status: 'draft',
            serial_no: 'RE-1',
            title: 't',
            total_amount: '10',
            created_at: '2026-11-10T00:00:00Z',
          }],
        };
      }
      if (sql.includes('FROM users')) {
        return { rows: [{ id: 'u1', name: 'Alice', department: '技术部' }] };
      }
      if (sql.includes('FROM expense_items')) return { rows: [] };
      return { rows: [] };
    });

    const store = fakeStore();
    await new SemanticMapper(store).syncAll();

    expect(query).toHaveBeenCalledWith(
      'SELECT id FROM expense_reports ORDER BY created_at DESC LIMIT 500',
    );
    expect(store.addEntity).toHaveBeenCalledWith(
      'https://sse.local/report/r1',
      'DraftReport',
      expect.any(Object),
    );
  });
});
