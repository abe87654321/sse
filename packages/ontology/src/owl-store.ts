import { Store, Parser, Writer } from 'n3';

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

  queryByType(type: string): Array<{ uri: string; properties: Record<string, string> }> {
    const results: Array<{ uri: string; properties: Record<string, string> }> = [];
    const typeNode = this.store.createNamedNode(this.baseUri + type);
    for (const quad of this.store.match(null, this.store.createNamedNode('http://www.w3.org/1999/02/22-rdf-syntax-ns#type'), typeNode)) {
      const props: Record<string, string> = {};
      for (const pq of this.store.match(quad.subject, null, null)) {
        const predicate = pq.predicate.value.replace(this.baseUri, '');
        props[predicate] = pq.object.value;
      }
      results.push({ uri: quad.subject.value, properties: props });
    }
    return results;
  }
}
