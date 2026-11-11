import { join } from 'path';
import { OxigraphStore } from '../graph/oxigraph-store';

const WORKER_PATH = join(__dirname, '../../dist/graph/oxigraph-worker.js');

describe('OxigraphStore', () => {
  it('runs a join and returns typed select rows', async () => {
    const store = new OxigraphStore(WORKER_PATH);
    await store.load(`
<https://sse.local/report/r1> <https://sse.local/ontology#submittedBy> <https://sse.local/person/p1> <urn:sse:data> .
<https://sse.local/person/p1> <https://sse.local/ontology#belongsTo> <https://sse.local/dept/d1> <urn:sse:data> .
`);
    const res = await store.query(`
      SELECT ?report ?dept WHERE {
        ?report <https://sse.local/ontology#submittedBy> ?person .
        ?person <https://sse.local/ontology#belongsTo> ?dept .
      }
    `);
    expect(res).toEqual({
      kind: 'select',
      rows: [{ report: 'https://sse.local/report/r1', dept: 'https://sse.local/dept/d1' }],
    });
    await store.close();
  });

  it('recovers from a real runaway query and restores the checkpoint', async () => {
    const store = new OxigraphStore(WORKER_PATH);
    const filler = Array.from({ length: 50_000 }, (_, i) =>
      `<https://sse.local/report/f${i}> <https://sse.local/ontology#status> "pending" <urn:sse:data> .`,
    ).join('\n') + '\n';
    await store.load(filler);

    await expect(store.query(
      'SELECT * WHERE { ?a ?b ?c . ?d ?e ?f . ?g ?h ?i }',
      { timeoutMs: 10 },
    )).rejects.toThrow(/timeout/i);

    expect(store.needsRebuild()).toBe(true);
    const res = await store.query(
      'SELECT ?o WHERE { <https://sse.local/report/f49999> <https://sse.local/ontology#status> ?o }',
    );
    expect(res).toEqual({ kind: 'select', rows: [{ o: 'pending' }] });
    await store.close();
  });

  it('uses ONTOLOGY_GRAPH_CALL_TIMEOUT_MS for internal queries', async () => {
    const original = process.env.ONTOLOGY_GRAPH_CALL_TIMEOUT_MS;
    const store = new OxigraphStore(WORKER_PATH);
    try {
      const filler = Array.from({ length: 50_000 }, (_, i) =>
        `<https://sse.local/report/g${i}> <https://sse.local/ontology#status> "pending" <urn:sse:data> .`,
      ).join('\n') + '\n';
      await store.load(filler);

      // Set the budget after the fixture load: callTimeoutMs() also governs
      // load/update, and loading 50k quads is expected to exceed 10ms.
      process.env.ONTOLOGY_GRAPH_CALL_TIMEOUT_MS = '10';
      await expect(
        store.query('SELECT * WHERE { ?a ?b ?c . ?d ?e ?f . ?g ?h ?i }'),
      ).rejects.toThrow(/timeout/i);
    } finally {
      await store.close();
      if (original === undefined) delete process.env.ONTOLOGY_GRAPH_CALL_TIMEOUT_MS;
      else process.env.ONTOLOGY_GRAPH_CALL_TIMEOUT_MS = original;
    }
  });

  it('excludes urn:sse:history from bare queries but exposes it via GRAPH', async () => {
    const store = new OxigraphStore(WORKER_PATH);
    await store.load(`
<https://sse.local/report/history-only> <https://sse.local/ontology#status> "deleted" <urn:sse:history> .
<https://sse.local/report/r1> <https://sse.local/ontology#status> "pending" <urn:sse:data> .
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
    await store.close();
  });

  it('round-trips a dump through replaceAll', async () => {
    const source = new OxigraphStore(WORKER_PATH);
    await source.load(`
<https://sse.local/report/r1> <https://sse.local/ontology#status> "pending" <urn:sse:data> .
<https://sse.local/report/r1> <https://sse.local/ontology#deletedAt> "2026-11-01T00:00:00Z"^^<http://www.w3.org/2001/XMLSchema#dateTime> <urn:sse:history> .
`);
    const dumped = await source.dump(['urn:sse:data', 'urn:sse:history']);
    await source.close();
    expect(dumped).toContain('urn:sse:data');
    expect(dumped).toContain('urn:sse:history');

    const target = new OxigraphStore(WORKER_PATH);
    await target.replaceAll(dumped);

    const data = await target.query(
      'SELECT ?o WHERE { GRAPH <urn:sse:data> { <https://sse.local/report/r1> <https://sse.local/ontology#status> ?o } }',
    );
    expect(data).toEqual({ kind: 'select', rows: [{ o: 'pending' }] });

    const history = await target.query(
      'ASK { GRAPH <urn:sse:history> { <https://sse.local/report/r1> <https://sse.local/ontology#deletedAt> ?o } }',
    );
    expect(history).toEqual({ kind: 'ask', value: true });
    await target.close();
  });

  it('writes one typed tombstone even when the subject is deleted twice', async () => {
    const store = new OxigraphStore(WORKER_PATH);
    const subject = 'https://sse.local/report/r1';
    await store.load(`<${subject}> <https://sse.local/ontology#status> "pending" <urn:sse:data> .\n`);
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
    await store.close();
  });
});
