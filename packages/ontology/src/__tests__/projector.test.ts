import { MemoryGraphStore } from '../graph/memory-store';
import { sse } from '../graph/namespaces';
import type { ProjectedQuad } from '../graph/types';
import { GraphProjector } from '../projection/projector';

class FakePool {
  state = { last_outbox_id: 0 };
  lockAvailable = true;
  queries: Array<{ sql: string; params?: any[] }> = [];

  constructor(public rows: any[] = []) {}

  private normalize(sql: string): string {
    return sql.replace(/\s+/g, ' ').trim();
  }

  private pending(): any[] {
    return this.rows
      .filter(row => !row.processed_at && !row.dead_letter)
      .sort((a, b) => a.id - b.id);
  }

  private handle = async (sql: string, params: any[] = []): Promise<{ rows: any[]; rowCount?: number | null }> => {
    const statement = this.normalize(sql);
    this.queries.push({ sql: statement, params });

    if (statement.includes('pg_try_advisory_xact_lock')) {
      return { rows: [{ ok: this.lockAvailable }] };
    }
    if (statement === 'BEGIN' || statement === 'COMMIT' || statement === 'ROLLBACK') {
      return { rows: [] };
    }
    if (statement.includes('FROM ontology_outbox') && statement.includes('FOR UPDATE SKIP LOCKED')) {
      return { rows: this.pending().slice(0, Number(params[0] ?? 200)).map(row => ({ ...row })) };
    }
    if (statement.startsWith('UPDATE ontology_outbox SET processed_at = NOW() WHERE id = $1')) {
      const row = this.rows.find(item => item.id === Number(params[0]));
      if (row) row.processed_at = new Date().toISOString();
      return { rows: [] };
    }
    if (statement.startsWith('UPDATE ontology_outbox')) {
      const row = this.rows.find(item => item.id === Number(params[0]));
      if (row) {
        row.attempts = Number(params[1]);
        row.last_error = params[2];
        row.dead_letter = Boolean(params[3]);
        if (params[3]) row.processed_at = new Date().toISOString();
      }
      return { rows: [] };
    }
    if (statement.startsWith('UPDATE ontology_projector_state')) {
      this.state.last_outbox_id = Math.max(this.state.last_outbox_id, Number(params[0]));
      return { rows: [] };
    }
    if (statement.startsWith('DELETE FROM ontology_outbox')) {
      const days = Number(params[0]);
      const cutoff = Date.now() - days * 86_400_000;
      const before = this.rows.length;
      this.rows = this.rows.filter(
        row => !(row.processed_at && new Date(row.processed_at).getTime() < cutoff),
      );
      return { rows: [], rowCount: before - this.rows.length };
    }
    return { rows: [] };
  };

  query = (sql: string, params?: any[]) => this.handle(sql, params);

  connect = async () => ({
    query: (sql: string, params?: any[]) => this.handle(sql, params),
    release: () => {},
  });
}

class FlakyStore extends MemoryGraphStore {
  constructor(private failSubject: string) {
    super();
  }

  override async replaceEntity(subject: string, quads: ProjectedQuad[], ownedPredicates: string[]): Promise<void> {
    if (subject === this.failSubject) throw new Error('projection failed');
    return super.replaceEntity(subject, quads, ownedPredicates);
  }
}

const REPORT_TYPES = 'SELECT ?s WHERE { GRAPH <urn:sse:data> { ?s a <https://sse.local/ontology#ExpenseReport> } }';

describe('GraphProjector', () => {
  it('projects insert/update/delete and marks rows processed', async () => {
    const store = new MemoryGraphStore();
    const pool = new FakePool([
      { id: 1, table_name: 'expense_reports', op: 'INSERT', row_id: 'r1', old_row: null, new_row: { id: 'r1', serial_no: 'RE-1', user_id: 'p1', title: 't', total_amount: '10', status: 'pending', current_step: 1, updated_at: '2026-11-10T00:00:00Z' } },
      { id: 2, table_name: 'expense_reports', op: 'UPDATE', row_id: 'r1', old_row: {}, new_row: { id: 'r1', serial_no: 'RE-1', user_id: 'p1', title: 't', total_amount: '10', status: 'approved', current_step: 1, updated_at: '2026-11-10T00:01:00Z' } },
      { id: 3, table_name: 'expense_reports', op: 'DELETE', row_id: 'r1', old_row: { id: 'r1' }, new_row: null },
    ]);
    const projector = new GraphProjector(store, pool as any);
    const result = await projector.drain(10);

    expect(result).toEqual({ processed: 3, failed: 0, deadLettered: 0 });
    const res = await store.query(REPORT_TYPES);
    if (res.kind !== 'select') throw new Error('expected select');
    expect(res.rows).toEqual([]);
    expect(pool.rows.every(row => Boolean(row.processed_at))).toBe(true);
    expect(pool.state.last_outbox_id).toBe(3);
  });

  it('is idempotent when replayed', async () => {
    const store = new MemoryGraphStore();
    const base = { table_name: 'users', op: 'INSERT', row_id: 'p1', old_row: null, new_row: { id: 'p1', name: 'A', department: 'D', role: 'employee', status: 'active' } };
    const pool = new FakePool([{ id: 1, ...base }, { id: 2, ...base }]);
    const projector = new GraphProjector(store, pool as any);
    await projector.drain(10);

    const res = await store.query(
      `SELECT ?o WHERE { GRAPH <urn:sse:data> { <https://sse.local/person/p1> <${sse('name')}> ?o } }`,
    );
    if (res.kind !== 'select') throw new Error('expected select');
    expect(res.rows).toEqual([{ o: 'A' }]);
  });

  it('keeps report submittedBy when the person row is updated', async () => {
    const store = new MemoryGraphStore();
    await store.load(`
<https://sse.local/report/r1> <https://sse.local/ontology#submittedBy> <https://sse.local/person/p1> <urn:sse:data> .
<https://sse.local/person/p1> <https://sse.local/ontology#name> "Old" <urn:sse:data> .
`);
    const row = { id: 2, table_name: 'users', op: 'UPDATE', row_id: 'p1', old_row: { id: 'p1' }, new_row: { id: 'p1', name: 'New', department: 'D', role: 'employee', status: 'active' } };
    const projector = new GraphProjector(store, new FakePool([row]) as any);
    await projector.drain(10);

    const res = await store.query('SELECT ?r WHERE { GRAPH <urn:sse:data> { ?r <https://sse.local/ontology#submittedBy> <https://sse.local/person/p1> } }');
    if (res.kind !== 'select') throw new Error('expected select');
    expect(res.rows).toHaveLength(1);
  });

  it('keeps item edges when the report row is updated', async () => {
    const store = new MemoryGraphStore();
    await store.load(`
<https://sse.local/report/r1> <https://sse.local/ontology#containsItem> <https://sse.local/item/i1> <urn:sse:data> .
`);
    const row = { id: 1, table_name: 'expense_reports', op: 'UPDATE', row_id: 'r1', old_row: { id: 'r1' }, new_row: { id: 'r1', serial_no: 'RE-1', user_id: 'p1', title: 't', total_amount: '10', status: 'approved', current_step: 1, updated_at: '2026-11-10T00:01:00Z' } };
    const projector = new GraphProjector(store, new FakePool([row]) as any);
    await projector.drain(10);

    const res = await store.query('SELECT ?i WHERE { GRAPH <urn:sse:data> { <https://sse.local/report/r1> <https://sse.local/ontology#containsItem> ?i } }');
    if (res.kind !== 'select') throw new Error('expected select');
    expect(res.rows).toEqual([{ i: 'https://sse.local/item/i1' }]);
  });

  it('retracts the old parent when a child changes report', async () => {
    const store = new MemoryGraphStore();
    await store.load(`
<https://sse.local/report/r1> <https://sse.local/ontology#containsItem> <https://sse.local/item/i1> <urn:sse:data> .
`);
    const row = { id: 1, table_name: 'expense_items', op: 'UPDATE', row_id: 'i1', old_row: { id: 'i1', report_id: 'r1' }, new_row: { id: 'i1', report_id: 'r2', category_id: 'c1', amount: '10', expense_date: '2026-11-10', description: 'x' } };
    const projector = new GraphProjector(store, new FakePool([row]) as any);
    await projector.drain(10);

    const oldEdge = await store.query('ASK { GRAPH <urn:sse:data> { <https://sse.local/report/r1> <https://sse.local/ontology#containsItem> <https://sse.local/item/i1> } }');
    expect(oldEdge).toEqual({ kind: 'ask', value: false });
    const newEdge = await store.query('ASK { GRAPH <urn:sse:data> { <https://sse.local/report/r2> <https://sse.local/ontology#containsItem> <https://sse.local/item/i1> } }');
    expect(newEdge).toEqual({ kind: 'ask', value: true });
  });

  it('stops at the first retryable failure so the watermark stays contiguous', async () => {
    const store = new FlakyStore('https://sse.local/person/p2');
    const row = (id: number, userId: string) => ({
      id,
      table_name: 'users',
      op: 'INSERT',
      row_id: userId,
      old_row: null,
      new_row: { id: userId, name: userId, department: 'D', role: 'employee', status: 'active' },
    });
    const pool = new FakePool([row(1, 'p1'), row(2, 'p2'), row(3, 'p3')]);
    const projector = new GraphProjector(store, pool as any);
    const result = await projector.drain(10);

    expect(result).toEqual({ processed: 1, failed: 1, deadLettered: 0 });
    expect(pool.rows[0].processed_at).toBeTruthy();
    expect(pool.rows[1].attempts).toBe(1);
    expect(pool.rows[2].processed_at).toBeUndefined();
    expect(pool.state.last_outbox_id).toBe(1);

    const p1 = await store.query('ASK { GRAPH <urn:sse:data> { <https://sse.local/person/p1> <https://sse.local/ontology#name> ?o } }');
    expect(p1).toEqual({ kind: 'ask', value: true });
    const p3 = await store.query('ASK { GRAPH <urn:sse:data> { <https://sse.local/person/p3> <https://sse.local/ontology#name> ?o } }');
    expect(p3).toEqual({ kind: 'ask', value: false });
  });

  it('dead-letters a row after the maximum number of attempts', async () => {
    const store = new FlakyStore('https://sse.local/person/p1');
    const pool = new FakePool([
      { id: 1, table_name: 'users', op: 'INSERT', row_id: 'p1', old_row: null, new_row: { id: 'p1', name: 'A', department: 'D', role: 'employee', status: 'active' } },
    ]);
    const projector = new GraphProjector(store, pool as any, { maxAttempts: 2 });

    const first = await projector.drain(10);
    expect(first).toEqual({ processed: 0, failed: 1, deadLettered: 0 });
    expect(pool.rows[0].attempts).toBe(1);
    expect(pool.rows[0].dead_letter).toBe(false);

    const second = await projector.drain(10);
    expect(second).toEqual({ processed: 0, failed: 1, deadLettered: 1 });
    expect(pool.rows[0].attempts).toBe(2);
    expect(pool.rows[0].dead_letter).toBe(true);
    expect(pool.rows[0].processed_at).toBeTruthy();

    const third = await projector.drain(10);
    expect(third).toEqual({ processed: 0, failed: 0, deadLettered: 0 });
  });

  it('returns without changes when the advisory lock is held elsewhere', async () => {
    const store = new MemoryGraphStore();
    const pool = new FakePool([
      { id: 1, table_name: 'users', op: 'INSERT', row_id: 'p1', old_row: null, new_row: { id: 'p1', name: 'A', department: 'D', role: 'employee', status: 'active' } },
    ]);
    pool.lockAvailable = false;
    const projector = new GraphProjector(store, pool as any);

    const result = await projector.drain(10);
    expect(result).toEqual({ processed: 0, failed: 0, deadLettered: 0 });
    expect(pool.rows[0].processed_at).toBeUndefined();
  });

  it('purges only processed events older than the retention window', async () => {
    const old = new Date(Date.now() - 10 * 86_400_000).toISOString();
    const recent = new Date().toISOString();
    const pool = new FakePool([
      { id: 1, processed_at: old },
      { id: 2, processed_at: recent },
      { id: 3, processed_at: null },
    ]);
    const projector = new GraphProjector(new MemoryGraphStore(), pool as any);

    await expect(projector.purgeOldEvents(7)).resolves.toBe(1);
    expect(pool.rows.map(row => row.id)).toEqual([2, 3]);
  });
});
