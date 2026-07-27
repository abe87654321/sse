import { Store, Parser, Writer } from 'n3';

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
    const subject = this.store.createNamedNode(uri);
    this.store.addQuad(subject, this.store.createNamedNode('http://www.w3.org/1999/02/22-rdf-syntax-ns#type'), this.store.createNamedNode(this.baseUri + type));
    for (const [key, value] of Object.entries(properties)) {
      this.store.addQuad(subject, this.store.createNamedNode(this.baseUri + key), this.store.createLiteral(value));
    }
  }

  addRelation(fromUri: string, predicate: string, toUri: string): void {
    const subject = this.store.createNamedNode(fromUri);
    const objectUri = toUri.startsWith('http') ? toUri : `${this.baseUri}${toUri}`;
    this.store.addQuad(subject, this.store.createNamedNode(this.baseUri + predicate), this.store.createNamedNode(objectUri));
  }

  deleteEntity(uri: string): void {
    this.store.removeMatches(this.store.createNamedNode(uri), null, null, null);
    this.store.removeMatches(null, null, this.store.createNamedNode(uri), null);
  }

  deleteRelation(fromUri: string, predicate: string, toUri: string): void {
    const subject = this.store.createNamedNode(fromUri);
    const predicateNode = this.store.createNamedNode(this.baseUri + predicate);
    const objectUri = toUri.startsWith('http') ? toUri : `${this.baseUri}${toUri}`;
    this.store.removeMatches(subject, predicateNode, this.store.createNamedNode(objectUri), null);
  }

  queryByType(type: string): Array<{ uri: string; properties: Record<string, string> }> {
    const results: Array<{ uri: string; properties: Record<string, string> }> = [];
    const typeNode = this.store.createNamedNode(this.baseUri + type);
    for (const quad of this.store.match(null, this.store.createNamedNode('http://www.w3.org/1999/02/22-rdf-syntax-ns#type'), typeNode)) {
      const props: Record<string, string> = {};
      for (const pq of this.store.match(quad.subject, null, null)) {
        if (pq.predicate.value === 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type') continue;
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
    const rdfType = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type';

    const typeIndex = new Map<string, string>();
    for (const quad of this.store.getQuads(null, this.store.createNamedNode(rdfType), null, null)) {
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

      if (predicateUri === rdfType) continue;

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
