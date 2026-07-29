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

  addRelation(fromUri: string, predicate: string, toUri: string): boolean {
    const subject = namedNode(fromUri);
    const predicateNode = namedNode(this.baseUri + predicate);
    const objectUri = toUri.startsWith('http') ? toUri : `${this.baseUri}${toUri}`;
    const objectNode = namedNode(objectUri);
    if (this.store.countQuads(subject, predicateNode, objectNode, null) > 0) return false;
    this.store.addQuad(subject, predicateNode, objectNode);
    return true;
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

  getStore() {
    return this.store;
  }

  query(subject: string, predicate: string, object: string): Array<Record<string, string>> {
    const results: Array<Record<string, string>> = [];
    for (const quad of this.store) {
      const binding: Record<string, string> = {};
      if (!this.matchTerm(quad.subject.value, subject, binding)) continue;
      if (!this.matchTerm(quad.predicate.value, predicate, binding)) continue;
      if (!this.matchTerm(quad.object.value, object, binding)) continue;
      results.push(binding);
    }
    return results;
  }

  private matchTerm(value: string, pattern: string, binding: Record<string, string>): boolean {
    if (pattern.startsWith('?')) { binding[pattern] = value; return true; }
    return value === pattern || value.endsWith(pattern);
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

  validateGraph(): string[] {
    const warnings: string[] = [];
    const graph = this.getGraph();
    const nodeSet = new Set(graph.nodes.map(n => n.id));

    for (const e of graph.edges) {
      if (!nodeSet.has(e.from)) warnings.push(`关系 "${e.label}" 的来源实体不存在`);
      if (!nodeSet.has(e.to)) warnings.push(`关系 "${e.label}" 的目标实体不存在`);
    }

    const connectedIds = new Set<string>();
    for (const e of graph.edges) { connectedIds.add(e.from); connectedIds.add(e.to); }
    for (const id of nodeSet) {
      if (!connectedIds.has(id)) {
        const node = graph.nodes.find(n => n.id === id);
        warnings.push(`实体 "${node?.label || id}" 是孤立节点，没有任何关系连接`);
      }
    }

    const persons = this.queryByType('Person');
    for (const p of persons) {
      const hasDept = graph.edges.some(e => e.from === p.uri && e.label === 'belongsTo');
      if (!hasDept) warnings.push(`人员 ${p.properties.name || p.uri} 未绑定部门（缺少 belongsTo 关系）`);
    }

    return warnings;
  }

  async saveToDb(): Promise<void> {
    const { pool } = await import('@sse/db');
    const graph = this.getGraph();
    await pool.query(
      `INSERT INTO ontology_snapshots (graph) VALUES ($1)`,
      [JSON.stringify(graph)]
    );
  }

  async loadFromDb(): Promise<void> {
    const { pool } = await import('@sse/db');
    const { rows } = await pool.query(
      'SELECT graph FROM ontology_snapshots ORDER BY created_at DESC LIMIT 1'
    );
    if (rows.length === 0) return;
    const graph = rows[0].graph;
    if (!graph || !graph.nodes) return;
    this.clear();
    for (const node of (graph.nodes as any[])) {
      const uri = node.id;
      this.addEntity(uri, node.type, node.properties || {});
    }
    for (const edge of (graph.edges as any[])) {
      this.addRelation(edge.from, edge.predicate || edge.label, edge.to);
    }
  }
}
