import { GRAPH, sse } from '../graph/namespaces';
import type { GraphStore } from '../graph/types';
import { OntologyQueryService, type Scope } from '../query/query-service';
import { PROLOGUE, activeRoleExists, localName, num, selectRows } from './graph-read';
import { loadRules, matchRule } from './match-rule';

export type AnomalyCode = 'amount_mismatch' | 'duplicate_invoice_no' | 'missing_approver';

export interface Anomaly {
  code: AnomalyCode;
  severity: 'error' | 'warning' | 'info';
  message: string;
  entities: string[];
  evidence: string[];
}

export interface AnomalySummary {
  total: number;
  error: number;
  warning: number;
  info: number;
  byCode: Record<string, number>;
}

export interface AnomalyResult {
  anomalies: Anomaly[];
  summary: AnomalySummary;
}

export interface FindAnomaliesOptions {
  limit?: number;
  scope?: Scope;
}

const AMOUNT_TOLERANCE = 0.005;

async function amountMismatches(store: GraphStore, scope: Scope): Promise<Anomaly[]> {
  const rows = await selectRows(store, `${PROLOGUE}
SELECT ?report ?amount ?item ?itemAmount WHERE {
  GRAPH <${GRAPH.data}> {
    ?report rdf:type <${sse('ExpenseReport')}> ; <${sse('amount')}> ?amount ; <${sse('containsItem')}> ?item .
    ?item <${sse('amount')}> ?itemAmount .
  }
}`);

  const grouped = new Map<string, { amount: number; items: Map<string, number> }>();
  for (const row of rows) {
    if (!row.report || !row.item) continue;
    const entry = grouped.get(row.report) ?? { amount: 0, items: new Map<string, number>() };
    entry.amount = num(row.amount) ?? entry.amount;
    entry.items.set(row.item, num(row.itemAmount) ?? 0);
    grouped.set(row.report, entry);
  }

  const scopeService = new OntologyQueryService(store);
  const anomalies: Anomaly[] = [];
  for (const [report, entry] of grouped) {
    const total = [...entry.items.values()].reduce((sum, amount) => sum + amount, 0);
    if (Math.abs(entry.amount - total) <= AMOUNT_TOLERANCE) continue;
    if (scope.kind !== 'all' && !(await scopeService.isInScope(report, scope))) continue;
    const evidence = [report, ...entry.items.keys()];
    anomalies.push({
      code: 'amount_mismatch',
      severity: 'warning',
      message: `报销单金额 ${entry.amount} 与明细合计 ${total} 不一致`,
      entities: evidence,
      evidence,
    });
  }
  return anomalies;
}

async function duplicateInvoiceNumbers(store: GraphStore, scope: Scope): Promise<Anomaly[]> {
  const rows = await selectRows(store, `${PROLOGUE}
SELECT ?invoice ?invoiceNo WHERE {
  GRAPH <${GRAPH.data}> {
    ?invoice rdf:type <${sse('Invoice')}> ; <${sse('invoiceNo')}> ?invoiceNo .
  }
}`);

  const grouped = new Map<string, string[]>();
  for (const row of rows) {
    if (!row.invoice || !row.invoiceNo) continue;
    const invoices = grouped.get(row.invoiceNo) ?? [];
    invoices.push(row.invoice);
    grouped.set(row.invoiceNo, invoices);
  }

  const scopeService = new OntologyQueryService(store);
  const anomalies: Anomaly[] = [];
  for (const [invoiceNo, invoices] of grouped) {
    let visible = invoices;
    if (scope.kind !== 'all') {
      visible = [];
      for (const invoice of invoices) {
        if (await scopeService.isInScope(invoice, scope)) visible.push(invoice);
      }
    }
    if (visible.length <= 1) continue;
    const evidence = [...visible].sort();
    anomalies.push({
      code: 'duplicate_invoice_no',
      severity: 'error',
      message: `发票号 ${invoiceNo} 被 ${visible.length} 张发票重复使用`,
      entities: evidence,
      evidence,
    });
  }
  return anomalies;
}

async function missingApprovers(store: GraphStore, scope: Scope): Promise<Anomaly[]> {
  const rows = await selectRows(store, `${PROLOGUE}
SELECT ?report ?serial ?amount ?category WHERE {
  GRAPH <${GRAPH.data}> {
    ?report rdf:type <${sse('ExpenseReport')}> ; <${sse('status')}> "pending" .
    OPTIONAL { ?report <${sse('serialNo')}> ?serial }
    OPTIONAL { ?report <${sse('amount')}> ?amount }
    OPTIONAL {
      ?report <${sse('containsItem')}> ?item .
      ?item <${sse('hasCategory')}> ?category .
    }
  }
}`);

  const reports = new Map<string, { serial: string; amount: number; categories: string[] }>();
  for (const row of rows) {
    if (!row.report) continue;
    const entry = reports.get(row.report) ?? {
      serial: row.serial ?? localName(row.report),
      amount: num(row.amount) ?? 0,
      categories: [],
    };
    if (row.category) entry.categories.push(localName(row.category));
    reports.set(row.report, entry);
  }

  const rules = await loadRules(store);
  const scopeService = new OntologyQueryService(store);
  const anomalies: Anomaly[] = [];
  const roleCache = new Map<string, boolean>();

  for (const [report, entry] of reports) {
    if (scope.kind !== 'all' && !(await scopeService.isInScope(report, scope))) continue;
    const rule = matchRule(entry.amount, entry.categories, rules);
    if (!rule) continue;

    for (const step of rule.approvalChain) {
      if (!step.role) continue;
      let exists = roleCache.get(step.role);
      if (exists === undefined) {
        exists = await activeRoleExists(store, step.role);
        roleCache.set(step.role, exists);
      }
      if (exists) continue;
      anomalies.push({
        code: 'missing_approver',
        severity: 'error',
        message: `报销单 ${entry.serial} 的审批规则「${rule.name || rule.id}」缺少在职角色 ${step.role}`,
        entities: [report, rule.uri],
        evidence: [report, rule.uri],
      });
    }
  }
  return anomalies;
}

function summarize(anomalies: Anomaly[]): AnomalySummary {
  const byCode: Record<string, number> = {};
  let error = 0;
  let warning = 0;
  let info = 0;
  for (const anomaly of anomalies) {
    byCode[anomaly.code] = (byCode[anomaly.code] ?? 0) + 1;
    if (anomaly.severity === 'error') error++;
    else if (anomaly.severity === 'warning') warning++;
    else info++;
  }
  return { total: anomalies.length, error, warning, info, byCode };
}

/**
 * v1 anomalies: amount_mismatch, duplicate_invoice_no, missing_approver.
 * The deferred checks live in Phase 4b; do not add them here without fixtures.
 */
export async function findAnomalies(
  store: GraphStore,
  opts: FindAnomaliesOptions = {},
): Promise<AnomalyResult> {
  const scope: Scope = opts.scope ?? { kind: 'all' };
  const limit = Math.max(1, Math.min(2000, Math.floor(opts.limit ?? 500)));

  const anomalies = [
    ...(await amountMismatches(store, scope)),
    ...(await duplicateInvoiceNumbers(store, scope)),
    ...(await missingApprovers(store, scope)),
  ].slice(0, limit);

  return { anomalies, summary: summarize(anomalies) };
}
