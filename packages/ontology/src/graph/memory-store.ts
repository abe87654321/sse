import oxigraph from 'oxigraph';
import { isConstructQuery, type GraphCounts, type GraphQueryResult, type GraphStore, type ProjectedQuad } from './types';
import { GRAPH, XSD, sse } from './namespaces';

const DEFAULT_GRAPHS = [GRAPH.tbox, GRAPH.data, GRAPH.inferred, GRAPH.manual]
  .map(name => oxigraph.namedNode(name));

function toQuad(q: ProjectedQuad) {
  const subject = oxigraph.namedNode(q.subject);
  const predicate = oxigraph.namedNode(q.predicate);
  const object = q.objectType === 'iri'
    ? oxigraph.namedNode(q.object)
    : oxigraph.literal(
      q.object,
      q.language ? { language: q.language } : q.datatype ? oxigraph.namedNode(q.datatype) : undefined,
    );
  return oxigraph.quad(subject, predicate, object, oxigraph.namedNode(q.graph));
}

function fromQuad(q: any): ProjectedQuad {
  return {
    subject: q.subject.value,
    predicate: q.predicate.value,
    object: q.object.value,
    objectType: q.object.termType === 'NamedNode' ? 'iri' : 'literal',
    datatype: q.object.datatype?.value,
    language: q.object.language || undefined,
    graph: q.graph.value,
  };
}

export class MemoryGraphStore implements GraphStore {
  private store = new oxigraph.Store();
  private snapshot = '';

  async load(nquads: string): Promise<void> {
    this.store.load(nquads, { format: 'application/n-quads' });
    this.snapshot = nquads;
  }

  async replaceAll(nquads: string): Promise<void> {
    this.store = new oxigraph.Store();
    await this.load(nquads);
  }

  async dump(graphs: string[]): Promise<string> {
    const quads = this.store.match(null, null, null, null).filter((q: any) => graphs.includes(q.graph.value));
    return quads.map((q: any) => q.toString()).join('\n') + (quads.length ? '\n' : '');
  }

  async query(sparql: string): Promise<GraphQueryResult> {
    const raw = this.store.query(sparql, { default_graph: DEFAULT_GRAPHS });
    if (typeof raw === 'boolean') return { kind: 'ask', value: raw };
    if (isConstructQuery(sparql)) {
      return { kind: 'construct', quads: Array.from(raw as Iterable<any>).map(fromQuad) };
    }
    return {
      kind: 'select',
      rows: (raw as Array<Map<string, any>>).map((binding) => {
        const row: Record<string, string> = {};
        for (const [k, v] of binding) row[k] = v.value;
        return row;
      }),
    };
  }

  async update(sparql: string): Promise<void> {
    this.store.update(sparql);
  }

  async replaceEntity(subject: string, quads: ProjectedQuad[], ownedPredicates: string[]): Promise<void> {
    for (const predicate of ownedPredicates) {
      this.store.update(`DELETE WHERE { GRAPH <${GRAPH.data}> { <${subject}> <${predicate}> ?o } }`);
    }
    for (const q of quads) this.store.add(toQuad(q));
  }

  async addRelation(from: string, predicate: string, to: string): Promise<void> {
    this.store.add(toQuad({ subject: from, predicate, object: to, objectType: 'iri', graph: GRAPH.data }));
  }

  async removeRelation(from: string, predicate: string, to: string): Promise<void> {
    this.store.update(`DELETE DATA { GRAPH <${GRAPH.data}> { <${from}> <${predicate}> <${to}> } }`);
  }

  async deleteSubject(subject: string): Promise<void> {
    this.store.update(`DELETE WHERE { GRAPH <${GRAPH.data}> { <${subject}> ?p ?o } }`);
    this.store.update(`DELETE WHERE { GRAPH <${GRAPH.data}> { ?s ?p <${subject}> } }`);
    this.store.update(`DELETE WHERE { GRAPH <${GRAPH.history}> { <${subject}> <${sse('deletedAt')}> ?o } }`);
    this.store.update(
      `INSERT DATA { GRAPH <${GRAPH.history}> { <${subject}> <${sse('deletedAt')}> "${new Date().toISOString()}"^^<${XSD}dateTime> } }`,
    );
  }

  checkpoint(nquads: string): void {
    this.snapshot = nquads;
  }

  needsRebuild(): boolean {
    return false;
  }

  async counts(): Promise<GraphCounts> {
    const quads = this.store.match(null, null, null, null);
    return { quads: quads.length, subjects: new Set(quads.map((q: any) => q.subject.value)).size };
  }

  async close(): Promise<void> {}
}
