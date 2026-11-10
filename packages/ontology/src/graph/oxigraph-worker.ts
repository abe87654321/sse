import { parentPort } from 'node:worker_threads';
import oxigraph from 'oxigraph';
import { isConstructQuery, type ProjectedQuad } from './types';
import { GRAPH, XSD, sse } from './namespaces';

const store = new oxigraph.Store();

const DEFAULT_GRAPHS = [
  oxigraph.namedNode(GRAPH.tbox),
  oxigraph.namedNode(GRAPH.data),
  oxigraph.namedNode(GRAPH.inferred),
  oxigraph.namedNode(GRAPH.manual),
];

function toQuad(q: ProjectedQuad) {
  return oxigraph.quad(
    oxigraph.namedNode(q.subject),
    oxigraph.namedNode(q.predicate),
    q.objectType === 'iri'
      ? oxigraph.namedNode(q.object)
      : oxigraph.literal(
        q.object,
        q.language ? { language: q.language } : q.datatype ? oxigraph.namedNode(q.datatype) : undefined,
      ),
    oxigraph.namedNode(q.graph),
  );
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

function writeTombstone(subject: string): void {
  store.update(`DELETE WHERE { GRAPH <${GRAPH.history}> { <${subject}> <${sse('deletedAt')}> ?o } }`);
  store.update(
    `INSERT DATA { GRAPH <${GRAPH.history}> { <${subject}> <${sse('deletedAt')}> "${new Date().toISOString()}"^^<${XSD}dateTime> } }`,
  );
}

parentPort!.on('message', (msg: any) => {
  try {
    switch (msg.type) {
      case 'load':
        store.load(msg.nquads, { format: 'application/n-quads' });
        parentPort!.postMessage({ id: msg.id, ok: true });
        break;
      case 'replaceAll':
        store.update('CLEAR ALL');
        store.load(msg.nquads, { format: 'application/n-quads' });
        parentPort!.postMessage({ id: msg.id, ok: true });
        break;
      case 'dump': {
        const quads = store.match(null, null, null, null).filter((q: any) => msg.graphs.includes(q.graph.value));
        parentPort!.postMessage({ id: msg.id, ok: true, result: quads.map((q: any) => q.toString()).join('\n') + (quads.length ? '\n' : '') });
        break;
      }
      case 'update':
        store.update(msg.sparql);
        parentPort!.postMessage({ id: msg.id, ok: true });
        break;
      case 'query': {
        const raw = store.query(msg.sparql, { default_graph: DEFAULT_GRAPHS });
        if (typeof raw === 'boolean') {
          parentPort!.postMessage({ id: msg.id, ok: true, result: { kind: 'ask', value: raw } });
        } else if (isConstructQuery(msg.sparql)) {
          parentPort!.postMessage({ id: msg.id, ok: true, result: { kind: 'construct', quads: Array.from(raw as Iterable<any>).map(fromQuad) } });
        } else {
          parentPort!.postMessage({
            id: msg.id,
            ok: true,
            result: {
              kind: 'select',
              rows: (raw as Array<Map<string, any>>).map((binding) => {
                const row: Record<string, string> = {};
                for (const [k, v] of binding) row[k] = v.value;
                return row;
              }),
            },
          });
        }
        break;
      }
      case 'replaceEntity':
        for (const predicate of msg.ownedPredicates) {
          store.update(`DELETE WHERE { GRAPH <${GRAPH.data}> { <${msg.subject}> <${predicate}> ?o } }`);
        }
        for (const q of msg.quads) store.add(toQuad(q));
        parentPort!.postMessage({ id: msg.id, ok: true });
        break;
      case 'addRelation':
        store.add(toQuad({ subject: msg.from, predicate: msg.predicate, object: msg.to, objectType: 'iri', graph: GRAPH.data }));
        parentPort!.postMessage({ id: msg.id, ok: true });
        break;
      case 'removeRelation':
        store.update(`DELETE DATA { GRAPH <${GRAPH.data}> { <${msg.from}> <${msg.predicate}> <${msg.to}> } }`);
        parentPort!.postMessage({ id: msg.id, ok: true });
        break;
      case 'delete':
        store.update(`DELETE WHERE { GRAPH <${GRAPH.data}> { <${msg.subject}> ?p ?o } }`);
        store.update(`DELETE WHERE { GRAPH <${GRAPH.data}> { ?s ?p <${msg.subject}> } }`);
        writeTombstone(msg.subject);
        parentPort!.postMessage({ id: msg.id, ok: true });
        break;
      case 'counts': {
        const quads = store.match(null, null, null, null);
        parentPort!.postMessage({ id: msg.id, ok: true, result: { quads: quads.length, subjects: new Set(quads.map((q: any) => q.subject.value)).size } });
        break;
      }
      default:
        parentPort!.postMessage({ id: msg.id, ok: false, error: `unknown message ${msg.type}` });
    }
  } catch (err: any) {
    parentPort!.postMessage({ id: msg.id, ok: false, error: err.message || String(err) });
  }
});
