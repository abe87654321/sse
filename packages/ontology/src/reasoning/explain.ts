import { uri } from '../graph/namespaces';
import { loadShapes } from '../graph/ontology-loader';
import type { GraphStore } from '../graph/types';
import { OntologyQueryService, type Scope } from '../query/query-service';
import {
  hasType,
  iris,
  literal,
  loadFacts,
  localName,
  num,
  type EntityFacts,
} from './graph-read';
import { loadRules, matchRule, type RuleFacts } from './match-rule';
import { validateGraph } from './shacl';

export interface TimelineEntry {
  at: string;
  event: string;
  actor?: string;
  evidence: string;
}

export interface WhyEntry {
  code: string;
  message: string;
  evidence: string[];
}

export interface Explanation {
  report: string;
  timeline: TimelineEntry[];
  why: WhyEntry[];
  evidenceUris: string[];
}

function personName(person: EntityFacts | undefined): string | undefined {
  if (!person) return undefined;
  return literal(person, 'name') ?? localName(person.uri);
}

function addTimeline(
  timeline: TimelineEntry[],
  entry: { at?: string; event: string; actor?: string; evidence: string },
): void {
  if (!entry.at) return;
  timeline.push({
    at: entry.at,
    event: entry.event,
    ...(entry.actor ? { actor: entry.actor } : {}),
    evidence: entry.evidence,
  });
}

export async function explainReport(
  store: GraphStore,
  reportUri: string,
  scope: Scope,
): Promise<Explanation | null> {
  const scopeService = new OntologyQueryService(store);
  const scopeCache = new Map<string, boolean>();
  const inScope = async (entity: string): Promise<boolean> => {
    const cached = scopeCache.get(entity);
    if (cached !== undefined) return cached;
    const allowed = await scopeService.isInScope(entity, scope);
    scopeCache.set(entity, allowed);
    return allowed;
  };

  if (!(await inScope(reportUri))) return null;

  const report = await loadFacts(store, reportUri);
  if (!hasType(report, 'ExpenseReport')) return null;

  const relevant = new Set<string>([reportUri]);
  const timeline: TimelineEntry[] = [];
  const why: WhyEntry[] = [];

  const status = literal(report, 'status');
  const reportAmount = num(literal(report, 'amount'));
  const serialNo = literal(report, 'serialNo') ?? localName(reportUri);

  // Submitter.
  const submittedByUri = iris(report, 'submittedBy')[0];
  let submitter: EntityFacts | undefined;
  if (submittedByUri) {
    submitter = await loadFacts(store, submittedByUri);
    relevant.add(submittedByUri);
  }

  // Items, categories, invoices.
  const items: EntityFacts[] = [];
  const invoices: EntityFacts[] = [];
  const categoryIds: string[] = [];
  const categoryFacts = new Map<string, EntityFacts>();
  const categoryUris: string[] = [];
  for (const itemUri of iris(report, 'containsItem')) {
    const item = await loadFacts(store, itemUri);
    items.push(item);
    relevant.add(itemUri);
    for (const categoryUri of iris(item, 'hasCategory')) {
      categoryIds.push(localName(categoryUri));
      categoryUris.push(categoryUri);
      relevant.add(categoryUri);
      if (!categoryFacts.has(categoryUri)) {
        categoryFacts.set(categoryUri, await loadFacts(store, categoryUri));
      }
    }
    for (const invoiceUri of iris(item, 'hasInvoice')) {
      const invoice = await loadFacts(store, invoiceUri);
      invoices.push(invoice);
      relevant.add(invoiceUri);
      addTimeline(timeline, {
        at: literal(invoice, 'uploadedAt'),
        event: 'invoice_uploaded',
        actor: personName(submitter),
        evidence: invoiceUri,
      });
    }
  }

  // Approvals. Approvers are only loaded when they are inside the caller's
  // scope; otherwise their URI and display name must never reach the response.
  const approvals: EntityFacts[] = [];
  const approvers = new Map<string, EntityFacts>();
  const visibleApprovers = new Set<string>();
  for (const approvalUri of iris(report, 'hasApproval')) {
    const approval = await loadFacts(store, approvalUri);
    approvals.push(approval);
    relevant.add(approvalUri);
    const approverUri = iris(approval, 'approvedBy')[0];
    if (approverUri && (await inScope(approverUri))) {
      visibleApprovers.add(approverUri);
      relevant.add(approverUri);
      if (!approvers.has(approverUri)) approvers.set(approverUri, await loadFacts(store, approverUri));
    }
  }

  // Payment receipt and payer.
  const receipts: EntityFacts[] = [];
  for (const receiptUri of iris(report, 'hasPaymentReceipt')) {
    const receipt = await loadFacts(store, receiptUri);
    receipts.push(receipt);
    relevant.add(receiptUri);
    addTimeline(timeline, {
      at: literal(receipt, 'uploadedAt'),
      event: 'payment_receipt_uploaded',
      evidence: receiptUri,
    });
  }
  const paidByUri = iris(report, 'paidBy')[0];
  let payer: EntityFacts | undefined;
  if (paidByUri && (await inScope(paidByUri))) {
    payer = await loadFacts(store, paidByUri);
    relevant.add(paidByUri);
  }

  // Matched rule: TypeScript matcher is the source of truth; governedBy is only
  // an optional cross-check when a CONSTRUCT rule emitted it.
  const rules: RuleFacts[] = await loadRules(store);
  const matched = reportAmount === undefined
    ? null
    : matchRule(reportAmount, categoryIds, rules);
  const governedBy = iris(report, 'governedBy')[0];
  if (governedBy) relevant.add(governedBy);

  // Timeline.
  addTimeline(timeline, {
    at: literal(report, 'submittedAt'),
    event: 'submitted',
    actor: personName(submitter),
    evidence: reportUri,
  });
  for (const approval of approvals) {
    const step = literal(approval, 'step');
    const result = literal(approval, 'result');
    const approver = approvers.get(iris(approval, 'approvedBy')[0] ?? '');
    addTimeline(timeline, {
      at: literal(approval, 'stepStartedAt'),
      event: `approval_started${step ? ` (step ${step})` : ''}`,
      actor: personName(approver),
      evidence: approval.uri,
    });
    if (result === 'approved' || result === 'rejected') {
      addTimeline(timeline, {
        at: literal(approval, 'approvedAt') ?? literal(approval, 'stepStartedAt'),
        event: result,
        actor: personName(approver),
        evidence: approval.uri,
      });
    }
  }
  addTimeline(timeline, {
    at: literal(report, 'completedAt'),
    event: 'completed',
    evidence: reportUri,
  });
  addTimeline(timeline, {
    at: literal(report, 'paidAt'),
    event: 'paid',
    actor: personName(payer),
    evidence: reportUri,
  });
  timeline.sort((a, b) => a.at.localeCompare(b.at));

  // Why chain.
  why.push({
    code: 'status',
    message: `报销单 ${serialNo} 当前状态为 ${status ?? '未知'}`,
    evidence: [reportUri],
  });

  const uniqueCategories = [...new Set(categoryUris)].sort();
  if (uniqueCategories.length > 0) {
    const names = [...new Set(uniqueCategories.map((categoryUri) => {
      const facts = categoryFacts.get(categoryUri);
      return facts ? literal(facts, 'name') ?? localName(categoryUri) : localName(categoryUri);
    }))];
    why.push({
      code: 'categories',
      message: `费用类别：${names.join('，')}`,
      evidence: uniqueCategories,
    });
  }

  if (matched) {
    why.push({
      code: 'matched_rule',
      message: `金额 ${reportAmount} 匹配审批规则「${matched.name || matched.id}」`,
      evidence: [matched.uri, reportUri],
    });
    if (governedBy && governedBy !== matched.uri) {
      why.push({
        code: 'governed_by_cross_check',
        message: `图中 governedBy=${governedBy} 与金额规则 ${matched.uri} 不一致，以金额规则为准`,
        evidence: [governedBy, matched.uri],
      });
    } else if (governedBy) {
      why.push({
        code: 'governed_by_cross_check',
        message: '图中 governedBy 与金额规则一致',
        evidence: [governedBy],
      });
    }
  } else {
    why.push({
      code: 'no_matching_rule',
      message: '未找到与当前金额/类别匹配的审批规则',
      evidence: [reportUri, ...items.map((item) => item.uri)],
    });
  }

  if (invoices.length > 0) {
    const labels = invoices.map((invoice) => {
      const invoiceNo = literal(invoice, 'invoiceNo') ?? localName(invoice.uri);
      const verification = literal(invoice, 'verificationStatus') ?? 'unknown';
      return `${invoiceNo}=${verification}`;
    });
    why.push({
      code: 'invoice_verification',
      message: `共 ${invoices.length} 张发票，核对状态：${labels.join('，')}`,
      evidence: invoices.map((invoice) => invoice.uri),
    });
  }

  for (const approval of approvals) {
    const approverUri = iris(approval, 'approvedBy')[0];
    const result = literal(approval, 'result') ?? 'unknown';
    const step = literal(approval, 'step');
    const visibleApprover = approverUri && visibleApprovers.has(approverUri) ? approverUri : undefined;
    why.push({
      code: result === 'rejected' ? 'approval_rejected' : `approval_${result}`,
      message: `第 ${step ?? '?'} 步审批结果为 ${result}`,
      evidence: [approval.uri, ...(visibleApprover ? [visibleApprover] : [])],
    });
  }

  for (const receipt of receipts) {
    why.push({
      code: 'payment_receipt',
      message: `打款回单核对状态为 ${literal(receipt, 'verificationStatus') ?? 'unknown'}`,
      evidence: [receipt.uri],
    });
  }

  // Constraint violations that touch this report's evidence chain.
  // TODO(perf): this validates the whole graph (TBox + data + inferred + manual)
  // on every explain request. Correct but expensive; consider validating only
  // the report subgraph or caching compiled shapes if explain becomes hot.
  const violations = await validateGraph(store, loadShapes());
  for (const violation of violations) {
    if (!relevant.has(violation.focusNode)) continue;
    why.push({
      code: 'constraint_violation',
      message: violation.message || '违反 SHACL 约束',
      evidence: [violation.focusNode],
    });
  }

  const evidenceUris = new Set<string>([reportUri]);
  for (const entry of why) for (const evidence of entry.evidence) evidenceUris.add(evidence);
  for (const entry of timeline) evidenceUris.add(entry.evidence);

  // Global configuration (rules and categories) is readable regardless of the
  // caller's data scope. Every other URI must pass the same scope check as the
  // entity reads so an out-of-scope person can never leak through evidence.
  const globalPrefixes = [uri.rule(''), uri.category('')];
  const visibleEvidence: string[] = [];
  for (const evidence of evidenceUris) {
    if (globalPrefixes.some((prefix) => evidence.startsWith(prefix))) {
      visibleEvidence.push(evidence);
      continue;
    }
    if (await inScope(evidence)) visibleEvidence.push(evidence);
  }

  return {
    report: reportUri,
    timeline,
    why,
    evidenceUris: visibleEvidence.sort(),
  };
}

export function reportUri(idOrUri: string): string {
  return idOrUri.startsWith('http') ? idOrUri : uri.report(idOrUri);
}
