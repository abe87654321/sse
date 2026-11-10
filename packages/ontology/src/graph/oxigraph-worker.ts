import { parentPort } from 'node:worker_threads';
import oxigraph from 'oxigraph';
import type { ProjectedQuad } from './types';

const store = new oxigraph.Store();

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
        const raw = store.query(msg.sparql, { use_default_graph_as_union: true });
        if (typeof raw === 'boolean') {
          parentPort!.postMessage({ id: msg.id, ok: true, result: { kind: 'ask', value: raw } });
        } else if (Array.isArray(raw)) {
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
        } else {
          parentPort!.postMessage({ id: msg.id, ok: true, result: { kind: 'construct', quads: Array.from(raw as Iterable<any>).map(fromQuad) } });
        }
        break;
      }
      case 'replaceEntity':
        for (const predicate of msg.ownedPredicates) {
          store.update(`DELETE WHERE { GRAPH <urn:sse:data> { <${msg.subject}> <${predicate}> ?o } }`);
        }
        for (const q of msg.quads) store.add(toQuad(q));
        parentPort!.postMessage({ id: msg.id, ok: true });
        break;
      case 'addRelation':
        store.add(toQuad({ subject: msg.from, predicate: msg.predicate, object: msg.to, objectType: 'iri', graph: 'urn:sse:data' }));
        parentPort!.postMessage({ id: msg.id, ok: true });
        break;
      case 'removeRelation':
        store.update(`DELETE DATA { GRAPH <urn:sse:data> { <${msg.from}> <${msg.predicate}> <${msg.to}> } }`);
        parentPort!.postMessage({ id: msg.id, ok: true });
        break;
      case 'delete':
        store.update(`DELETE WHERE { GRAPH <urn:sse:data> { <${msg.subject}> ?p ?o } }`);
        store.update(`DELETE WHERE { GRAPH <urn:sse:data> { ?s ?p <${msg.subject}> } }`);
        store.update(`INSERT DATA { GRAPH <urn:sse:history> { <${msg.subject}> <https://sse.local/ontology#deletedAt> "${new Date().toISOString()}" } }`);
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
