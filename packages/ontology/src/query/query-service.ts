import { GRAPH, RDF_TYPE, SSE, XSD, sse, uri } from '../graph/namespaces';
import type { GraphCounts, GraphQueryResult, GraphStore } from '../graph/types';
import { sparqlIri, sparqlString } from './sparql-term';

const OWL = 'http://www.w3.org/2002/07/owl#';
const RDF_NS = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#';

const PROLOGUE = [
  `PREFIX sse: <${SSE}>`,
  `PREFIX rdf: <${RDF_NS}>`,
  `PREFIX xsd: <${XSD}>`,
  `PREFIX owl: <${OWL}>`,
  '',
].join('\n');

const DATASET = [
  `FROM <${GRAPH.tbox}>`,
  `FROM <${GRAPH.data}>`,
  `FROM <${GRAPH.inferred}>`,
  `FROM <${GRAPH.manual}>`,
].join(' ');

const LEGACY_REPORT_TYPES: Record<string, string> = {
  DraftReport: 'draft',
  PendingReport: 'pending',
  ApprovedReport: 'approved',
  RejectedReport: 'rejected',
  PaidReport: 'paid',
};

export type Scope =
  | { kind: 'all' }
  | { kind: 'department'; department: string }
  | { kind: 'self'; userId: string }
  | { kind: 'deny' };

export interface QueryPool {
  query(sql: string, params?: any[]): Promise<{ rows: any[] }>;
}

export interface EntitySummary {
  uri: string;
  type: string;
  properties: Record<string, string>;
}

export interface EntityRelation {
  predicate: string;
  target?: string;
  source?: string;
}

export interface EntityDetail extends EntitySummary {
  relations: {
    outgoing: EntityRelation[];
    incoming: EntityRelation[];
  };
}

export interface NetworkNode extends EntitySummary {}

export interface NetworkEdge {
  id: string;
  from: string;
  to: string;
  predicate: string;
  label: string;
}

export interface NetworkResult {
  nodes: NetworkNode[];
  edges: NetworkEdge[];
}

export interface OntologyStatus {
  engine: 'oxigraph';
  version: number;
  counts: GraphCounts;
  outboxPending: number;
  deadLettered: number;
  lagSeconds: number;
  outbox: {
    pending: number;
    deadLettered: number;
    oldestPendingAgeSeconds: number;
    lastError: string | null;
  };
}

interface EntityFilters {
  type?: string;
  status?: string;
  department?: string;
  q?: string;
  scope: Scope;
}

interface EntityPatterns {
  patterns: string[];
  legacyType?: string;
}

function localName(iri: string): string {
  const hash = iri.lastIndexOf('#');
  if (hash >= 0) return iri.slice(hash + 1);
  const slash = iri.lastIndexOf('/');
  return slash >= 0 ? iri.slice(slash + 1) : iri;
}

function safeIri(value: string): string | null {
  try {
    return sparqlIri(value);
  } catch {
    return null;
  }
}

function assertTypeName(type: string): string {
  if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(type)) {
    throw new Error('invalid ontology type');
  }
  return type;
}

function dateLiteral(value: string, field: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`invalid ${field} date`);
  }
  return `"${value}"^^<${XSD}date>`;
}

function departmentPattern(entity: string, department: string): string {
  const name = sparqlString(department);
  return `{
    { ${entity} <${sse('submittedBy')}> ?scopePerson . ?scopePerson <${sse('belongsTo')}> ?scopeDept . ?scopeDept <${sse('name')}> ${name} }
    UNION
    { ${entity} <${sse('belongsTo')}> ?scopeDept . ?scopeDept <${sse('name')}> ${name} }
    UNION
    { ${entity} a <${sse('Department')}> . ${entity} <${sse('name')}> ${name} }
  }`;
}

function scopePatterns(scope: Scope, entity: string): string[] {
  switch (scope.kind) {
    case 'all':
      return [];
    case 'deny':
      return ['FILTER(false)'];
    case 'self': {
      if (!scope.userId) return ['FILTER(false)'];
      const person = safeIri(uri.person(scope.userId));
      if (!person) return ['FILTER(false)'];
      return [`{
        { ${entity} <${sse('submittedBy')}> ${person} }
        UNION
        { FILTER(${entity} = ${person}) }
      }`];
    }
    case 'department':
      if (!scope.department) return ['FILTER(false)'];
      return [departmentPattern(entity, scope.department)];
  }
}

function entityPatterns(filters: EntityFilters): EntityPatterns {
  const patterns: string[] = [];
  let legacyType: string | undefined;

  if (filters.type) {
    const type = assertTypeName(filters.type);
    const legacyStatus = LEGACY_REPORT_TYPES[type];
    if (legacyStatus) {
      legacyType = type;
      patterns.push(`?entity a <${sse('ExpenseReport')}> .`);
      patterns.push(`?entity <${sse('status')}> ${sparqlString(legacyStatus)} .`);
    } else {
      patterns.push(`?entity a ${sparqlIri(sse(type))} .`);
    }
  }

  if (filters.status) {
    patterns.push(`?entity <${sse('status')}> ${sparqlString(filters.status)} .`);
  }

  if (filters.department) {
    patterns.push(departmentPattern('?entity', filters.department));
  }

  if (filters.q) {
    patterns.push(
      `?entity ?qPredicate ?qValue . FILTER(isLiteral(?qValue) && CONTAINS(LCASE(STR(?qValue)), LCASE(${sparqlString(filters.q)})))`,
    );
  }

  patterns.push(...scopePatterns(filters.scope, '?entity'));

  return { patterns, legacyType };
}

function selectRows(result: GraphQueryResult): Array<Record<string, string>> {
  return result.kind === 'select' ? result.rows : [];
}

export class OntologyQueryService {
  constructor(private readonly store: GraphStore, private readonly pool?: QueryPool) {}

  async listEntities(input: {
    type?: string;
    status?: string;
    department?: string;
    q?: string;
    page?: number;
    pageSize?: number;
    scope: Scope;
  }): Promise<{ results: EntitySummary[]; total: number }> {
    const page = Math.max(1, Math.floor(Number(input.page) || 1));
    const pageSize = Math.max(1, Math.min(100, Math.floor(Number(input.pageSize) || 20)));
    const { patterns, legacyType } = entityPatterns(input);

    const countResult = await this.store.query(`${PROLOGUE}
SELECT (COUNT(DISTINCT ?entity) AS ?total) ${DATASET}
WHERE {
  ${patterns.join('\n  ')}
}`);
    const total = Number(selectRows(countResult)[0]?.total ?? 0);

    if (total === 0 || (page - 1) * pageSize >= total) {
      return { results: [], total };
    }

    const offset = (page - 1) * pageSize;
    const result = await this.store.query(`${PROLOGUE}
SELECT DISTINCT ?entity ?actualType ?p ?o ${DATASET}
WHERE {
  ${patterns.join('\n  ')}
  OPTIONAL { ?entity a ?actualType }
  OPTIONAL { ?entity ?p ?o . FILTER(?p != rdf:type && isLiteral(?o)) }
}
ORDER BY ?entity ?p ?o
LIMIT ${pageSize} OFFSET ${offset}`);

    const entities = new Map<string, EntitySummary>();
    for (const row of selectRows(result)) {
      const entity = row.entity;
      if (!entity) continue;
      let summary = entities.get(entity);
      if (!summary) {
        summary = {
          uri: entity,
          type: legacyType ?? (row.actualType ? localName(row.actualType) : ''),
          properties: {},
        };
        entities.set(entity, summary);
      }
      if (!summary.type && row.actualType) summary.type = localName(row.actualType);
      if (row.p && row.o !== undefined) summary.properties[localName(row.p)] = row.o;
    }

    return { results: [...entities.values()], total };
  }

  async searchReports(input: {
    status?: string;
    department?: string;
    q?: string;
    page?: number;
    pageSize?: number;
    scope: Scope;
  }): Promise<{ results: any[]; total: number }> {
    const listed = await this.listEntities({ ...input, type: 'ExpenseReport' });
    return {
      total: listed.total,
      results: listed.results.map((entity) => ({
        ...entity.properties,
        id: entity.uri,
        uri: entity.uri,
        type: entity.type,
        properties: entity.properties,
      })),
    };
  }

  async getEntity(uriValue: string, scope: Scope): Promise<EntityDetail | null> {
    const subject = safeIri(uriValue);
    if (!subject) return null;
    if (!(await this.entityInScope(uriValue, scope))) return null;

    const propertyResult = await this.store.query(`${PROLOGUE}
SELECT DISTINCT ?type ?p ?o ${DATASET}
WHERE {
  OPTIONAL { ${subject} a ?type }
  OPTIONAL { ${subject} ?p ?o . FILTER(isLiteral(?o)) }
}
ORDER BY ?type ?p ?o`);

    let type = '';
    const properties: Record<string, string> = {};
    for (const row of selectRows(propertyResult)) {
      if (!type && row.type) type = localName(row.type);
      if (row.p && row.o !== undefined) properties[localName(row.p)] = row.o;
    }

    const outgoingResult = await this.store.query(`${PROLOGUE}
SELECT DISTINCT ?p ?o ${DATASET}
WHERE {
  ${subject} ?p ?o .
  FILTER(isIRI(?o) && ?p != rdf:type)
}
ORDER BY ?p ?o`);
    const incomingResult = await this.store.query(`${PROLOGUE}
SELECT DISTINCT ?p ?s ${DATASET}
WHERE {
  ?s ?p ${subject} .
  FILTER(isIRI(?s))
}
ORDER BY ?p ?s`);

    const outgoing: EntityRelation[] = [];
    const incoming: EntityRelation[] = [];
    const seenOutgoing = new Set<string>();
    const seenIncoming = new Set<string>();

    for (const row of selectRows(outgoingResult)) {
      if (!row.p || !row.o) continue;
      const key = `${row.p}|${row.o}`;
      if (seenOutgoing.has(key)) continue;
      seenOutgoing.add(key);
      outgoing.push({ predicate: localName(row.p), target: row.o });
    }

    for (const row of selectRows(incomingResult)) {
      if (!row.p || !row.s) continue;
      const key = `${row.p}|${row.s}`;
      if (seenIncoming.has(key)) continue;
      seenIncoming.add(key);
      incoming.push({ predicate: localName(row.p), source: row.s });
    }

    return {
      uri: uriValue,
      type,
      properties,
      relations: { outgoing, incoming },
    };
  }

  async network(
    uriValue: string,
    opts: { depth: number; direction?: 'both' | 'out' | 'in'; scope: Scope },
  ): Promise<NetworkResult> {
    const direction = opts.direction === 'out' || opts.direction === 'in' ? opts.direction : 'both';
    const rawDepth = Number(opts.depth);
    const depth = Number.isFinite(rawDepth) ? Math.min(5, Math.max(0, Math.floor(rawDepth))) : 2;

    if (!(await this.entityInScope(uriValue, opts.scope))) {
      return { nodes: [], edges: [] };
    }

    const visited = new Set<string>([uriValue]);
    let frontier = [uriValue];
    const edges = new Map<string, NetworkEdge>();

    for (let step = 0; step < depth && frontier.length > 0; step++) {
      const values = frontier.map((item) => sparqlIri(item)).join(' ');
      const rows: Array<Record<string, string>> = [];

      if (direction === 'out' || direction === 'both') {
        const result = await this.store.query(`${PROLOGUE}
SELECT DISTINCT ?from ?p ?to ${DATASET}
WHERE {
  VALUES ?from { ${values} }
  ?from ?p ?to .
  FILTER(isIRI(?to) && ?p != rdf:type)
}`);
        rows.push(...selectRows(result));
      }

      if (direction === 'in' || direction === 'both') {
        const result = await this.store.query(`${PROLOGUE}
SELECT DISTINCT ?from ?p ?to ${DATASET}
WHERE {
  VALUES ?to { ${values} }
  ?from ?p ?to .
  FILTER(isIRI(?from) && ?p != rdf:type)
}`);
        rows.push(...selectRows(result));
      }

      const next: string[] = [];
      for (const row of rows) {
        if (!row.from || !row.p || !row.to) continue;
        const key = `${row.from}|${row.p}|${row.to}`;
        if (!edges.has(key)) {
          edges.set(key, {
            id: key,
            from: row.from,
            to: row.to,
            predicate: localName(row.p),
            label: localName(row.p),
          });
        }
        for (const candidate of [row.from, row.to]) {
          if (visited.has(candidate) || !safeIri(candidate)) continue;
          visited.add(candidate);
          next.push(candidate);
        }
      }
      frontier = next;
    }

    return {
      nodes: await this.loadNetworkNodes([...visited]),
      edges: [...edges.values()].sort((a, b) =>
        a.from === b.from
          ? a.to === b.to
            ? a.predicate.localeCompare(b.predicate)
            : a.to.localeCompare(b.to)
          : a.from.localeCompare(b.from),
      ),
    };
  }

  async spendByCategory(input: {
    from: string;
    to: string;
    department?: string;
    scope: Scope;
  }): Promise<Array<{ category: string; total: number; count: number }>> {
    const from = dateLiteral(input.from, 'from');
    const to = dateLiteral(input.to, 'to');
    const patterns = [
      `?report <${sse('containsItem')}> ?item .`,
      `?item a <${sse('ExpenseItem')}> .`,
      `?item <${sse('amount')}> ?amount .`,
      `OPTIONAL { ?item <${sse('hasCategory')}> ?category . }`,
      `OPTIONAL { ?category <${sse('name')}> ?categoryName . }`,
      `OPTIONAL { ?item <${sse('expenseDate')}> ?expenseDate . }`,
      `FILTER(!BOUND(?expenseDate) || (?expenseDate >= ${from} && ?expenseDate <= ${to}))`,
      `BIND(xsd:decimal(?amount) AS ?amountValue)`,
      `BIND(COALESCE(?categoryName, STR(?category), "未分类") AS ?categoryLabel)`,
      ...scopePatterns(input.scope, '?report'),
    ];

    if (input.department) {
      patterns.push(departmentPattern('?report', input.department));
    }

    const result = await this.store.query(`${PROLOGUE}
SELECT ?categoryLabel (SUM(?amountValue) AS ?total) (COUNT(DISTINCT ?item) AS ?count) ${DATASET}
WHERE {
  ${patterns.join('\n  ')}
}
GROUP BY ?categoryLabel
ORDER BY DESC(?total) ?categoryLabel`);

    return selectRows(result).map((row) => ({
      category: row.categoryLabel,
      total: Number(row.total ?? 0),
      count: Number(row.count ?? 0),
    }));
  }

  async schema(): Promise<{ classes: string[]; properties: string[] }> {
    const classesResult = await this.store.query(`${PROLOGUE}
SELECT DISTINCT ?class FROM <${GRAPH.tbox}>
WHERE { ?class a owl:Class }
ORDER BY ?class`);
    const propertiesResult = await this.store.query(`${PROLOGUE}
SELECT DISTINCT ?property FROM <${GRAPH.tbox}>
WHERE {
  ?property a ?propertyType .
  FILTER(?propertyType IN (owl:ObjectProperty, owl:DatatypeProperty))
}
ORDER BY ?property`);

    return {
      classes: selectRows(classesResult).map((row) => localName(row.class)).filter(Boolean),
      properties: selectRows(propertiesResult).map((row) => localName(row.property)).filter(Boolean),
    };
  }

  async status(): Promise<OntologyStatus> {
    const counts = await this.store.counts();

    if (!this.pool) {
      return {
        engine: 'oxigraph',
        version: 0,
        counts,
        outboxPending: 0,
        deadLettered: 0,
        lagSeconds: 0,
        outbox: {
          pending: 0,
          deadLettered: 0,
          oldestPendingAgeSeconds: 0,
          lastError: null,
        },
      };
    }

    const [outboxResult, versionResult] = await Promise.all([
      this.pool.query(
        `SELECT
           COUNT(*) FILTER (WHERE processed_at IS NULL AND dead_letter = false)::int AS pending,
           COUNT(*) FILTER (WHERE dead_letter = true)::int AS dead_lettered,
           COALESCE(
             EXTRACT(EPOCH FROM (
               NOW() - MIN(occurred_at) FILTER (WHERE processed_at IS NULL AND dead_letter = false)
             )),
             0
           ) AS lag_seconds,
           (SELECT last_error FROM ontology_outbox
             WHERE last_error IS NOT NULL
             ORDER BY id DESC LIMIT 1) AS last_error
         FROM ontology_outbox`,
      ),
      this.pool.query(`SELECT last_snapshot_version FROM ontology_projector_state WHERE id = 'default'`),
    ]);

    const row = outboxResult.rows[0] ?? {};
    const pending = Number(row.pending ?? 0);
    const deadLettered = Number(row.dead_lettered ?? 0);
    const lagSeconds = Number(row.lag_seconds ?? 0);
    const version = Number(versionResult.rows[0]?.last_snapshot_version ?? 0);

    return {
      engine: 'oxigraph',
      version,
      counts,
      outboxPending: pending,
      deadLettered,
      lagSeconds,
      outbox: {
        pending,
        deadLettered,
        oldestPendingAgeSeconds: lagSeconds,
        lastError: row.last_error ?? null,
      },
    };
  }

  private async entityInScope(entity: string, scope: Scope): Promise<boolean> {
    if (scope.kind === 'all') return true;
    if (scope.kind === 'deny') return false;

    const subject = safeIri(entity);
    if (!subject) return false;

    let body: string;
    if (scope.kind === 'self') {
      if (!scope.userId) return false;
      const person = safeIri(uri.person(scope.userId));
      if (!person) return false;
      body = `{
        { ${subject} <${sse('submittedBy')}> ${person} }
        UNION
        { FILTER(${subject} = ${person}) }
      }`;
    } else {
      if (!scope.department) return false;
      const name = sparqlString(scope.department);
      body = `{
        { ${subject} <${sse('submittedBy')}> ?scopePerson . ?scopePerson <${sse('belongsTo')}> ?scopeDept . ?scopeDept <${sse('name')}> ${name} }
        UNION
        { ${subject} <${sse('belongsTo')}> ?scopeDept . ?scopeDept <${sse('name')}> ${name} }
        UNION
        { ${subject} a <${sse('Department')}> . ${subject} <${sse('name')}> ${name} }
      }`;
    }

    const result = await this.store.query(`${PROLOGUE}ASK ${DATASET} WHERE { ${body} }`);
    return result.kind === 'ask' && result.value;
  }

  private async loadNetworkNodes(uris: string[]): Promise<NetworkNode[]> {
    if (uris.length === 0) return [];

    const values = uris.map((item) => sparqlIri(item)).join(' ');
    const result = await this.store.query(`${PROLOGUE}
SELECT DISTINCT ?entity ?type ?p ?o ${DATASET}
WHERE {
  VALUES ?entity { ${values} }
  OPTIONAL { ?entity a ?type }
  OPTIONAL { ?entity ?p ?o . FILTER(isLiteral(?o)) }
}
ORDER BY ?entity ?type ?p ?o`);

    const nodes = new Map<string, NetworkNode>();
    for (const item of uris) {
      nodes.set(item, { uri: item, type: '', properties: {} });
    }
    for (const row of selectRows(result)) {
      if (!row.entity) continue;
      const node = nodes.get(row.entity) ?? { uri: row.entity, type: '', properties: {} };
      if (!node.type && row.type) node.type = localName(row.type);
      if (row.p && row.o !== undefined) node.properties[localName(row.p)] = row.o;
      nodes.set(row.entity, node);
    }

    return [...nodes.values()].sort((a, b) => a.uri.localeCompare(b.uri));
  }
}
