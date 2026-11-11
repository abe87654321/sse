import { GRAPH, sse } from '../graph/namespaces';
import type { GraphStore } from '../graph/types';
import { PROLOGUE, loadFacts, localName, num, selectRows } from './graph-read';

export interface ApprovalStep {
  step?: number;
  role?: string;
  label?: string;
}

export interface RuleFacts {
  uri: string;
  id: string;
  name: string;
  minAmount: number;
  maxAmount: number;
  priority: number;
  isActive: boolean;
  categoryIds: string[];
  approvalChain: ApprovalStep[];
}

export function parseApprovalChain(raw: string | undefined): ApprovalStep[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((step) => step && typeof step === 'object');
  } catch {
    return [];
  }
}

/** Load approval rules from the projected data graph (not from Postgres). */
export async function loadRules(store: GraphStore): Promise<RuleFacts[]> {
  const result = await selectRows(store, `${PROLOGUE}
SELECT ?rule ?name ?min ?max ?priority ?chain ?active ?category WHERE {
  GRAPH <${GRAPH.data}> {
    ?rule rdf:type <${sse('ApprovalRule')}> .
    OPTIONAL { ?rule <${sse('name')}> ?name }
    OPTIONAL { ?rule <${sse('minAmount')}> ?min }
    OPTIONAL { ?rule <${sse('maxAmount')}> ?max }
    OPTIONAL { ?rule <${sse('priority')}> ?priority }
    OPTIONAL { ?rule <${sse('approvalChain')}> ?chain }
    OPTIONAL { ?rule <${sse('isActive')}> ?active }
    OPTIONAL { ?rule <${sse('hasCategoryRule')}> ?category }
  }
}`);

  const grouped = new Map<string, RuleFacts>();
  for (const row of result) {
    if (!row.rule) continue;
    let rule = grouped.get(row.rule);
    if (!rule) {
      rule = {
        uri: row.rule,
        id: localName(row.rule),
        name: row.name ?? '',
        minAmount: num(row.min) ?? 0,
        maxAmount: num(row.max) ?? Number.POSITIVE_INFINITY,
        priority: num(row.priority) ?? 0,
        isActive: row.active === undefined ? true : row.active === 'true',
        categoryIds: [],
        approvalChain: parseApprovalChain(row.chain),
      };
      grouped.set(row.rule, rule);
    }
    if (row.category && !rule.categoryIds.includes(localName(row.category))) {
      rule.categoryIds.push(localName(row.category));
    }
  }

  return [...grouped.values()].sort((a, b) =>
    a.priority === b.priority ? a.uri.localeCompare(b.uri) : a.priority - b.priority,
  );
}

function intersects(a: string[], b: string[]): boolean {
  return a.some((value) => b.includes(value));
}

/**
 * Shared rule matcher used by both `validateExpense` and `explainReport`.
 *
 * Semantics mirror the legacy SQL: active rules whose [min, max) contains the
 * amount, ordered by priority; the first candidate wins unless it is restricted
 * to categories and none of the report categories match, in which case the
 * first unrestricted/matching candidate wins.
 */
export function matchRule(
  amount: number,
  categoryIds: string[],
  rules: RuleFacts[],
): RuleFacts | null {
  const candidates = rules
    .filter((rule) => rule.isActive)
    .filter((rule) => amount >= rule.minAmount && amount < rule.maxAmount)
    .sort((a, b) =>
      a.priority === b.priority ? a.uri.localeCompare(b.uri) : a.priority - b.priority,
    );

  if (candidates.length === 0) return null;

  const first = candidates[0];
  if (
    categoryIds.length > 0 &&
    first.categoryIds.length > 0 &&
    !intersects(first.categoryIds, categoryIds)
  ) {
    return (
      candidates.find(
        (rule) => rule.categoryIds.length === 0 || intersects(rule.categoryIds, categoryIds),
      ) ?? null
    );
  }

  return first;
}

export function ruleUriForId(id: string): string {
  return id.startsWith('http') ? id : `https://sse.local/rule/${id}`;
}
