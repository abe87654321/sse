import { canonicalChecksum } from '../graph/checksum';
import { MemoryGraphStore } from '../graph/memory-store';
import { setGraphContext } from '../graph/graph-context';
import { GRAPH, sse, uri } from '../graph/namespaces';
import { rebuildGraph, reconcile } from '../projection/reconcile';
import { getReconcileJob, startReconcileJob } from '../projection/reconcile-jobs';

const tables: Record<string, any[]> = {
  users: [{ id: 'p1', name: 'A', department: 'D', role: 'employee', status: 'active' }],
  expense_categories: [{ id: 'c1', name: '差旅', is_active: true, sort_order: 1 }],
  expense_reports: [{ id: 'r1', serial_no: 'RE-1', user_id: 'p1', title: 't', total_amount: '10', status: 'pending', current_step: 1 }],
  expense_items: [{ id: 'i1', report_id: 'r1', category_id: 'c1', amount: '10', expense_date: '2026-11-10', description: 'x' }],
  invoices: [{ id: 'v1', item_id: 'i1', invoice_no: 'INV-1', verification_status: 'verified', file_name: 'a.pdf', checksum: 'abc', uploaded_at: '2026-11-10T00:00:00Z' }],
  approval_rules: [{ id: 'ar1', name: 'r', min_amount: '0', max_amount: '1000', priority: 1, is_active: true, approval_chain: [{ step: 1, role: 'finance' }], category_ids: ['c1'] }],
  approval_records: [{ id: 'ap1', report_id: 'r1', approver_id: 'p1', step: 1, result: 'approved', comment: 'ok', step_started_at: '2026-11-10T00:00:00Z', approved_at: '2026-11-10T00:01:00Z' }],
  payment_receipts: [{ id: 'pay1', report_id: 'r1', verification_status: 'verified', file_name: 'r.pdf', checksum: 'xyz', uploaded_at: '2026-11-10T00:00:00Z' }],
};

class FakePool {
  state = { last_outbox_id: 0, last_snapshot_version: 0 };
  snapshots: any[] = [];
  queries: string[] = [];
  private seq = 0;

  constructor(
    private readonly data: Record<string, any[]> = tables,
    private readonly maxOutboxId = 42,
  ) {}

  async query(sql: string, params: any[] = []): Promise<{ rows: any[]; rowCount?: number | null }> {
    const statement = sql.replace(/\s+/g, ' ').trim();
    this.queries.push(statement);

    const tableMatch = /^SELECT \* FROM (\w+)/.exec(statement);
    if (tableMatch) {
      const rows = (this.data[tableMatch[1]] ?? [])
        .filter(row => String(row.id) > String(params[0]))
        .sort((a, b) => String(a.id).localeCompare(String(b.id)));
      return { rows: rows.slice(0, Number(params[1] ?? 500)) };
    }
    if (statement.includes('MAX(id)') && statement.includes('ontology_outbox')) {
      return { rows: [{ max_id: this.maxOutboxId }] };
    }
    if (statement.startsWith('SELECT nextval')) {
      return { rows: [{ version: ++this.seq }] };
    }
    if (statement.startsWith('INSERT INTO ontology_graph_snapshots')) {
      this.snapshots.push({
        version: Number(params[0]),
        checksum: params[1],
        nquads: params[2],
        graph_names: params[3],
        last_outbox_id: Number(params[4]),
      });
      return { rows: [] };
    }
    if (statement.startsWith('UPDATE ontology_projector_state')) {
      if (params.length >= 2) {
        this.state.last_snapshot_version = Math.max(this.state.last_snapshot_version, Number(params[0]));
        this.state.last_outbox_id = Math.max(this.state.last_outbox_id, Number(params[1]));
      } else {
        this.state.last_outbox_id = Math.max(this.state.last_outbox_id, Number(params[0]));
      }
      return { rows: [] };
    }
    if (statement.startsWith('DELETE FROM ontology_graph_snapshots')) {
      const keep = Number(params[0]);
      this.snapshots.sort((a, b) => b.version - a.version);
      this.snapshots = this.snapshots.slice(0, keep);
      return { rows: [] };
    }
    return { rows: [] };
  }
}

async function hasEdge(store: MemoryGraphStore, from: string, predicate: string, to: string): Promise<boolean> {
  const result = await store.query(`ASK { GRAPH <urn:sse:data> { <${from}> <${predicate}> <${to}> } }`);
  return result.kind === 'ask' && result.value;
}

async function waitForJob(job: { state: string }, timeoutMs = 2000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (job.state === 'running' && Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 5));
  }
}

describe('reconcile', () => {
  it('projects all tables deterministically', async () => {
    const first = new MemoryGraphStore();
    const firstResult = await rebuildGraph(first, new FakePool() as any);

    expect(firstResult.counts.subjects).toBeGreaterThanOrEqual(9);
    expect(await hasEdge(first, uri.report('r1'), sse('containsItem'), uri.item('i1'))).toBe(true);
    expect(await hasEdge(first, uri.item('i1'), sse('hasInvoice'), uri.invoice('v1'))).toBe(true);
    expect(await hasEdge(first, uri.report('r1'), sse('hasApproval'), uri.approval('ap1'))).toBe(true);
    expect(await hasEdge(first, uri.report('r1'), sse('hasPaymentReceipt'), uri.payment('pay1'))).toBe(true);
    expect(await hasEdge(first, uri.person('p1'), sse('belongsTo'), uri.department('D'))).toBe(true);

    const classes = [
      ['person/p1', 'Person'],
      ['dept/D', 'Department'],
      ['category/c1', 'ExpenseCategory'],
      ['report/r1', 'ExpenseReport'],
      ['item/i1', 'ExpenseItem'],
      ['invoice/v1', 'Invoice'],
      ['rule/ar1', 'ApprovalRule'],
      ['approval/ap1', 'ApprovalRecord'],
      ['payment/pay1', 'PaymentReceipt'],
    ] as const;
    for (const [path, className] of classes) {
      const result = await first.query(
        `ASK { GRAPH <urn:sse:data> { <https://sse.local/${path}> a <${sse(className)}> } }`,
      );
      expect(result).toEqual({ kind: 'ask', value: true });
    }

    const second = new MemoryGraphStore();
    const secondResult = await rebuildGraph(second, new FakePool() as any);
    expect(secondResult.checksum).toBe(firstResult.checksum);
  });

  it('preserves history tombstones and advances the outbox watermark', async () => {
    const store = new MemoryGraphStore();
    await store.update(
      `INSERT DATA { GRAPH <urn:sse:history> { <https://sse.local/report/deleted> <${sse('deletedAt')}> "2026-11-01T00:00:00Z" } }`,
    );
    const pool = new FakePool();

    const result = await reconcile(store, pool as any);

    expect(result.lastOutboxId).toBe(42);
    expect(pool.state.last_outbox_id).toBe(42);
    expect(pool.snapshots).toHaveLength(1);
    expect(pool.snapshots[0]).toMatchObject({ last_outbox_id: 42 });
    expect(pool.snapshots[0].checksum).toBe(result.checksum);

    const history = await store.query(
      `SELECT ?o WHERE { GRAPH <urn:sse:history> { <https://sse.local/report/deleted> <${sse('deletedAt')}> ?o } }`,
    );
    if (history.kind !== 'select') throw new Error('expected select');
    expect(history.rows).toHaveLength(1);

    expect(await hasEdge(store, uri.report('r1'), sse('containsItem'), uri.item('i1'))).toBe(true);
  });

  it('preserves manual edits across reconcile and snapshots them', async () => {
    const store = new MemoryGraphStore();
    await store.load(`
<https://sse.local/person/manual1> <${sse('name')}> "Manual" <urn:sse:manual> .
`);
    const pool = new FakePool();

    const rebuilt = await reconcile(store, pool as any);

    const manual = await store.query(
      `SELECT ?o WHERE { GRAPH <urn:sse:manual> { <https://sse.local/person/manual1> <${sse('name')}> ?o } }`,
    );
    if (manual.kind !== 'select') throw new Error('expected select');
    expect(manual.rows).toHaveLength(1);
    expect(manual.rows[0].o).toBe('Manual');

    expect(pool.snapshots).toHaveLength(1);
    expect(pool.snapshots[0].nquads).toContain('https://sse.local/person/manual1');
    expect(rebuilt.nquads).toContain('<urn:sse:manual>');
  });

  it('is deterministic when run repeatedly', async () => {
    const store = new MemoryGraphStore();
    const first = await reconcile(store, new FakePool() as any);
    const second = await reconcile(store, new FakePool() as any);
    expect(second.checksum).toBe(first.checksum);
    expect(second.counts).toEqual(first.counts);
  });

  it('captures the outbox watermark before scanning tables', async () => {
    const pool = new FakePool();
    await reconcile(new MemoryGraphStore(), pool as any);

    const maxIndex = pool.queries.findIndex(
      sql => sql.includes('MAX(id)') && sql.includes('ontology_outbox'),
    );
    const scanIndex = pool.queries.findIndex(sql => sql.startsWith('SELECT * FROM users'));
    expect(maxIndex).toBeGreaterThanOrEqual(0);
    expect(scanIndex).toBeGreaterThan(maxIndex);
  });

  it('paginates every table with keyset batches', async () => {
    const users = Array.from({ length: 5 }, (_, i) => ({
      id: `u${i + 1}`,
      name: `User ${i + 1}`,
      department: 'D',
      role: 'employee',
      status: 'active',
    }));
    const pool = new FakePool({ ...tables, users });
    const store = new MemoryGraphStore();

    const result = await rebuildGraph(store, pool as any, { batchSize: 2 });

    expect(result.counts.subjects).toBeGreaterThanOrEqual(5);
    const userScans = pool.queries.filter(sql => sql.startsWith('SELECT * FROM users'));
    expect(userScans).toHaveLength(3);

    const people = await store.query(
      'SELECT ?s WHERE { GRAPH <urn:sse:data> { ?s a <https://sse.local/ontology#Person> } }',
    );
    if (people.kind !== 'select') throw new Error('expected select');
    expect(people.rows).toHaveLength(5);
  });

  it('computes a canonical checksum regardless of n-quad insertion order', async () => {
    const first = new MemoryGraphStore();
    await first.load(`
<https://sse.local/report/r1> <https://sse.local/ontology#status> "pending" <urn:sse:data> .
<https://sse.local/report/r2> <https://sse.local/ontology#status> "approved" <urn:sse:data> .
`);
    const second = new MemoryGraphStore();
    await second.load(`
<https://sse.local/report/r2> <https://sse.local/ontology#status> "approved" <urn:sse:data> .
<https://sse.local/report/r1> <https://sse.local/ontology#status> "pending" <urn:sse:data> .
`);

    expect(canonicalChecksum(await first.dump([GRAPH.data]))).toBe(
      canonicalChecksum(await second.dump([GRAPH.data])),
    );
  });

  it('runs a reconcile job and exposes its state', async () => {
    const store = new MemoryGraphStore();
    setGraphContext(store, new FakePool() as any);

    const job = startReconcileJob();
    expect(job.state).toBe('running');
    expect(getReconcileJob(job.id)).toBe(job);

    await waitForJob(job);
    expect(job.state).toBe('done');
    expect(job.counts?.subjects).toBeGreaterThan(0);
    expect(job.checksum).toBeTruthy();
    expect(job.lastOutboxId).toBe(42);
  });

  it('materializes active rules returned by the pool during rebuild', async () => {
    const store = new MemoryGraphStore();
    const pool = new FakePool();
    const baseQuery = pool.query.bind(pool);
    (pool as any).query = async (sql: string, params: any[] = []) => {
      if (sql.includes('FROM reasoning_rules')) {
        return {
          rows: [{
            id: 'legacy-pending',
            construct_query:
              `CONSTRUCT { ?r a <${sse('PendingReport')}> } WHERE { ` +
              `GRAPH <${GRAPH.data}> { ?r a <${sse('ExpenseReport')}> ; <${sse('status')}> "pending" } }`,
          }],
        };
      }
      return baseQuery(sql, params);
    };

    await rebuildGraph(store, pool as any);

    const inferred = await store.query(
      `SELECT ?r WHERE { GRAPH <${GRAPH.inferred}> { ?r a <${sse('PendingReport')}> } }`,
    );
    if (inferred.kind !== 'select') throw new Error('expected select');
    expect(inferred.rows.map((row) => row.r)).toContain(uri.report('r1'));
  });

  it('marks a reconcile job failed when the rebuild throws', async () => {
    const store = new MemoryGraphStore();
    setGraphContext(store, { query: async () => { throw new Error('db down'); } } as any);

    const job = startReconcileJob();
    await waitForJob(job);

    expect(job.state).toBe('failed');
    expect(job.error).toContain('db down');
  });
});
