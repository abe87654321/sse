import { Store, DataFactory } from 'n3';
import { executeSparql } from '../sparql';

const { namedNode, literal } = DataFactory;
const RDF_TYPE = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type';
const BASE = 'https://sse.local/ontology#';

function buildStore(count: number): Store {
  const store = new Store();
  for (let i = 0; i < count; i++) {
    const subject = namedNode(`https://sse.local/person/${i}`);
    store.addQuad(subject, namedNode(RDF_TYPE), namedNode(`${BASE}Person`));
    store.addQuad(subject, namedNode(`${BASE}name`), literal(`P${i}`));
  }
  return store;
}

describe('executeSparql guards', () => {
  it('returns matches for a basic SELECT', () => {
    const store = buildStore(2);
    const rows = executeSparql(store, 'SELECT ?s ?p ?o WHERE { ?s ?p ?o }');
    expect(rows.length).toBe(4);
    expect(rows[0]).toHaveProperty('?s');
    expect(rows[0]).toHaveProperty('?p');
    expect(rows[0]).toHaveProperty('?o');
  });

  it('rejects non-SELECT statements', () => {
    const store = buildStore(1);
    expect(() => executeSparql(store, 'DELETE WHERE { ?s ?p ?o }')).toThrow(/SELECT/);
  });

  it('rejects oversized queries', () => {
    const store = buildStore(1);
    const long = `SELECT ?s ?p ?o WHERE { ?s ?p ?o } # ${'x'.repeat(50)}`;
    expect(() => executeSparql(store, long, { maxQueryLength: 10 })).toThrow(/过长/);
  });

  it('caps results at maxResults', () => {
    const store = buildStore(5);
    const rows = executeSparql(store, 'SELECT ?s ?p ?o WHERE { ?s ?p ?o }', { maxResults: 3 });
    expect(rows.length).toBe(3);
  });

  it('honours a smaller explicit LIMIT', () => {
    const store = buildStore(5);
    const rows = executeSparql(store, 'SELECT ?s ?p ?o WHERE { ?s ?p ?o } LIMIT 2', { maxResults: 100 });
    expect(rows.length).toBe(2);
  });

  it('rejects too many graph patterns', () => {
    const store = buildStore(1);
    const query = 'SELECT ?a ?b ?c WHERE { ?a ?b ?c . ?c ?a ?b . ?b ?c ?a }';
    expect(() => executeSparql(store, query, { maxPatterns: 1 })).toThrow(/图模式过多/);
  });
});
