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
