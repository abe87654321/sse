import { GRAPH, RDF_TYPE, sse } from '../graph/namespaces';
import type { GraphStore } from '../graph/types';
import { sparqlIri } from '../query/sparql-term';
import { entityUri, type MappedTable } from './entity-mapper';

/**
 * SQL-truth shadow comparison for `ONTOLOGY_V2=shadow`.
 *
 * It deliberately compares the projected graph against PostgreSQL, not against
 * the legacy `SemanticMapper`. That mapper is incomplete by design (500-report
 * limit, missing domains, rejected→approved bug), so using it as the reference
 * would make `equal` impossible to satisfy.
 */

export interface ShadowPool {
  query(sql: string, params?: any[]): Promise<{ rows: any[] }>;
}

export type ShadowDifferenceKind = 'count' | 'row' | 'status' | 'relation';

export interface ShadowDifference {
  kind: ShadowDifferenceKind;
  table: string;
  id?: string;
  sql: unknown;
  graph: unknown;
}

export interface ShadowReport {
  equal: boolean;
  differences: ShadowDifference[];
  checkedAt: string;
}

export interface ShadowOptions {
  /** Rows sampled per table. Defaults to 200. */
  sampleSize?: number;
  now?: () => Date;
}

type ValueType = 'string' | 'number' | 'boolean' | 'date' | 'dateTime' | 'json';

interface ColumnSpec {
  column: string;
  predicate: string;
  type: ValueType;
  transform?: (row: Record<string, any>) => unknown;
}

interface StatusSpec {
  column: string;
  predicate: string;
  /** SQL expression used for GROUP BY (defaults to the column). */
  expression?: string;
}

interface TableSpec {
  table: MappedTable;
  graphClass: string;
  columns: ColumnSpec[];
  extraSelect?: string[];
  status?: StatusSpec;
}

interface RelationSpec {
  predicate: string;
  table: MappedTable;
  countSql: string;
}

const ZERO_UUID = '00000000-0000-0000-0000-000000000000';
const DEFAULT_SAMPLE_SIZE = 200;

const TABLES: TableSpec[] = [
  {
    table: 'users',
    graphClass: 'Person',
    columns: [
      { column: 'name', predicate: 'name', type: 'string' },
      {
        column: 'department',
        predicate: 'department',
        type: 'string',
        transform: (row) => row.department ?? '未分配',
      },
      { column: 'role', predicate: 'role', type: 'string' },
      {
        column: 'status',
        predicate: 'status',
        type: 'string',
        transform: (row) => (row.deleted_at ? 'deleted' : row.status),
      },
    ],
    extraSelect: ['deleted_at'],
    status: {
      column: 'status',
      predicate: 'status',
      expression: `CASE WHEN deleted_at IS NOT NULL THEN 'deleted' ELSE status END`,
    },
  },
  {
    table: 'expense_categories',
    graphClass: 'ExpenseCategory',
    columns: [
      { column: 'name', predicate: 'name', type: 'string' },
      { column: 'is_active', predicate: 'isActive', type: 'boolean' },
      { column: 'sort_order', predicate: 'sortOrder', type: 'number' },
    ],
  },
  {
    table: 'expense_reports',
    graphClass: 'ExpenseReport',
    columns: [
      { column: 'serial_no', predicate: 'serialNo', type: 'string' },
      { column: 'title', predicate: 'title', type: 'string' },
      { column: 'total_amount', predicate: 'amount', type: 'number' },
      { column: 'status', predicate: 'status', type: 'string' },
      { column: 'current_step', predicate: 'currentStep', type: 'number' },
      { column: 'submitted_at', predicate: 'submittedAt', type: 'dateTime' },
      { column: 'completed_at', predicate: 'completedAt', type: 'dateTime' },
      { column: 'paid_at', predicate: 'paidAt', type: 'dateTime' },
      { column: 'payment_ref', predicate: 'paymentRef', type: 'string' },
    ],
    status: { column: 'status', predicate: 'status' },
  },
  {
    table: 'expense_items',
    graphClass: 'ExpenseItem',
    columns: [
      { column: 'amount', predicate: 'amount', type: 'number' },
      { column: 'expense_date', predicate: 'expenseDate', type: 'date' },
      { column: 'description', predicate: 'description', type: 'string' },
    ],
  },
  {
    table: 'invoices',
    graphClass: 'Invoice',
    columns: [
      { column: 'invoice_no', predicate: 'invoiceNo', type: 'string' },
      { column: 'verification_status', predicate: 'verificationStatus', type: 'string' },
      { column: 'file_name', predicate: 'fileName', type: 'string' },
      { column: 'checksum', predicate: 'checksum', type: 'string' },
      { column: 'uploaded_at', predicate: 'uploadedAt', type: 'dateTime' },
    ],
    status: { column: 'verification_status', predicate: 'verificationStatus' },
  },
  {
    table: 'approval_rules',
    graphClass: 'ApprovalRule',
    columns: [
      { column: 'name', predicate: 'name', type: 'string' },
      { column: 'min_amount', predicate: 'minAmount', type: 'number' },
      { column: 'max_amount', predicate: 'maxAmount', type: 'number' },
      { column: 'priority', predicate: 'priority', type: 'number' },
      { column: 'is_active', predicate: 'isActive', type: 'boolean' },
      { column: 'approval_chain', predicate: 'approvalChain', type: 'json' },
    ],
  },
  {
    table: 'approval_records',
    graphClass: 'ApprovalRecord',
    columns: [
      { column: 'step', predicate: 'step', type: 'number' },
      { column: 'result', predicate: 'result', type: 'string' },
      { column: 'comment', predicate: 'comment', type: 'string' },
      { column: 'step_started_at', predicate: 'stepStartedAt', type: 'dateTime' },
      { column: 'approved_at', predicate: 'approvedAt', type: 'dateTime' },
    ],
    status: { column: 'result', predicate: 'result' },
  },
  {
    table: 'payment_receipts',
    graphClass: 'PaymentReceipt',
    columns: [
      { column: 'verification_status', predicate: 'verificationStatus', type: 'string' },
      { column: 'file_name', predicate: 'fileName', type: 'string' },
      { column: 'checksum', predicate: 'checksum', type: 'string' },
      { column: 'uploaded_at', predicate: 'uploadedAt', type: 'dateTime' },
    ],
    status: { column: 'verification_status', predicate: 'verificationStatus' },
  },
];

const RELATIONS: RelationSpec[] = [
  {
    predicate: 'submittedBy',
    table: 'expense_reports',
    countSql: 'SELECT COUNT(*)::int AS count FROM expense_reports WHERE user_id IS NOT NULL',
  },
  {
    predicate: 'containsItem',
    table: 'expense_items',
    countSql: 'SELECT COUNT(*)::int AS count FROM expense_items WHERE report_id IS NOT NULL',
  },
  {
    predicate: 'hasCategory',
    table: 'expense_items',
    countSql: 'SELECT COUNT(*)::int AS count FROM expense_items WHERE category_id IS NOT NULL',
  },
  {
    predicate: 'hasInvoice',
    table: 'invoices',
    countSql: 'SELECT COUNT(*)::int AS count FROM invoices WHERE item_id IS NOT NULL',
  },
  {
    predicate: 'hasApproval',
    table: 'approval_records',
    countSql: 'SELECT COUNT(*)::int AS count FROM approval_records WHERE report_id IS NOT NULL',
  },
  {
    predicate: 'hasPaymentReceipt',
    table: 'payment_receipts',
    countSql: 'SELECT COUNT(*)::int AS count FROM payment_receipts WHERE report_id IS NOT NULL',
  },
];

function asNumber(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function isoDateTime(value: unknown): string {
  const date = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toISOString().replace(/\.000Z$/, 'Z');
}

function isoDate(value: unknown): string {
  if (value instanceof Date) {
    const year = value.getFullYear();
    const month = String(value.getMonth() + 1).padStart(2, '0');
    const day = String(value.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
  const text = String(value);
  const match = /^\d{4}-\d{2}-\d{2}/.exec(text);
  return match ? match[0] : text;
}

function stableJson(value: unknown): string {
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value;
    const walk = (item: any): any => {
      if (Array.isArray(item)) return item.map(walk);
      if (item && typeof item === 'object') {
        return Object.keys(item)
          .sort()
          .reduce<Record<string, any>>((acc, key) => {
            acc[key] = walk(item[key]);
            return acc;
          }, {});
      }
      return item;
    };
    return JSON.stringify(walk(parsed));
  } catch {
    return String(value);
  }
}

/** Normalize a SQL value to the lexical form stored in the graph. */
function normalizeSqlValue(value: unknown, type: ValueType): string | null {
  if (value === null || value === undefined) return null;

  switch (type) {
    case 'number':
      return String(asNumber(value));
    case 'boolean':
      return value === true || value === 'true' || value === 't' || value === 1 || value === '1'
        ? 'true'
        : 'false';
    case 'date':
      return isoDate(value);
    case 'dateTime':
      return isoDateTime(value);
    case 'json':
      return stableJson(value);
    default:
      return String(value);
  }
}

function normalizeGraphValue(value: string | undefined): string | undefined {
  return value === undefined ? undefined : String(value);
}

async function countSqlRows(pool: ShadowPool, sql: string): Promise<number> {
  const { rows } = await pool.query(sql);
  return asNumber(rows[0]?.count);
}

async function graphClassCount(store: GraphStore, graphClass: string): Promise<number> {
  const result = await store.query(`
SELECT (COUNT(DISTINCT ?s) AS ?count) FROM <${GRAPH.data}>
WHERE { ?s <${RDF_TYPE}> <${sse(graphClass)}> }`);
  return result.kind === 'select' ? asNumber(result.rows[0]?.count) : 0;
}

async function graphRelationCount(store: GraphStore, predicate: string): Promise<number> {
  const result = await store.query(`
SELECT (COUNT(DISTINCT ?s) AS ?count) FROM <${GRAPH.data}>
WHERE { ?s <${sse(predicate)}> ?o }`);
  return result.kind === 'select' ? asNumber(result.rows[0]?.count) : 0;
}

async function compareCounts(
  store: GraphStore,
  pool: ShadowPool,
  differences: ShadowDifference[],
): Promise<void> {
  for (const spec of TABLES) {
    const [sqlCount, graphCount] = await Promise.all([
      countSqlRows(pool, `SELECT COUNT(*)::int AS count FROM ${spec.table}`),
      graphClassCount(store, spec.graphClass),
    ]);
    if (sqlCount !== graphCount) {
      differences.push({
        kind: 'count',
        table: spec.table,
        sql: sqlCount,
        graph: graphCount,
      });
    }
  }
}

async function compareRelations(
  store: GraphStore,
  pool: ShadowPool,
  differences: ShadowDifference[],
): Promise<void> {
  for (const spec of RELATIONS) {
    const [sqlCount, graphCount] = await Promise.all([
      countSqlRows(pool, spec.countSql),
      graphRelationCount(store, spec.predicate),
    ]);
    if (sqlCount !== graphCount) {
      differences.push({
        kind: 'relation',
        table: spec.table,
        sql: sqlCount,
        graph: graphCount,
      });
    }
  }
}

async function graphStatusDistribution(
  store: GraphStore,
  spec: TableSpec,
): Promise<Record<string, number>> {
  if (!spec.status) return {};
  const result = await store.query(`
SELECT ?value (COUNT(DISTINCT ?s) AS ?count) FROM <${GRAPH.data}>
WHERE {
  ?s <${RDF_TYPE}> <${sse(spec.graphClass)}> .
  ?s <${sse(spec.status.predicate)}> ?value .
}
GROUP BY ?value`);
  const distribution: Record<string, number> = {};
  if (result.kind !== 'select') return distribution;
  for (const row of result.rows) {
    if (row.value === undefined) continue;
    distribution[String(row.value)] = asNumber(row.count);
  }
  return distribution;
}

async function sqlStatusDistribution(
  pool: ShadowPool,
  spec: TableSpec,
): Promise<Record<string, number>> {
  if (!spec.status) return {};
  const expression = spec.status.expression ?? spec.status.column;
  const { rows } = await pool.query(
    `SELECT (${expression}) AS value, COUNT(*)::int AS count
       FROM ${spec.table}
      WHERE ${spec.status.column} IS NOT NULL
      GROUP BY (${expression})
      ORDER BY value`,
  );
  const distribution: Record<string, number> = {};
  for (const row of rows) {
    if (row.value === null || row.value === undefined) continue;
    distribution[String(row.value)] = asNumber(row.count);
  }
  return distribution;
}

function distributionsEqual(
  left: Record<string, number>,
  right: Record<string, number>,
): boolean {
  const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
  for (const key of keys) {
    if ((left[key] ?? 0) !== (right[key] ?? 0)) return false;
  }
  return true;
}

async function compareStatuses(
  store: GraphStore,
  pool: ShadowPool,
  differences: ShadowDifference[],
): Promise<void> {
  for (const spec of TABLES) {
    if (!spec.status) continue;
    const [sqlDistribution, graphDistribution] = await Promise.all([
      sqlStatusDistribution(pool, spec),
      graphStatusDistribution(store, spec),
    ]);
    if (!distributionsEqual(sqlDistribution, graphDistribution)) {
      differences.push({
        kind: 'status',
        table: spec.table,
        sql: sqlDistribution,
        graph: graphDistribution,
      });
    }
  }
}

async function graphLiteralProperties(
  store: GraphStore,
  uris: string[],
): Promise<Map<string, Map<string, string>>> {
  const properties = new Map<string, Map<string, string>>();
  if (uris.length === 0) return properties;

  const values = uris.map((value) => sparqlIri(value)).join(' ');
  const result = await store.query(`
SELECT ?s ?p ?o FROM <${GRAPH.data}>
WHERE {
  VALUES ?s { ${values} }
  ?s ?p ?o .
  FILTER(isLiteral(?o))
}`);
  if (result.kind !== 'select') return properties;

  for (const row of result.rows) {
    if (!row.s || !row.p) continue;
    let byPredicate = properties.get(row.s);
    if (!byPredicate) {
      byPredicate = new Map();
      properties.set(row.s, byPredicate);
    }
    byPredicate.set(row.p, row.o);
  }
  return properties;
}

async function compareSampleRows(
  store: GraphStore,
  pool: ShadowPool,
  spec: TableSpec,
  sampleSize: number,
  differences: ShadowDifference[],
): Promise<void> {
  const columns = [...spec.columns.map((column) => column.column), ...(spec.extraSelect ?? [])];
  const selectList = ['id', ...columns].join(', ');
  let lastId = ZERO_UUID;

  for (;;) {
    const { rows } = await pool.query(
      `SELECT ${selectList} FROM ${spec.table} WHERE id > $1 ORDER BY id LIMIT $2`,
      [lastId, sampleSize],
    );
    if (rows.length === 0) return;

    const uris = rows.map((row) => entityUri(spec.table, String(row.id)));
    const graphProperties = await graphLiteralProperties(store, uris);

    for (const row of rows) {
      const subject = entityUri(spec.table, String(row.id));
      const actual = graphProperties.get(subject) ?? new Map<string, string>();

      for (const column of spec.columns) {
        const raw = column.transform ? column.transform(row) : row[column.column];
        const expected = normalizeSqlValue(raw, column.type);
        const graphValue = normalizeGraphValue(actual.get(sse(column.predicate)));
        const normalizedGraphValue =
          graphValue === undefined ? undefined : normalizeSqlValue(graphValue, column.type) ?? undefined;

        // A missing SQL value must also be missing in the graph. A present SQL
        // value must have the same normalized lexical form.
        if (expected === null && normalizedGraphValue === undefined) continue;
        if (expected !== null && normalizedGraphValue === expected) continue;

        differences.push({
          kind: 'row',
          table: spec.table,
          id: String(row.id),
          sql: { [column.column]: expected },
          graph: { [column.predicate]: graphValue ?? null },
        });
      }
    }

    lastId = String(rows[rows.length - 1].id);
    if (rows.length < sampleSize) return;
  }
}

export async function compareShadow(
  store: GraphStore,
  pool: ShadowPool,
  opts: ShadowOptions = {},
): Promise<ShadowReport> {
  const sampleSize = Math.max(1, Math.min(1000, Math.floor(opts.sampleSize ?? DEFAULT_SAMPLE_SIZE)));
  const differences: ShadowDifference[] = [];

  await compareCounts(store, pool, differences);
  await compareRelations(store, pool, differences);
  await compareStatuses(store, pool, differences);

  for (const spec of TABLES) {
    await compareSampleRows(store, pool, spec, sampleSize, differences);
  }

  return {
    equal: differences.length === 0,
    differences,
    checkedAt: (opts.now ?? (() => new Date()))().toISOString(),
  };
}

let lastShadowReport: ShadowReport | null = null;

/** The API status route exposes this snapshot; it never triggers a new scan. */
export function setLastShadowReport(report: ShadowReport | null): void {
  lastShadowReport = report;
}

export function getLastShadowReport(): ShadowReport | null {
  return lastShadowReport;
}
