export type ObjectType = 'iri' | 'literal';

/** Oxigraph returns arrays for both SELECT and CONSTRUCT, so inspect the query form. */
export function isConstructQuery(sparql: string): boolean {
  const stripped = sparql
    .replace(/^\s*(?:PREFIX\s+\S+\s*<[^>]*>|BASE\s*<[^>]*>)\s*/gim, '')
    .trimStart();
  return /^(CONSTRUCT|DESCRIBE)\b/i.test(stripped);
}

export interface ProjectedQuad {
  subject: string;
  predicate: string;
  object: string;
  objectType: ObjectType;
  datatype?: string;
  language?: string;
  graph: string;
}

export interface SelectResult {
  kind: 'select';
  rows: Array<Record<string, string>>;
}

export interface AskResult {
  kind: 'ask';
  value: boolean;
}

export interface ConstructResult {
  kind: 'construct';
  quads: ProjectedQuad[];
}

export type GraphQueryResult = SelectResult | AskResult | ConstructResult;

export interface GraphCounts {
  quads: number;
  subjects: number;
}

export interface GraphStore {
  query(sparql: string, opts?: { timeoutMs?: number }): Promise<GraphQueryResult>;
  update(sparql: string): Promise<void>;
  load(nquads: string): Promise<void>;
  /** Atomically replace the entire graph (used by reconcile). */
  replaceAll(nquads: string): Promise<void>;
  dump(graphs: string[]): Promise<string>;
  /**
   * Replace only the outgoing triples whose predicates are listed in
   * ownedPredicates. Never touches incoming edges or predicates owned by
   * another projection. This is the ONLY safe way to update an entity whose
   * relations are also emitted from child rows.
   */
  replaceEntity(subject: string, quads: ProjectedQuad[], ownedPredicates: string[]): Promise<void>;
  addRelation(from: string, predicate: string, to: string): Promise<void>;
  removeRelation(from: string, predicate: string, to: string): Promise<void>;
  /** Full delete: outgoing + incoming edges, plus a tombstone. */
  deleteSubject(subject: string): Promise<void>;
  /** Keep an in-memory snapshot so a respawned worker can restore itself. */
  checkpoint(nquads: string): void;
  /** True when a worker timeout/respawn may have lost mutations; run reconcile. */
  needsRebuild(): boolean;
  counts(): Promise<GraphCounts>;
  close(): Promise<void>;
}
