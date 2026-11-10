import { GRAPH, sse } from '../graph/namespaces';
import type { GraphStore } from '../graph/types';
import { OntologyQueryService, type Scope } from '../query/query-service';
import { PROLOGUE, localName, num, selectRows } from './graph-read';
import { loadRules, type RuleFacts } from './match-rule';

export interface ImpactInput {
  rule_id?: string;
  category_id?: string;
  department?: string;
  min_amount?: number;
  max_amount?: number;
  amount_delta?: number;
  limit?: number;
}

export interface ImpactReport {
  uri: string;
  serialNo: string;
  amount: number;
  status: string;
  reason: string;
}

export interface ImpactPerson {
  uri: string;
  name: string;
  department: string;
}

export interface ImpactResult {
  affected_reports: ImpactReport[];
  affected_people: ImpactPerson[];
  counts: { reports: number; people: number; pending: number };
  hypothetical: boolean;
}

interface ReportRow {
  uri: string;
  serialNo: string;
  amount: number;
  status: string;
  personUri?: string;
  personName?: string;
  department?: string;
}

async function loadReports(store: GraphStore): Promise<Map<string, ReportRow>> {
  const rows = await selectRows(store, `${PROLOGUE}
SELECT ?report ?serial ?amount ?status ?person ?personName ?personDepartment ?departmentName WHERE {
  GRAPH <${GRAPH.data}> {
    ?report rdf:type <${sse('ExpenseReport')}> .
    OPTIONAL { ?report <${sse('serialNo')}> ?serial }
    OPTIONAL { ?report <${sse('amount')}> ?amount }
    OPTIONAL { ?report <${sse('status')}> ?status }
    OPTIONAL {
      ?report <${sse('submittedBy')}> ?person .
      OPTIONAL { ?person <${sse('name')}> ?personName }
      OPTIONAL { ?person <${sse('department')}> ?personDepartment }
      OPTIONAL { ?person <${sse('belongsTo')}> ?dept . ?dept <${sse('name')}> ?departmentName }
    }
  }
}`);

  const reports = new Map<string, ReportRow>();
  for (const row of rows) {
    if (!row.report) continue;
    const existing = reports.get(row.report);
    if (existing) {
      if (!existing.personUri && row.person) existing.personUri = row.person;
      if (!existing.personName && row.personName) existing.personName = row.personName;
      if (!existing.department && (row.departmentName ?? row.personDepartment)) {
        existing.department = row.departmentName ?? row.personDepartment;
      }
      continue;
    }
    reports.set(row.report, {
      uri: row.report,
      serialNo: row.serial ?? localName(row.report),
      amount: num(row.amount) ?? 0,
      status: row.status ?? '',
      ...(row.person ? { personUri: row.person } : {}),
      ...(row.personName ? { personName: row.personName } : {}),
      ...((row.departmentName ?? row.personDepartment)
        ? { department: row.departmentName ?? row.personDepartment }
        : {}),
    });
  }
  return reports;
}

async function loadReportCategories(store: GraphStore): Promise<Map<string, Set<string>>> {
  const rows = await selectRows(store, `${PROLOGUE}
SELECT ?report ?category WHERE {
  GRAPH <${GRAPH.data}> {
    ?report <${sse('containsItem')}> ?item .
    ?item <${sse('hasCategory')}> ?category .
  }
}`);
  const result = new Map<string, Set<string>>();
  for (const row of rows) {
    if (!row.report || !row.category) continue;
    const set = result.get(row.report) ?? new Set<string>();
    set.add(localName(row.category));
    result.set(row.report, set);
  }
  return result;
}

function findRule(rules: RuleFacts[], ruleId: string): RuleFacts | undefined {
  return rules.find(
    (rule) => rule.id === ruleId || rule.uri === ruleId || rule.uri === `https://sse.local/rule/${ruleId}`,
  );
}

export async function impactAnalysis(
  store: GraphStore,
  input: ImpactInput,
  scope: Scope,
): Promise<ImpactResult> {
  const limit = Math.max(1, Math.min(2000, Math.floor(input.limit ?? 500)));
  const reports = await loadReports(store);
  const reportCategories = await loadReportCategories(store);
  const rules = input.rule_id ? await loadRules(store) : [];
  const rule = input.rule_id ? findRule(rules, input.rule_id) : undefined;

  const delta = input.amount_delta ?? 0;
  const hasBaseRange = input.min_amount !== undefined
    || input.max_amount !== undefined
    || rule !== undefined;
  const min = hasBaseRange
    ? (input.min_amount ?? rule?.minAmount ?? Number.NEGATIVE_INFINITY) + delta
    : Number.NEGATIVE_INFINITY;
  const max = hasBaseRange
    ? (input.max_amount ?? rule?.maxAmount ?? Number.POSITIVE_INFINITY) + delta
    : Number.POSITIVE_INFINITY;
  const reportShift = hasBaseRange ? 0 : delta;

  const scopeService = new OntologyQueryService(store);
  const affected: ImpactReport[] = [];
  const people = new Map<string, ImpactPerson>();

  for (const report of reports.values()) {
    const effectiveAmount = report.amount + reportShift;
    if (effectiveAmount < min || effectiveAmount >= max) continue;

    const categories = reportCategories.get(report.uri);
    if (input.category_id && !categories?.has(input.category_id)) continue;
    if (rule && rule.categoryIds.length > 0) {
      const matches = [...(categories ?? [])].some((category) => rule.categoryIds.includes(category));
      if (!matches) continue;
    }
    if (input.department && report.department !== input.department) continue;
    if (scope.kind !== 'all' && !(await scopeService.isInScope(report.uri, scope))) continue;

    const reasons: string[] = [];
    if (rule) reasons.push(`命中规则「${rule.name || rule.id}」`);
    if (input.category_id) reasons.push(`类别 ${input.category_id}`);
    if (input.department) reasons.push(`部门 ${input.department}`);
    if (Number.isFinite(min) || Number.isFinite(max)) {
      const low = Number.isFinite(min) ? min : '-∞';
      const high = Number.isFinite(max) ? max : '+∞';
      reasons.push(`金额 ${effectiveAmount} 落在 [${low}, ${high})`);
    }
    if (reasons.length === 0) reasons.push('符合全部筛选条件');

    affected.push({
      uri: report.uri,
      serialNo: report.serialNo,
      amount: report.amount,
      status: report.status,
      reason: reasons.join('；'),
    });

    if (report.personUri) {
      people.set(report.personUri, {
        uri: report.personUri,
        name: report.personName ?? localName(report.personUri),
        department: report.department ?? '',
      });
    }
  }

  affected.sort((a, b) => a.uri.localeCompare(b.uri));
  const limited = affected.slice(0, limit);

  return {
    affected_reports: limited,
    affected_people: [...people.values()].sort((a, b) => a.uri.localeCompare(b.uri)),
    counts: {
      reports: affected.length,
      people: people.size,
      pending: affected.filter((report) => report.status === 'pending').length,
    },
    hypothetical: input.rule_id !== undefined
      || input.min_amount !== undefined
      || input.max_amount !== undefined
      || input.amount_delta !== undefined,
  };
}
