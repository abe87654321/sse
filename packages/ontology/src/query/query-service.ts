import { GRAPH, INST, RDF_TYPE, SSE, XSD, sse, uri } from '../graph/namespaces';
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

/** Only data entities live outside the ontology namespace. */
const DATA_ENTITY_FILTER =
  `FILTER(STRSTARTS(STR(?entity), "${INST}") && !STRSTARTS(STR(?entity), "${SSE}"))`;

export class InvalidQueryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidQueryError';
  }
}

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

/** A syntactically valid absolute IRI that is not inside the SSE namespace. */
function isAbsoluteIri(value: string): boolean {
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}

function assertTypeName(type: string): string {
  if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(type)) {
    throw new InvalidQueryError('invalid ontology type');
  }
  return type;
}

function dateLiteral(value: string, field: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new InvalidQueryError(`invalid ${field} date`);
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

  // With no filters at all, ?entity is never bound and COUNT would return 0.
  if (patterns.length === 0) {
    patterns.push(`?entity a ?type .`, DATA_ENTITY_FILTER);
  }

  return { patterns, legacyType };
}

function selectRows(result: GraphQueryResult): Array<Record<string, string>> {
  return result.kind === 'select' ? result.rows : [];
}

export class OntologyQueryService {
  constructor(public readonly store: GraphStore, private readonly poolRef?: QueryPool) {}

  get pool(): QueryPool {
    if (!this.poolRef) throw new Error('ontology pool is not initialized');
    return this.poolRef;
  }

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
    const where = patterns.join('\n  ');

    const countResult = await this.store.query(`${PROLOGUE}
SELECT (COUNT(DISTINCT ?entity) AS ?total) ${DATASET}
WHERE {
  ${where}
}`);
    const total = Number(selectRows(countResult)[0]?.total ?? 0);

    const offset = (page - 1) * pageSize;
    if (total === 0 || offset >= total) {
      return { results: [], total };
    }

    // Paginate distinct entity URIs before loading their properties, otherwise
    // LIMIT/OFFSET would slice property rows instead of entities.
    const pageResult = await this.store.query(`${PROLOGUE}
SELECT DISTINCT ?entity ${DATASET}
WHERE {
  ${where}
}
ORDER BY ?entity
LIMIT ${pageSize} OFFSET ${offset}`);
    const pageUris = selectRows(pageResult)
      .map((row) => row.entity)
      .filter((entity): entity is string => typeof entity === 'string' && entity.length > 0);
    if (pageUris.length === 0) {
      return { results: [], total };
    }

    const values = pageUris.map((entity) => sparqlIri(entity)).join(' ');
    const result = await this.store.query(`${PROLOGUE}
SELECT DISTINCT ?entity ?actualType ?p ?o ${DATASET}
WHERE {
  VALUES ?entity { ${values} }
  OPTIONAL { ?entity a ?actualType }
  OPTIONAL { ?entity ?p ?o . FILTER(?p != rdf:type && isLiteral(?o)) }
}
ORDER BY ?entity ?p ?o`);

    const entities = new Map<string, EntitySummary>();
    for (const entity of pageUris) {
      entities.set(entity, {
        uri: entity,
        type: legacyType ?? '',
        properties: {},
      });
    }
    for (const row of selectRows(result)) {
      const entity = row.entity;
      if (!entity) continue;
      const summary = entities.get(entity);
      if (!summary) continue;
      if (!summary.type && row.actualType) summary.type = localName(row.actualType);
      if (row.p && row.o !== undefined) summary.properties[localName(row.p)] = row.o;
    }

    return { results: pageUris.map((entity) => entities.get(entity)!), total };
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
    if (!subject) {
      // Well-formed IRIs outside the SSE namespace simply do not exist here;
      // malformed values are a caller error instead of a missing entity.
      if (!isAbsoluteIri(uriValue)) throw new InvalidQueryError('invalid entity IRI');
      return null;
    }
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

    if (!isAbsoluteIri(uriValue)) throw new InvalidQueryError('invalid entity IRI');
    if (!(await this.entityInScope(uriValue, opts.scope))) {
      return { nodes: [], edges: [] };
    }
    // A well-formed IRI outside the SSE namespace has no graph data to walk.
    if (!safeIri(uriValue)) return { nodes: [], edges: [] };

    const scopeCache = new Map<string, boolean>();
    const inScope = async (candidate: string): Promise<boolean> => {
      const cached = scopeCache.get(candidate);
      if (cached !== undefined) return cached;
      const allowed = await this.entityInScope(candidate, opts.scope);
      scopeCache.set(candidate, allowed);
      return allowed;
    };

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
        if (!safeIri(row.from) || !safeIri(row.to)) continue;
        // Never traverse or surface an edge that leaves the caller's scope.
        if (!(await inScope(row.from)) || !(await inScope(row.to))) continue;
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
          if (visited.has(candidate)) continue;
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

    if (!this.poolRef) {
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
      this.poolRef.query(
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
      this.poolRef.query(`SELECT last_snapshot_version FROM ontology_projector_state WHERE id = 'default'`),
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

    const childPatterns = (reportOwner: string): string[] => [
      // ExpenseItem is linked from its report via containsItem.
      `{ ?scopeReport <${sse('containsItem')}> ${subject} . ${reportOwner} }`,
      // Invoice is linked from its item, whose report is the actual parent.
      `{ ?scopeItem <${sse('hasInvoice')}> ${subject} . ?scopeReport <${sse('containsItem')}> ?scopeItem . ${reportOwner} }`,
      // ApprovalRecord / PaymentReceipt are linked directly from the report.
      `{ ?scopeReport <${sse('hasApproval')}> ${subject} . ${reportOwner} }`,
      `{ ?scopeReport <${sse('hasPaymentReceipt')}> ${subject} . ${reportOwner} }`,
    ];

    let body: string;
    if (scope.kind === 'self') {
      if (!scope.userId) return false;
      const person = safeIri(uri.person(scope.userId));
      if (!person) return false;
      const reportOwner = `?scopeReport <${sse('submittedBy')}> ${person}`;
      body = `{
        { FILTER(${subject} = ${person}) }
        UNION
        { ${subject} <${sse('belongsTo')}> ?scopeDept . ${person} <${sse('belongsTo')}> ?scopeDept }
        UNION
        { ${subject} <${sse('submittedBy')}> ${person} }
        UNION
        ${childPatterns(reportOwner).join('\n        UNION\n        ')}
      }`;
    } else {
      if (!scope.department) return false;
      const name = sparqlString(scope.department);
      const personInDept =
        `?scopePerson <${sse('belongsTo')}> ?scopeDept . ?scopeDept <${sse('name')}> ${name}`;
      const reportOwner = `?scopeReport <${sse('submittedBy')}> ?scopePerson . ${personInDept}`;
      body = `{
        { ${subject} <${sse('submittedBy')}> ?scopePerson . ${personInDept} }
        UNION
        { ${subject} <${sse('belongsTo')}> ?scopeDept . ?scopeDept <${sse('name')}> ${name} }
        UNION
        { ${subject} a <${sse('Department')}> . ${subject} <${sse('name')}> ${name} }
        UNION
        ${childPatterns(reportOwner).join('\n        UNION\n        ')}
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
