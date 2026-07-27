import { Store, Parser, Writer, DataFactory } from 'n3';

export interface GraphNode {
  id: string;
  label: string;
  type: string;
  properties: Record<string, string>;
}

export interface GraphEdge {
  id: string;
  from: string;
  to: string;
  label: string;
}

export interface OntologyGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

const RDF_TYPE = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type';
const { namedNode, literal } = DataFactory;

export class OwlStore {
  private store: Store;
  private baseUri: string;

  constructor(baseUri = 'https://sse.local/ontology#') {
    this.store = new Store();
    this.baseUri = baseUri;
  }

  async loadFromTurtle(turtlePath: string): Promise<void> {
    const fs = await import('fs');
    const parser = new Parser({ baseIRI: this.baseUri });
    const data = fs.readFileSync(turtlePath, 'utf-8');
    const quads = parser.parse(data);
    this.store.addQuads(quads);
  }

  async saveToTurtle(turtlePath: string): Promise<void> {
    const fs = await import('fs');
    const writer = new Writer({ format: 'Turtle' });
    const quads = this.store.getQuads(null, null, null, null);
    const result = writer.quadsToString(quads);
    fs.writeFileSync(turtlePath, result, 'utf-8');
  }

  addEntity(uri: string, type: string, properties: Record<string, string>): void {
    const subject = namedNode(uri);
    this.store.addQuad(subject, namedNode(RDF_TYPE), namedNode(this.baseUri + type));
    for (const [key, value] of Object.entries(properties)) {
      this.store.addQuad(subject, namedNode(this.baseUri + key), literal(value));
    }
  }

  addRelation(fromUri: string, predicate: string, toUri: string): void {
    const subject = namedNode(fromUri);
    const objectUri = toUri.startsWith('http') ? toUri : `${this.baseUri}${toUri}`;
    this.store.addQuad(subject, namedNode(this.baseUri + predicate), namedNode(objectUri));
  }

  deleteEntity(uri: string): void {
    this.store.removeMatches(namedNode(uri), null, null, null);
    this.store.removeMatches(null, null, namedNode(uri), null);
  }

  deleteRelation(fromUri: string, predicate: string, toUri: string): void {
    const subject = namedNode(fromUri);
    const predicateNode = namedNode(this.baseUri + predicate);
    const objectUri = toUri.startsWith('http') ? toUri : `${this.baseUri}${toUri}`;
    this.store.removeMatches(subject, predicateNode, namedNode(objectUri), null);
  }

  queryByType(type: string): Array<{ uri: string; properties: Record<string, string> }> {
    const results: Array<{ uri: string; properties: Record<string, string> }> = [];
    const typeNode = namedNode(this.baseUri + type);
    for (const quad of this.store.match(null, namedNode(RDF_TYPE), typeNode)) {
      const props: Record<string, string> = {};
      for (const pq of this.store.match(quad.subject, null, null)) {
        if (pq.predicate.value === RDF_TYPE) continue;
        const predicate = pq.predicate.value.replace(this.baseUri, '');
        props[predicate] = pq.object.value;
      }
      results.push({ uri: quad.subject.value, properties: props });
    }
    return results;
  }

  getGraph(): OntologyGraph {
    const nodes: GraphNode[] = [];
    const edges: GraphEdge[] = [];
    const seenNodes = new Set<string>();

    const typeIndex = new Map<string, string>();
    for (const quad of this.store.getQuads(null, namedNode(RDF_TYPE), null, null)) {
      typeIndex.set(quad.subject.value, quad.object.value);
    }

    for (const quad of this.store.getQuads(null, null, null, null)) {
      const subjectUri = quad.subject.value;
      const predicateUri = quad.predicate.value;
      const objectValue = quad.object.value;

      if (!seenNodes.has(subjectUri)) {
        seenNodes.add(subjectUri);
        const typeUri = typeIndex.get(subjectUri) || '';
        const type = typeUri.replace(this.baseUri, '') || 'Unknown';
        const shortId = subjectUri.replace(this.baseUri, '').replace(/^https:\/\/sse\.local\//, '');
        nodes.push({ id: subjectUri, label: shortId, type, properties: {} });
      }

      if (predicateUri === RDF_TYPE) continue;

      const isObjectLiteral = quad.object.termType === 'Literal';
      const propertyName = predicateUri.replace(this.baseUri, '');

      if (isObjectLiteral) {
        const nodeEntry = nodes.find(n => n.id === subjectUri);
        if (nodeEntry) nodeEntry.properties[propertyName] = objectValue;
      } else {
        if (!seenNodes.has(objectValue)) {
          seenNodes.add(objectValue);
          const objTypeUri = typeIndex.get(objectValue) || '';
          const objType = objTypeUri.replace(this.baseUri, '') || 'Unknown';
          const shortId = objectValue.replace(this.baseUri, '').replace(/^https:\/\/sse\.local\//, '');
          nodes.push({ id: objectValue, label: shortId, type: objType, properties: {} });
        }
        edges.push({ id: `${subjectUri}--${propertyName}--${objectValue}`, from: subjectUri, to: objectValue, label: propertyName });
      }
    }

    return { nodes, edges };
  }

  clear(): void {
    this.store = new Store();
  }
}
