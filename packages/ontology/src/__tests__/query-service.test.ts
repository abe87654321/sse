import { MemoryGraphStore } from '../graph/memory-store';
import { loadTBox } from '../graph/ontology-loader';
import { InvalidQueryError, OntologyQueryService } from '../query/query-service';

const SSE = 'https://sse.local/ontology#';
const RDF = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#';
const XSD = 'http://www.w3.org/2001/XMLSchema#';
const DATA = 'urn:sse:data';

const NQ = `
<https://sse.local/report/r1> <${RDF}type> <${SSE}ExpenseReport> <${DATA}> .
<https://sse.local/report/r1> <${SSE}status> "pending" <${DATA}> .
<https://sse.local/report/r1> <${SSE}title> "差旅报销" <${DATA}> .
<https://sse.local/report/r1> <${SSE}amount> "120"^^<${XSD}decimal> <${DATA}> .
<https://sse.local/report/r1> <${SSE}submittedBy> <https://sse.local/person/p1> <${DATA}> .
<https://sse.local/report/r1> <${SSE}containsItem> <https://sse.local/item/i1> <${DATA}> .
<https://sse.local/report/r1> <${SSE}containsItem> <https://sse.local/item/i5> <${DATA}> .

<https://sse.local/report/r2> <${RDF}type> <${SSE}ExpenseReport> <${DATA}> .
<https://sse.local/report/r2> <${SSE}status> "pending" <${DATA}> .
<https://sse.local/report/r2> <${SSE}submittedBy> <https://sse.local/person/p2> <${DATA}> .
<https://sse.local/report/r2> <${SSE}containsItem> <https://sse.local/item/i2> <${DATA}> .
<https://sse.local/report/r2> <${SSE}containsItem> <https://sse.local/item/i4> <${DATA}> .

<https://sse.local/report/r3> <${RDF}type> <${SSE}ExpenseReport> <${DATA}> .
<https://sse.local/report/r3> <${SSE}status> "approved" <${DATA}> .
<https://sse.local/report/r3> <${SSE}submittedBy> <https://sse.local/person/p1> <${DATA}> .
<https://sse.local/report/r3> <${SSE}containsItem> <https://sse.local/item/i3> <${DATA}> .

<https://sse.local/person/p1> <${RDF}type> <${SSE}Person> <${DATA}> .
<https://sse.local/person/p1> <${SSE}name> "张三" <${DATA}> .
<https://sse.local/person/p1> <${SSE}belongsTo> <https://sse.local/dept/tech> <${DATA}> .
<https://sse.local/person/p2> <${RDF}type> <${SSE}Person> <${DATA}> .
<https://sse.local/person/p2> <${SSE}name> "李四" <${DATA}> .
<https://sse.local/person/p2> <${SSE}belongsTo> <https://sse.local/dept/sales> <${DATA}> .

<https://sse.local/dept/tech> <${RDF}type> <${SSE}Department> <${DATA}> .
<https://sse.local/dept/tech> <${SSE}name> "技术部" <${DATA}> .
<https://sse.local/dept/sales> <${RDF}type> <${SSE}Department> <${DATA}> .
<https://sse.local/dept/sales> <${SSE}name> "销售部" <${DATA}> .

<https://sse.local/item/i1> <${RDF}type> <${SSE}ExpenseItem> <${DATA}> .
<https://sse.local/item/i1> <${SSE}amount> "10.5"^^<${XSD}decimal> <${DATA}> .
<https://sse.local/item/i1> <${SSE}expenseDate> "2026-03-01"^^<${XSD}date> <${DATA}> .
<https://sse.local/item/i1> <${SSE}hasCategory> <https://sse.local/category/c1> <${DATA}> .
<https://sse.local/item/i2> <${RDF}type> <${SSE}ExpenseItem> <${DATA}> .
<https://sse.local/item/i2> <${SSE}amount> "20"^^<${XSD}decimal> <${DATA}> .
<https://sse.local/item/i2> <${SSE}expenseDate> "2026-04-01"^^<${XSD}date> <${DATA}> .
<https://sse.local/item/i2> <${SSE}hasCategory> <https://sse.local/category/c2> <${DATA}> .
<https://sse.local/item/i3> <${RDF}type> <${SSE}ExpenseItem> <${DATA}> .
<https://sse.local/item/i3> <${SSE}amount> "5"^^<${XSD}decimal> <${DATA}> .
<https://sse.local/item/i3> <${SSE}expenseDate> "2026-05-01"^^<${XSD}date> <${DATA}> .
<https://sse.local/item/i3> <${SSE}hasCategory> <https://sse.local/category/c1> <${DATA}> .
<https://sse.local/item/i4> <${RDF}type> <${SSE}ExpenseItem> <${DATA}> .
<https://sse.local/item/i4> <${SSE}amount> "99"^^<${XSD}decimal> <${DATA}> .
<https://sse.local/item/i4> <${SSE}expenseDate> "2025-12-31"^^<${XSD}date> <${DATA}> .
<https://sse.local/item/i4> <${SSE}hasCategory> <https://sse.local/category/c1> <${DATA}> .
<https://sse.local/item/i5> <${RDF}type> <${SSE}ExpenseItem> <${DATA}> .
<https://sse.local/item/i5> <${SSE}amount> "1"^^<${XSD}decimal> <${DATA}> .
<https://sse.local/item/i5> <${SSE}hasCategory> <https://sse.local/category/c1> <${DATA}> .

<https://sse.local/invoice/inv1> <${RDF}type> <${SSE}Invoice> <${DATA}> .
<https://sse.local/item/i1> <${SSE}hasInvoice> <https://sse.local/invoice/inv1> <${DATA}> .
<https://sse.local/invoice/inv2> <${RDF}type> <${SSE}Invoice> <${DATA}> .
<https://sse.local/item/i2> <${SSE}hasInvoice> <https://sse.local/invoice/inv2> <${DATA}> .

<https://sse.local/category/c1> <${RDF}type> <${SSE}ExpenseCategory> <${DATA}> .
<https://sse.local/category/c1> <${SSE}name> "差旅" <${DATA}> .
<https://sse.local/category/c2> <${RDF}type> <${SSE}ExpenseCategory> <${DATA}> .
<https://sse.local/category/c2> <${SSE}name> "餐饮" <${DATA}> .
`;

async function makeService(): Promise<OntologyQueryService> {
  const store = new MemoryGraphStore();
  await loadTBox(store);
  await store.load(NQ);
  return new OntologyQueryService(store);
}

async function makeServiceWith(nquads: string): Promise<OntologyQueryService> {
  const store = new MemoryGraphStore();
  await loadTBox(store);
  await store.load(nquads);
  return new OntologyQueryService(store);
}

function pagingNq(ids: string[]): string {
  return ids
    .map(
      (id) => `
<https://sse.local/report/${id}> <${RDF}type> <${SSE}ExpenseReport> <${DATA}> .
<https://sse.local/report/${id}> <${SSE}title> "Report ${id}" <${DATA}> .
<https://sse.local/report/${id}> <${SSE}status> "pending" <${DATA}> .
<https://sse.local/report/${id}> <${SSE}amount> "10"^^<${XSD}decimal> <${DATA}> .
`,
    )
    .join('');
}

const CROSS_DEPT_NQ = `
<https://sse.local/person/t1> <${RDF}type> <${SSE}Person> <${DATA}> .
<https://sse.local/person/t1> <${SSE}name> "技术员工" <${DATA}> .
<https://sse.local/person/t1> <${SSE}belongsTo> <https://sse.local/dept/tech> <${DATA}> .
<https://sse.local/person/s1> <${RDF}type> <${SSE}Person> <${DATA}> .
<https://sse.local/person/s1> <${SSE}name> "销售员工" <${DATA}> .
<https://sse.local/person/s1> <${SSE}belongsTo> <https://sse.local/dept/sales> <${DATA}> .

<https://sse.local/dept/tech> <${RDF}type> <${SSE}Department> <${DATA}> .
<https://sse.local/dept/tech> <${SSE}name> "技术部" <${DATA}> .
<https://sse.local/dept/sales> <${RDF}type> <${SSE}Department> <${DATA}> .
<https://sse.local/dept/sales> <${SSE}name> "销售部" <${DATA}> .

<https://sse.local/report/t1> <${RDF}type> <${SSE}ExpenseReport> <${DATA}> .
<https://sse.local/report/t1> <${SSE}status> "pending" <${DATA}> .
<https://sse.local/report/t1> <${SSE}submittedBy> <https://sse.local/person/t1> <${DATA}> .
<https://sse.local/report/s1> <${RDF}type> <${SSE}ExpenseReport> <${DATA}> .
<https://sse.local/report/s1> <${SSE}status> "pending" <${DATA}> .
<https://sse.local/report/s1> <${SSE}submittedBy> <https://sse.local/person/s1> <${DATA}> .

<https://sse.local/report/s1> <${SSE}hasApproval> <https://sse.local/approval/x> <${DATA}> .
<https://sse.local/approval/x> <${RDF}type> <${SSE}ApprovalRecord> <${DATA}> .
<https://sse.local/approval/x> <${SSE}approvedBy> <https://sse.local/person/t1> <${DATA}> .
`;

describe('OntologyQueryService', () => {
  it('filters reports by status and department', async () => {
    const svc = await makeService();
    const res = await svc.searchReports({
      status: 'pending',
      department: '技术部',
      scope: { kind: 'all' },
    });

    expect(res.total).toBe(1);
    expect(res.results.map((r) => r.id)).toEqual(['https://sse.local/report/r1']);
  });

  it('groups spend by category and excludes dated items outside the range', async () => {
    const svc = await makeService();
    const res = await svc.spendByCategory({
      from: '2026-01-01',
      to: '2026-12-31',
      scope: { kind: 'all' },
    });

    expect(res).toEqual([
      { category: '餐饮', total: 20, count: 1 },
      { category: '差旅', total: 16.5, count: 3 },
    ]);
  });

  it('applies department and self scope to spend aggregates', async () => {
    const svc = await makeService();

    const department = await svc.spendByCategory({
      from: '2026-01-01',
      to: '2026-12-31',
      department: '技术部',
      scope: { kind: 'all' },
    });
    expect(department).toEqual([{ category: '差旅', total: 16.5, count: 3 }]);

    const self = await svc.spendByCategory({
      from: '2026-01-01',
      to: '2026-12-31',
      scope: { kind: 'self', userId: 'p1' },
    });
    expect(self).toEqual([{ category: '差旅', total: 16.5, count: 3 }]);

    const denied = await svc.spendByCategory({
      from: '2026-01-01',
      to: '2026-12-31',
      scope: { kind: 'deny' },
    });
    expect(denied).toEqual([]);
  });

  it('applies all, department, self and deny scope to report searches', async () => {
    const svc = await makeService();

    const all = await svc.searchReports({ scope: { kind: 'all' } });
    expect(all.results.map((r) => r.id)).toEqual([
      'https://sse.local/report/r1',
      'https://sse.local/report/r2',
      'https://sse.local/report/r3',
    ]);

    const department = await svc.searchReports({
      scope: { kind: 'department', department: '技术部' },
    });
    expect(department.results.map((r) => r.id)).toEqual([
      'https://sse.local/report/r1',
      'https://sse.local/report/r3',
    ]);

    const self = await svc.searchReports({ scope: { kind: 'self', userId: 'p1' } });
    expect(self.results.map((r) => r.id)).toEqual([
      'https://sse.local/report/r1',
      'https://sse.local/report/r3',
    ]);

    const denied = await svc.searchReports({ scope: { kind: 'deny' } });
    expect(denied).toEqual({ results: [], total: 0 });
  });

  it('lists every data entity when no filters are supplied', async () => {
    const svc = await makeService();
    const res = await svc.listEntities({ scope: { kind: 'all' } });

    expect(res.total).toBeGreaterThan(0);
    expect(res.results.length).toBeGreaterThan(0);
    expect(res.results.some((entity) => entity.uri === 'https://sse.local/report/r1')).toBe(true);
    expect(res.results.some((entity) => entity.uri.startsWith(`${SSE}`))).toBe(false);
  });

  it('paginates distinct entities before loading property rows', async () => {
    const two = await makeServiceWith(pagingNq(['a', 'b']));
    const first = await two.listEntities({
      type: 'ExpenseReport',
      page: 1,
      pageSize: 2,
      scope: { kind: 'all' },
    });
    expect(first.total).toBe(2);
    expect(first.results.map((entity) => entity.uri)).toEqual([
      'https://sse.local/report/a',
      'https://sse.local/report/b',
    ]);
    expect(first.results.every((entity) => Object.keys(entity.properties).length === 3)).toBe(true);

    const second = await two.listEntities({
      type: 'ExpenseReport',
      page: 2,
      pageSize: 2,
      scope: { kind: 'all' },
    });
    expect(second).toEqual({ results: [], total: 2 });

    const three = await makeServiceWith(pagingNq(['a', 'b', 'c']));
    const pageOne = await three.listEntities({
      type: 'ExpenseReport',
      page: 1,
      pageSize: 2,
      scope: { kind: 'all' },
    });
    expect(pageOne.total).toBe(3);
    expect(pageOne.results.map((entity) => entity.uri)).toEqual([
      'https://sse.local/report/a',
      'https://sse.local/report/b',
    ]);

    const pageTwo = await three.listEntities({
      type: 'ExpenseReport',
      page: 2,
      pageSize: 2,
      scope: { kind: 'all' },
    });
    expect(pageTwo.total).toBe(3);
    expect(pageTwo.results.map((entity) => entity.uri)).toEqual(['https://sse.local/report/c']);
  });

  it('rejects invalid types instead of returning a server error', async () => {
    const svc = await makeService();
    await expect(
      svc.listEntities({ type: 'bad-type!', scope: { kind: 'all' } }),
    ).rejects.toBeInstanceOf(InvalidQueryError);
  });

  it('supports legacy report class filters without inferred graph triples', async () => {
    const svc = await makeService();

    const pending = await svc.listEntities({ type: 'PendingReport', scope: { kind: 'all' } });
    expect(pending.results.map((r) => r.uri)).toEqual([
      'https://sse.local/report/r1',
      'https://sse.local/report/r2',
    ]);
    expect(pending.results.every((r) => r.type === 'PendingReport')).toBe(true);

    const people = await svc.listEntities({ type: 'Person', scope: { kind: 'all' } });
    expect(people.results.map((r) => r.uri)).toEqual([
      'https://sse.local/person/p1',
      'https://sse.local/person/p2',
    ]);
    expect(people.results.every((r) => r.type === 'Person')).toBe(true);
  });

  it('enforces scope on entity detail and returns relations', async () => {
    const svc = await makeService();

    const report = await svc.getEntity('https://sse.local/report/r1', { kind: 'all' });
    expect(report).not.toBeNull();
    if (!report) throw new Error('expected report');
    expect(report.type).toBe('ExpenseReport');
    expect(report.properties.status).toBe('pending');
    expect(report.properties.title).toBe('差旅报销');
    expect(report.relations.outgoing).toEqual(
      expect.arrayContaining([
        { predicate: 'submittedBy', target: 'https://sse.local/person/p1' },
      ]),
    );

    expect(
      await svc.getEntity('https://sse.local/report/r2', { kind: 'self', userId: 'p1' }),
    ).toBeNull();
    expect(
      await svc.getEntity('https://sse.local/report/r1', {
        kind: 'department',
        department: '技术部',
      }),
    ).not.toBeNull();
    expect(
      await svc.getEntity('https://sse.local/report/r2', {
        kind: 'department',
        department: '技术部',
      }),
    ).toBeNull();
    expect(
      await svc.getEntity('https://evil.example/report/r1', { kind: 'all' }),
    ).toBeNull();
  });

  it('walks the network by direction and clamps depth', async () => {
    const svc = await makeService();

    const outgoing = await svc.network('https://sse.local/report/r1', {
      depth: 1,
      direction: 'out',
      scope: { kind: 'all' },
    });
    expect(outgoing.nodes.map((n) => n.uri).sort()).toEqual([
      'https://sse.local/item/i1',
      'https://sse.local/item/i5',
      'https://sse.local/person/p1',
      'https://sse.local/report/r1',
    ]);
    expect(outgoing.edges).toHaveLength(3);

    const incoming = await svc.network('https://sse.local/person/p1', {
      depth: 1,
      direction: 'in',
      scope: { kind: 'all' },
    });
    expect(incoming.nodes.map((n) => n.uri).sort()).toEqual([
      'https://sse.local/person/p1',
      'https://sse.local/report/r1',
      'https://sse.local/report/r3',
    ]);
    expect(incoming.edges.map((e) => e.predicate)).toEqual(['submittedBy', 'submittedBy']);

    const twoHops = await svc.network('https://sse.local/report/r1', {
      depth: 2,
      direction: 'out',
      scope: { kind: 'all' },
    });
    expect(twoHops.nodes.map((n) => n.uri)).toEqual(
      expect.arrayContaining([
        'https://sse.local/dept/tech',
        'https://sse.local/category/c1',
      ]),
    );

    const capped = await svc.network('https://sse.local/report/r1', {
      depth: 99,
      direction: 'out',
      scope: { kind: 'all' },
    });
    expect(capped.nodes.some((n) => n.uri === 'https://sse.local/dept/tech')).toBe(true);

    const denied = await svc.network('https://sse.local/report/r2', {
      depth: 2,
      scope: { kind: 'self', userId: 'p1' },
    });
    expect(denied).toEqual({ nodes: [], edges: [] });
  });

  it('drops out-of-scope neighbors during network traversal', async () => {
    const svc = await makeService();
    const self = await svc.network('https://sse.local/report/r1', {
      depth: 5,
      direction: 'both',
      scope: { kind: 'self', userId: 'p1' },
    });

    const uris = self.nodes.map((node) => node.uri);
    expect(uris).toContain('https://sse.local/report/r1');
    expect(uris).toContain('https://sse.local/person/p1');
    expect(uris).toContain('https://sse.local/item/i1');
    expect(uris).not.toContain('https://sse.local/person/p2');
    expect(uris).not.toContain('https://sse.local/report/r2');
    expect(self.edges.some((edge) => edge.from.includes('/r2') || edge.to.includes('/r2'))).toBe(false);
    expect(self.edges.some((edge) => edge.from.includes('/p2') || edge.to.includes('/p2'))).toBe(false);
  });

  it('drops cross-department neighbors during network traversal', async () => {
    const svc = await makeServiceWith(CROSS_DEPT_NQ);
    const network = await svc.network('https://sse.local/person/t1', {
      depth: 1,
      direction: 'both',
      scope: { kind: 'department', department: '技术部' },
    });

    const uris = network.nodes.map((node) => node.uri);
    expect(uris).toContain('https://sse.local/person/t1');
    expect(uris).toContain('https://sse.local/report/t1');
    expect(uris).toContain('https://sse.local/dept/tech');
    expect(uris).not.toContain('https://sse.local/approval/x');
    expect(uris).not.toContain('https://sse.local/report/s1');
    expect(uris).not.toContain('https://sse.local/person/s1');

    const crossDepartment = await svc.network('https://sse.local/report/s1', {
      depth: 2,
      scope: { kind: 'department', department: '技术部' },
    });
    expect(crossDepartment).toEqual({ nodes: [], edges: [] });
  });

  it('lets employees read their own items and invoices through the parent report', async () => {
    const svc = await makeService();
    const self = { kind: 'self', userId: 'p1' } as const;

    expect(await svc.getEntity('https://sse.local/item/i1', self)).not.toBeNull();
    expect(await svc.getEntity('https://sse.local/invoice/inv1', self)).not.toBeNull();
    expect(await svc.getEntity('https://sse.local/item/i2', self)).toBeNull();
    expect(await svc.getEntity('https://sse.local/invoice/inv2', self)).toBeNull();
  });

  it('rejects malformed IRIs but treats foreign IRIs as missing', async () => {
    const svc = await makeService();

    await expect(
      svc.network('not an iri', { depth: 1, scope: { kind: 'all' } }),
    ).rejects.toBeInstanceOf(InvalidQueryError);
    await expect(
      svc.getEntity('not an iri', { kind: 'all' }),
    ).rejects.toBeInstanceOf(InvalidQueryError);

    expect(
      await svc.network('https://evil.example/report/r1', { depth: 1, scope: { kind: 'all' } }),
    ).toEqual({ nodes: [], edges: [] });
    expect(await svc.getEntity('https://evil.example/report/r1', { kind: 'all' })).toBeNull();
  });

  it('reads classes and properties from the TBox', async () => {
    const svc = await makeService();
    const schema = await svc.schema();

    expect(schema.classes).toEqual(expect.arrayContaining(['ExpenseReport', 'PendingReport']));
    expect(schema.properties).toEqual(expect.arrayContaining(['status', 'submittedBy']));
  });

  it('reports graph-only status without a pool', async () => {
    const svc = await makeService();
    const status = await svc.status();

    expect(status.counts.quads).toBeGreaterThan(0);
    expect(status.counts.subjects).toBeGreaterThan(0);
    expect(status).toMatchObject({
      version: 0,
      outboxPending: 0,
      deadLettered: 0,
      lagSeconds: 0,
    });
  });

  it('reads outbox and snapshot status from the optional pool', async () => {
    const store = new MemoryGraphStore();
    await store.load(NQ);
    const calls: string[] = [];
    const svc = new OntologyQueryService(store, {
      query: async (sql: string) => {
        calls.push(sql);
        if (sql.includes('ontology_projector_state')) {
          return { rows: [{ last_snapshot_version: '4' }] };
        }
        return {
          rows: [{
            pending: '2',
            dead_lettered: '1',
            lag_seconds: '7.5',
            last_error: 'boom',
          }],
        };
      },
    });

    const status = await svc.status();
    expect(status).toMatchObject({
      version: 4,
      outboxPending: 2,
      deadLettered: 1,
      lagSeconds: 7.5,
    });
    expect(calls.some((sql) => sql.includes('ontology_outbox'))).toBe(true);
  });
});
