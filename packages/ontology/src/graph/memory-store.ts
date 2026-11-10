import oxigraph from 'oxigraph';
import type { GraphCounts, GraphQueryResult, GraphStore, ProjectedQuad } from './types';
import { GRAPH } from './namespaces';

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
    const raw = this.store.query(sparql, { use_default_graph_as_union: true });
    if (typeof raw === 'boolean') return { kind: 'ask', value: raw };
    if (Array.isArray(raw)) {
      return {
        kind: 'select',
        rows: (raw as Array<Map<string, any>>).map((binding) => {
          const row: Record<string, string> = {};
          for (const [k, v] of binding) row[k] = v.value;
          return row;
        }),
      };
    }
    return { kind: 'construct', quads: Array.from(raw).map(fromQuad) };
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
    this.store.update(`INSERT DATA { GRAPH <${GRAPH.history}> { <${subject}> <https://sse.local/ontology#deletedAt> "${new Date().toISOString()}" } }`);
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
