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

  it('times out a runaway query without killing the store', async () => {
    const store = new OxigraphStore(WORKER_PATH);
    await expect(store.query('SELECT * WHERE { ?s ?p ?o }', { timeoutMs: 1 })).rejects.toThrow(/timeout/i);
    const counts = await store.counts();
    expect(counts.quads).toBe(0);
    await store.close();
  });

  it('restores the full checkpoint (data + TBox) after a timeout respawn', async () => {
    const store = new OxigraphStore(WORKER_PATH);
    const dataQuad = '<https://sse.local/report/r1> <https://sse.local/ontology#status> "pending" <urn:sse:data> .\n';
    const filler = Array.from({ length: 100 }, (_, i) =>
      `<https://sse.local/report/f${i}> <https://sse.local/ontology#status> "pending" <urn:sse:data> .`,
    ).join('\n') + '\n';
    await store.load(dataQuad + filler);
    await store.load('<https://sse.local/Person> <http://www.w3.org/1999/02/22-rdf-syntax-ns#type> <http://www.w3.org/2002/07/owl#Class> <urn:sse:tbox> .\n');

    await expect(store.query(
      'SELECT * WHERE { ?a ?b ?c . ?d ?e ?f . ?g ?h ?i . ?j ?k ?l }',
      { timeoutMs: 1 },
    )).rejects.toThrow(/timeout/i);

    expect(store.needsRebuild()).toBe(true);
    const res = await store.query('SELECT ?o WHERE { <https://sse.local/report/r1> <https://sse.local/ontology#status> ?o }');
    expect(res).toEqual({ kind: 'select', rows: [{ o: 'pending' }] });
    await store.close();
  });
});
