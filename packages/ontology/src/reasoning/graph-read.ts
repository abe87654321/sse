import { GRAPH, SSE, XSD, sse } from '../graph/namespaces';
import type { GraphQueryResult, GraphStore } from '../graph/types';
import { sparqlIri, sparqlString } from '../query/sparql-term';

const RDF_NS = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#';

export const PROLOGUE = [
  `PREFIX sse: <${SSE}>`,
  `PREFIX rdf: <${RDF_NS}>`,
  `PREFIX xsd: <${XSD}>`,
  '',
].join('\n');

export function rows(result: GraphQueryResult): Array<Record<string, string>> {
  return result.kind === 'select' ? result.rows : [];
}

export function localName(iri: string): string {
  const hash = iri.lastIndexOf('#');
  if (hash >= 0) return iri.slice(hash + 1);
  const slash = iri.lastIndexOf('/');
  return slash >= 0 ? iri.slice(slash + 1) : iri;
}

export function num(value: string | undefined): number | undefined {
  if (value === undefined || value === '') return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export interface EntityFacts {
  uri: string;
  literals: Map<string, string[]>;
  iris: Map<string, string[]>;
}

function add(map: Map<string, string[]>, key: string, value: string): void {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

/** Load all literal and IRI facts for one data-graph entity. */
export async function loadFacts(store: GraphStore, subject: string): Promise<EntityFacts> {
  const result = await store.query(`${PROLOGUE}
SELECT ?p ?o (isIRI(?o) AS ?isIri) WHERE {
  GRAPH <${GRAPH.data}> { ${sparqlIri(subject)} ?p ?o }
}`);
  const literals = new Map<string, string[]>();
  const iris = new Map<string, string[]>();
  for (const row of rows(result)) {
    if (!row.p || row.o === undefined) continue;
    const predicate = localName(row.p);
    if (row.isIri === 'true') add(iris, predicate, row.o);
    else add(literals, predicate, row.o);
  }
  return { uri: subject, literals, iris };
}

export function literal(facts: EntityFacts, predicate: string): string | undefined {
  return facts.literals.get(predicate)?.[0];
}

export function literalAll(facts: EntityFacts, predicate: string): string[] {
  return facts.literals.get(predicate) ?? [];
}

export function iris(facts: EntityFacts, predicate: string): string[] {
  return facts.iris.get(predicate) ?? [];
}

export function types(facts: EntityFacts): string[] {
  return iris(facts, 'type').map(localName);
}

export function hasType(facts: EntityFacts, className: string): boolean {
  return types(facts).includes(className);
}

export async function selectRows(store: GraphStore, sparql: string): Promise<Array<Record<string, string>>> {
  return rows(await store.query(sparql));
}

export async function ask(store: GraphStore, sparql: string): Promise<boolean> {
  const result = await store.query(sparql);
  return result.kind === 'ask' && result.value;
}

/** True when at least one active person holds the role in the data graph. */
export async function activeRoleExists(store: GraphStore, role: string): Promise<boolean> {
  return ask(store, `${PROLOGUE}
ASK {
  GRAPH <${GRAPH.data}> {
    ?person rdf:type <${sse('Person')}> ;
            <${sse('role')}> ${sparqlString(role)} ;
            <${sse('status')}> "active" .
  }
}`);
}

export async function resolveCategory(
  store: GraphStore,
  input: { categoryId?: string; categoryName?: string },
): Promise<{ id: string; uri: string; name: string } | null> {
  if (input.categoryId) {
    const subject = `https://sse.local/category/${input.categoryId}`;
    const facts = await loadFacts(store, subject);
    const name = literal(facts, 'name');
    return name === undefined ? null : { id: input.categoryId, uri: subject, name };
  }

  if (input.categoryName) {
    const query = `${PROLOGUE}
SELECT ?category ?name WHERE {
  GRAPH <${GRAPH.data}> {
    ?category rdf:type <${sse('ExpenseCategory')}> ; <${sse('name')}> ?name .
    FILTER(CONTAINS(LCASE(STR(?name)), LCASE(${sparqlString(input.categoryName)})))
  }
}
ORDER BY ?category
LIMIT 1`;
    const [row] = await selectRows(store, query);
    if (!row?.category) return null;
    return { id: localName(row.category), uri: row.category, name: row.name ?? '' };
  }

  return null;
}
