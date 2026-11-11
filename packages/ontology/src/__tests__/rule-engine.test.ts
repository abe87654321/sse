import { MemoryGraphStore } from '../graph/memory-store';
import { RDF_TYPE, XSD, sse } from '../graph/namespaces';
import { RuleEngine, serializeConstructQuad } from '../reasoning/rule-engine';

const DATA = 'urn:sse:data';
const INFERRED = 'urn:sse:inferred';

function poolWith(rules: Array<{ id: string; construct_query: string }>) {
  return {
    query: async () => ({ rows: rules }),
  };
}

function legacyRule(status: string, className: string) {
  return {
    id: `legacy-${status}`,
    construct_query:
      `CONSTRUCT { ?r a <${sse(className)}> } WHERE { ` +
      `GRAPH <${DATA}> { ?r a <${sse('ExpenseReport')}> ; <${sse('status')}> "${status}" } }`,
  };
}

describe('RuleEngine', () => {
  it('materializes legacy status classes idempotently', async () => {
    const store = new MemoryGraphStore();
    await store.load(`
<https://sse.local/report/r1> <${RDF_TYPE}> <${sse('ExpenseReport')}> <${DATA}> .
<https://sse.local/report/r1> <${sse('status')}> "pending" <${DATA}> .
`);

    const engine = new RuleEngine(
      store,
      poolWith([legacyRule('pending', 'PendingReport')]) as any,
    );

    const first = await engine.materialize();
    const second = await engine.materialize();

    expect(first).toBe(1);
    expect(second).toBe(1);

    const res = await store.query(
      `SELECT ?r WHERE { GRAPH <${INFERRED}> { ?r a <${sse('PendingReport')}> } }`,
    );
    if (res.kind !== 'select') throw new Error('expected select');
    expect(res.rows).toEqual([{ r: 'https://sse.local/report/r1' }]);
  });

  it('materializes every legacy status class', async () => {
    const store = new MemoryGraphStore();
    const statuses = [
      ['draft', 'DraftReport'],
      ['pending', 'PendingReport'],
      ['approved', 'ApprovedReport'],
      ['rejected', 'RejectedReport'],
      ['paid', 'PaidReport'],
    ] as const;

    await store.load(
      statuses
        .map(
          ([status, ,], index) =>
            `<https://sse.local/report/${index}> <${RDF_TYPE}> <${sse('ExpenseReport')}> <${DATA}> .\n` +
            `<https://sse.local/report/${index}> <${sse('status')}> "${status}" <${DATA}> .`,
        )
        .join('\n'),
    );

    const engine = new RuleEngine(
      store,
      poolWith(statuses.map(([status, cls]) => legacyRule(status, cls))) as any,
    );

    expect(await engine.materialize()).toBe(5);

    for (const [, cls] of statuses) {
      const res = await store.query(
        `SELECT ?r WHERE { GRAPH <${INFERRED}> { ?r a <${sse(cls)}> } }`,
      );
      if (res.kind !== 'select') throw new Error('expected select');
      expect(res.rows).toHaveLength(1);
    }
  });

  it('preserves xsd:decimal datatypes through CONSTRUCT materialization', async () => {
    const store = new MemoryGraphStore();
    await store.load(`
<https://sse.local/report/r1> <${RDF_TYPE}> <${sse('ExpenseReport')}> <${DATA}> .
<https://sse.local/report/r1> <${sse('amount')}> "120.50"^^<${XSD}decimal> <${DATA}> .
`);

    const engine = new RuleEngine(
      store,
      poolWith([
        {
          id: 'copy-amount',
          construct_query:
            `CONSTRUCT { ?r <${sse('amountCopy')}> ?amount } WHERE { ` +
            `GRAPH <${DATA}> { ?r <${sse('amount')}> ?amount } }`,
        },
      ]) as any,
    );

    await engine.materialize();

    const res = await store.query(`
      SELECT ?copy ?datatype WHERE {
        GRAPH <${INFERRED}> { <https://sse.local/report/r1> <${sse('amountCopy')}> ?copy }
        BIND(DATATYPE(?copy) AS ?datatype)
      }
    `);
    if (res.kind !== 'select') throw new Error('expected select');
    expect(res.rows).toHaveLength(1);
    expect(Number(res.rows[0].copy)).toBe(120.5);
    expect(res.rows[0].datatype).toBe(`${XSD}decimal`);
  });

  it('preserves language tags through CONSTRUCT materialization', async () => {
    const store = new MemoryGraphStore();
    await store.load(`
<https://sse.local/report/r1> <${RDF_TYPE}> <${sse('ExpenseReport')}> <${DATA}> .
<https://sse.local/report/r1> <${sse('label')}> "bonjour"@fr <${DATA}> .
`);

    const engine = new RuleEngine(
      store,
      poolWith([
        {
          id: 'copy-label',
          construct_query:
            `CONSTRUCT { ?r <${sse('labelCopy')}> ?label } WHERE { ` +
            `GRAPH <${DATA}> { ?r <${sse('label')}> ?label } }`,
        },
      ]) as any,
    );

    await engine.materialize();

    const res = await store.query(`
      SELECT ?copy ?lang WHERE {
        GRAPH <${INFERRED}> { <https://sse.local/report/r1> <${sse('labelCopy')}> ?copy }
        BIND(LANG(?copy) AS ?lang)
      }
    `);
    if (res.kind !== 'select') throw new Error('expected select');
    expect(res.rows).toEqual([{ copy: 'bonjour', lang: 'fr' }]);
  });

  it('keeps the inferred graph consistent when one rule fails', async () => {
    const store = new MemoryGraphStore();
    await store.load(`
<https://sse.local/report/r1> <${RDF_TYPE}> <${sse('ExpenseReport')}> <${DATA}> .
<https://sse.local/report/r1> <${sse('status')}> "pending" <${DATA}> .
`);

    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const engine = new RuleEngine(
      store,
      poolWith([
        {
          id: 'broken-rule',
          construct_query:
            `CONSTRUCT { ?r a <${sse('BrokenReport')}> } WHERE { ` +
            `GRAPH <${DATA}> { ?r a <${sse('ExpenseReport')}> . THIS IS NOT SPARQL`,
        },
        legacyRule('pending', 'PendingReport'),
      ]) as any,
    );

    const total = await engine.materialize();
    expect(total).toBe(1);
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('broken-rule'));

    const inferred = await store.query(
      `SELECT ?r ?p ?o WHERE { GRAPH <${INFERRED}> { ?r ?p ?o } }`,
    );
    if (inferred.kind !== 'select') throw new Error('expected select');
    expect(inferred.rows).toHaveLength(1);
    expect(inferred.rows[0]).toMatchObject({
      p: RDF_TYPE,
      o: sse('PendingReport'),
    });

    errorSpy.mockRestore();
  });

  it('clears stale inferred data before evaluating rules so repeated runs are stable', async () => {
    const store = new MemoryGraphStore();
    await store.load(`
<https://sse.local/report/r1> <${RDF_TYPE}> <${sse('ExpenseReport')}> <${DATA}> .
<https://sse.local/report/r1> <${sse('status')}> "pending" <${DATA}> .
`);

    const engine = new RuleEngine(
      store,
      poolWith([
        {
          id: 'infer-pending-once',
          construct_query:
            `CONSTRUCT { ?r a <${sse('PendingReport')}> } WHERE { ` +
            `GRAPH <${DATA}> { ?r a <${sse('ExpenseReport')}> ; <${sse('status')}> "pending" } ` +
            `FILTER NOT EXISTS { GRAPH <${INFERRED}> { ?r a <${sse('PendingReport')}> } } }`,
        },
      ]) as any,
    );

    const first = await engine.materialize();
    const afterFirst = await store.query(
      `SELECT ?r WHERE { GRAPH <${INFERRED}> { ?r a <${sse('PendingReport')}> } }`,
    );
    const second = await engine.materialize();
    const afterSecond = await store.query(
      `SELECT ?r WHERE { GRAPH <${INFERRED}> { ?r a <${sse('PendingReport')}> } }`,
    );

    expect(first).toBe(1);
    expect(second).toBe(1);
    if (afterFirst.kind !== 'select' || afterSecond.kind !== 'select') {
      throw new Error('expected select');
    }
    expect(afterFirst.rows).toHaveLength(1);
    expect(afterSecond.rows).toEqual(afterFirst.rows);
  });

  it('lets a later rule consume conclusions from an earlier rule in the same cycle', async () => {
    const store = new MemoryGraphStore();
    await store.load(`
<https://sse.local/report/r1> <${RDF_TYPE}> <${sse('ExpenseReport')}> <${DATA}> .
<https://sse.local/report/r1> <${sse('status')}> "pending" <${DATA}> .
`);

    const engine = new RuleEngine(
      store,
      poolWith([
        legacyRule('pending', 'PendingReport'),
        {
          id: 'infer-reviewable',
          construct_query:
            `CONSTRUCT { ?r a <${sse('Reviewable')}> } WHERE { ` +
            `GRAPH <${INFERRED}> { ?r a <${sse('PendingReport')}> } }`,
        },
      ]) as any,
    );

    expect(await engine.materialize()).toBe(2);

    const res = await store.query(
      `SELECT ?class WHERE { GRAPH <${INFERRED}> { <https://sse.local/report/r1> a ?class } }`,
    );
    if (res.kind !== 'select') throw new Error('expected select');
    expect(res.rows.map((row) => row.class).sort()).toEqual(
      [sse('PendingReport'), sse('Reviewable')].sort(),
    );
  });

  it('logs a failing rule and still materializes later chained rules', async () => {
    const store = new MemoryGraphStore();
    await store.load(`
<https://sse.local/report/r1> <${RDF_TYPE}> <${sse('ExpenseReport')}> <${DATA}> .
<https://sse.local/report/r1> <${sse('status')}> "pending" <${DATA}> .
`);

    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const engine = new RuleEngine(
      store,
      poolWith([
        {
          id: 'broken-rule',
          construct_query:
            `CONSTRUCT { ?r a <${sse('BrokenReport')}> } WHERE { ` +
            `GRAPH <${DATA}> { ?r a <${sse('ExpenseReport')}> . THIS IS NOT SPARQL`,
        },
        legacyRule('pending', 'PendingReport'),
        {
          id: 'infer-reviewable',
          construct_query:
            `CONSTRUCT { ?r a <${sse('Reviewable')}> } WHERE { ` +
            `GRAPH <${INFERRED}> { ?r a <${sse('PendingReport')}> } }`,
        },
      ]) as any,
    );

    expect(await engine.materialize()).toBe(2);
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('broken-rule'));

    const res = await store.query(
      `SELECT ?class WHERE { GRAPH <${INFERRED}> { <https://sse.local/report/r1> a ?class } }`,
    );
    if (res.kind !== 'select') throw new Error('expected select');
    expect(res.rows.map((row) => row.class).sort()).toEqual(
      [sse('PendingReport'), sse('Reviewable')].sort(),
    );

    errorSpy.mockRestore();
  });

  it('escapes literal quotes and newlines when serializing', () => {
    const statement = serializeConstructQuad({
      subject: 'https://sse.local/report/r1',
      predicate: sse('title'),
      object: 'a "quoted"\nline',
      objectType: 'literal',
      datatype: `${XSD}string`,
      graph: INFERRED,
    });

    expect(statement).toBe(
      `<https://sse.local/report/r1> <${sse('title')}> "a \\"quoted\\"\\nline" .`,
    );
  });
});
