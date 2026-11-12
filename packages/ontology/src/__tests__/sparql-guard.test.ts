import { assertConstructQuery, assertReadOnlySparql, capResults } from '../query/sparql-guard';

describe('assertReadOnlySparql', () => {
  it.each([
    'SELECT ?s WHERE { ?s ?p ?o }',
    'ASK { ?s ?p ?o }',
    'CONSTRUCT { ?s ?p ?o } WHERE { ?s ?p ?o }',
    'DESCRIBE <https://sse.local/report/r1>',
  ])('accepts read query: %s', (query) => {
    expect(() => assertReadOnlySparql(query)).not.toThrow();
  });

  it.each([
    'INSERT DATA { <https://sse.local/a> <https://sse.local/b> <https://sse.local/c> }',
    'DELETE WHERE { ?s ?p ?o }',
    'LOAD <https://evil.example/data>',
    'SELECT * WHERE { SERVICE <https://evil.example/sparql> { ?s ?p ?o } }',
  ])('rejects write/remote query: %s', (query) => {
    expect(() => assertReadOnlySparql(query)).toThrow();
  });
});

describe('assertConstructQuery', () => {
  it('accepts a read-only CONSTRUCT query', () => {
    expect(() => assertConstructQuery('CONSTRUCT { ?s ?p ?o } WHERE { ?s ?p ?o }')).not.toThrow();
  });

  it.each([
    'SELECT ?s WHERE { ?s ?p ?o }',
    'ASK { ?s ?p ?o }',
    'DESCRIBE <https://sse.local/report/r1>',
    'INSERT DATA { <https://sse.local/a> <https://sse.local/b> <https://sse.local/c> }',
    'CONSTRUCT { ?s ?p ?o } WHERE { SERVICE <https://evil.example/sparql> { ?s ?p ?o } }',
  ])('rejects non-CONSTRUCT or unsafe query: %s', (query) => {
    expect(() => assertConstructQuery(query)).toThrow();
  });
});

describe('capResults', () => {
  it('appends a LIMIT to SELECT queries without one', () => {
    expect(capResults('SELECT ?s WHERE { ?s ?p ?o }', 1000)).toMatch(/LIMIT 1000\s*$/);
  });

  it('clamps an existing larger LIMIT', () => {
    const capped = capResults('SELECT ?s WHERE { ?s ?p ?o } LIMIT 5000', 1000);
    expect(capped).toContain('LIMIT 1000');
    expect(capped).not.toContain('LIMIT 5000');
  });

  it('keeps an existing smaller LIMIT', () => {
    expect(capResults('SELECT ?s WHERE { ?s ?p ?o } LIMIT 5', 1000)).toMatch(/LIMIT 5/);
  });

  it('only caps SELECT queries', () => {
    const construct = 'CONSTRUCT { ?s ?p ?o } WHERE { ?s ?p ?o } LIMIT 5000';
    expect(capResults(construct, 1000)).toBe(construct);

    const ask = 'ASK { ?s ?p ?o }';
    expect(capResults(ask, 1000)).toBe(ask);
  });

  it('still appends an outer LIMIT when only a subquery has one', () => {
    const capped = capResults(
      'SELECT * WHERE { { SELECT * WHERE { ?s ?p ?o } LIMIT 5000 } }',
      1000,
    );
    expect(capped).toMatch(/LIMIT 1000\s*$/);
  });

  it('ignores a LIMIT hidden in a trailing comment', () => {
    const capped = capResults('SELECT ?s WHERE { ?s ?p ?o } # LIMIT 5000', 1000);
    expect(capped).toMatch(/LIMIT 1000\s*$/);
    expect(capped).not.toContain('# LIMIT 5000');
  });

  it('handles a leading comment before SELECT', () => {
    const capped = capResults('# leading comment\nSELECT ?s WHERE { ?s ?p ?o }', 1000);
    expect(capped).toMatch(/LIMIT 1000\s*$/);
  });

  it('does not treat a LIMIT inside a string literal as a clause', () => {
    const capped = capResults('SELECT ?s WHERE { ?s ?p "LIMIT 5000" }', 1000);
    expect(capped).toContain('"LIMIT 5000"');
    expect(capped).toMatch(/LIMIT 1000\s*$/);
  });
});
