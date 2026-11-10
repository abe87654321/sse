import { MemoryGraphStore } from '../graph/memory-store';

const NQ = `
<https://sse.local/report/r1> <https://sse.local/ontology#submittedBy> <https://sse.local/person/p1> <urn:sse:data> .
<https://sse.local/person/p1> <https://sse.local/ontology#belongsTo> <https://sse.local/dept/d1> <urn:sse:data> .
<https://sse.local/report/r1> <https://sse.local/ontology#status> "pending" <urn:sse:data> .
<https://sse.local/approval/a1> <https://sse.local/ontology#hasApproval> <https://sse.local/report/r1> <urn:sse:data> .
`;

describe('GraphStore', () => {
  it('supports joins and FILTER', async () => {
    const store = new MemoryGraphStore();
    await store.load(NQ);
    const res = await store.query(`
      SELECT ?report ?dept WHERE {
        ?report <https://sse.local/ontology#submittedBy> ?person .
        ?person <https://sse.local/ontology#belongsTo> ?dept .
        ?report <https://sse.local/ontology#status> "pending" .
      }
    `);
    expect(res.kind).toBe('select');
    if (res.kind !== 'select') throw new Error('expected select result');
    expect(res.rows).toEqual([
      { report: 'https://sse.local/report/r1', dept: 'https://sse.local/dept/d1' },
    ]);
  });

  it('supports FILTER, ORDER BY and LIMIT', async () => {
    const store = new MemoryGraphStore();
    await store.load(`${NQ}
<https://sse.local/report/r0> <https://sse.local/ontology#status> "pending" <urn:sse:data> .
<https://sse.local/report/r2> <https://sse.local/ontology#status> "approved" <urn:sse:data> .
`);
    const res = await store.query(`
      SELECT ?report ?status WHERE {
        ?report <https://sse.local/ontology#status> ?status .
        FILTER(?status = "pending")
      }
      ORDER BY ?report
      LIMIT 1
    `);
    if (res.kind !== 'select') throw new Error('expected select result');
    expect(res.rows).toEqual([{ report: 'https://sse.local/report/r0', status: 'pending' }]);
  });

  it('supports CONSTRUCT', async () => {
    const store = new MemoryGraphStore();
    await store.load(NQ);
    const res = await store.query(`
      CONSTRUCT { ?s <https://sse.local/ontology#hasStatus> ?o }
      WHERE { ?s <https://sse.local/ontology#status> ?o }
    `);
    if (res.kind !== 'construct') throw new Error('expected construct result');
    expect(res.quads.some(q => q.subject === 'https://sse.local/report/r1' && q.object === 'pending')).toBe(true);
  });

  it('supports ASK', async () => {
    const store = new MemoryGraphStore();
    await store.load(NQ);
    const res = await store.query(`
      ASK { <https://sse.local/report/r1> <https://sse.local/ontology#status> "pending" }
    `);
    expect(res).toEqual({ kind: 'ask', value: true });
  });

  it('replaces only owned predicates and keeps incoming edges', async () => {
    const store = new MemoryGraphStore();
    await store.load(NQ);
    await store.replaceEntity('https://sse.local/person/p1', [
      { subject: 'https://sse.local/person/p1', predicate: 'https://sse.local/ontology#name', object: 'Alice', objectType: 'literal', graph: 'urn:sse:data' },
      { subject: 'https://sse.local/person/p1', predicate: 'https://sse.local/ontology#belongsTo', object: 'https://sse.local/dept/d1', objectType: 'iri', graph: 'urn:sse:data' },
    ], [
      'https://sse.local/ontology#name',
      'https://sse.local/ontology#belongsTo',
    ]);
    const reportEdge = await store.query('SELECT ?r WHERE { GRAPH <urn:sse:data> { ?r <https://sse.local/ontology#submittedBy> <https://sse.local/person/p1> } }');
    if (reportEdge.kind !== 'select') throw new Error('expected select result');
    expect(reportEdge.rows).toHaveLength(1);
  });

  it('removes a stale owned predicate', async () => {
    const store = new MemoryGraphStore();
    await store.load(NQ);
    await store.replaceEntity('https://sse.local/person/p1', [
      { subject: 'https://sse.local/person/p1', predicate: 'https://sse.local/ontology#name', object: 'Alice', objectType: 'literal', graph: 'urn:sse:data' },
    ], [
      'https://sse.local/ontology#name',
      'https://sse.local/ontology#belongsTo',
    ]);
    const stale = await store.query('ASK { GRAPH <urn:sse:data> { <https://sse.local/person/p1> <https://sse.local/ontology#belongsTo> <https://sse.local/dept/d1> } }');
    expect(stale).toEqual({ kind: 'ask', value: false });
  });

  it('keeps outgoing predicates that are not owned by the projection', async () => {
    const store = new MemoryGraphStore();
    await store.load(`${NQ}
<https://sse.local/person/p1> <https://sse.local/ontology#role> "admin" <urn:sse:data> .
`);
    await store.replaceEntity('https://sse.local/person/p1', [
      { subject: 'https://sse.local/person/p1', predicate: 'https://sse.local/ontology#name', object: 'Alice', objectType: 'literal', graph: 'urn:sse:data' },
    ], ['https://sse.local/ontology#name']);
    const role = await store.query('SELECT ?o WHERE { GRAPH <urn:sse:data> { <https://sse.local/person/p1> <https://sse.local/ontology#role> ?o } }');
    if (role.kind !== 'select') throw new Error('expected select result');
    expect(role.rows).toEqual([{ o: 'admin' }]);
  });

  it('deletes a subject and its incoming edges', async () => {
    const store = new MemoryGraphStore();
    await store.load(NQ);
    await store.deleteSubject('https://sse.local/report/r1');
    const res = await store.query('SELECT ?s ?p ?o WHERE { GRAPH <urn:sse:data> { ?s ?p ?o } }');
    if (res.kind !== 'select') throw new Error('expected select result');
    expect(res.rows).toEqual([
      { s: 'https://sse.local/person/p1', p: 'https://sse.local/ontology#belongsTo', o: 'https://sse.local/dept/d1' },
    ]);
  });

  it('excludes urn:sse:history from bare queries but exposes it via GRAPH', async () => {
    const store = new MemoryGraphStore();
    await store.load(`${NQ}
<https://sse.local/report/history-only> <https://sse.local/ontology#status> "deleted" <urn:sse:history> .
`);
    const bare = await store.query('SELECT ?s ?p ?o WHERE { ?s ?p ?o }');
    if (bare.kind !== 'select') throw new Error('expected select result');
    expect(bare.rows.some(row => row.s === 'https://sse.local/report/history-only')).toBe(false);

    const explicit = await store.query(`
      SELECT ?o WHERE {
        GRAPH <urn:sse:history> { <https://sse.local/report/history-only> <https://sse.local/ontology#status> ?o }
      }
    `);
    if (explicit.kind !== 'select') throw new Error('expected select result');
    expect(explicit.rows).toEqual([{ o: 'deleted' }]);
  });

  it('writes one typed tombstone even when the subject is deleted twice', async () => {
    const store = new MemoryGraphStore();
    const subject = 'https://sse.local/report/r1';
    await store.load(NQ);
    await store.deleteSubject(subject);
    await store.deleteSubject(subject);

    const res = await store.query(`
      SELECT ?o ?dt WHERE {
        GRAPH <urn:sse:history> {
          <${subject}> <https://sse.local/ontology#deletedAt> ?o .
          BIND(DATATYPE(?o) AS ?dt)
        }
      }
    `);
    if (res.kind !== 'select') throw new Error('expected select result');
    expect(res.rows).toHaveLength(1);
    expect(res.rows[0].dt).toBe('http://www.w3.org/2001/XMLSchema#dateTime');
  });

  it('applies SPARQL UPDATE and dumps named graphs', async () => {
    const store = new MemoryGraphStore();
    await store.load(NQ);
    await store.update('INSERT DATA { GRAPH <urn:sse:data> { <https://sse.local/dept/d2> <https://sse.local/ontology#name> "Sales" } }');
    const dumped = await store.dump(['urn:sse:data']);
    expect(dumped).toContain('https://sse.local/dept/d2');
    expect(dumped).toContain('Sales');
    expect(dumped).not.toContain('urn:sse:tbox');
  });
});
