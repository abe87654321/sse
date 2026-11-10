import { readFileSync } from 'fs';
import { join } from 'path';
import { Parser, Writer, DataFactory } from 'n3';
import { GRAPH } from './namespaces';
import type { GraphStore } from './types';

const { namedNode } = DataFactory;

export function turtleToNQuads(ttl: string, graph: string): string {
  const quads = new Parser().parse(ttl).map(q => DataFactory.quad(q.subject, q.predicate, q.object, namedNode(graph)));
  const writer = new Writer({ format: 'N-Quads' });
  return writer.quadsToString(quads);
}

export async function loadTBox(store: GraphStore): Promise<void> {
  const ttl = readFileSync(join(__dirname, 'ontology', 'sse.ttl'), 'utf-8');
  await store.load(turtleToNQuads(ttl, GRAPH.tbox));
}

export function loadShapes(): string {
  return readFileSync(join(__dirname, 'ontology', 'shapes.ttl'), 'utf-8');
}
