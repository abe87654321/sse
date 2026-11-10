import { MemoryGraphStore } from '../graph/memory-store';
import { XSD, sse, uri } from '../graph/namespaces';
import { InvalidQueryError } from '../query/query-service';
import { findAnomalies } from '../reasoning/anomalies';
import { explainReport } from '../reasoning/explain';
import { impactAnalysis } from '../reasoning/impact';
import { validateExpense } from '../reasoning/validate';

const DATA = 'urn:sse:data';
const RDF_TYPE = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type';

const P = (name: string) => `<${sse(name)}>`;
const person = (id: string) => uri.person(id);
const dept = (name: string) => uri.department(name);
const category = (id: string) => uri.category(id);
const report = (id: string) => uri.report(id);
const item = (id: string) => uri.item(id);
const invoice = (id: string) => uri.invoice(id);
const rule = (id: string) => uri.rule(id);
const approval = (id: string) => uri.approval(id);
const payment = (id: string) => uri.payment(id);

function esc(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function nq(subject: string, predicate: string, object: string, literal = false): string {
  return `<${subject}> ${predicate.startsWith('http') ? `<${predicate}>` : `<${sse(predicate)}>`} ${literal ? object : `<${object}>`} <${DATA}> .`;
}

function type(entity: string, className: string): string {
  return `<${entity}> <${RDF_TYPE}> <${sse(className)}> <${DATA}> .`;
}

function dataType(entity: string, predicate: string, value: string, datatype?: string): string {
  const object = datatype ? `"${esc(value)}"^^<${XSD}${datatype}>` : `"${esc(value)}"`;
  return `<${entity}> <${sse(predicate)}> ${object} <${DATA}> .`;
}

const CHAIN = JSON.stringify([
  { step: 1, role: 'dept_approver', label: '部门审批' },
  { step: 2, role: 'finance', label: '财务审批' },
]);
const LARGE_CHAIN = JSON.stringify([{ step: 1, role: 'auditor', label: '审计' }]);

function seed(): string {
  return [
    // People and departments.
    type(person('p1'), 'Person'),
    dataType(person('p1'), 'name', '张三'),
    dataType(person('p1'), 'role', 'employee'),
    dataType(person('p1'), 'status', 'active'),
    nq(person('p1'), 'belongsTo', dept('技术部')),
    type(person('p2'), 'Person'),
    dataType(person('p2'), 'name', '李四'),
    dataType(person('p2'), 'role', 'dept_approver'),
    dataType(person('p2'), 'status', 'active'),
    nq(person('p2'), 'belongsTo', dept('技术部')),
    type(person('p3'), 'Person'),
    dataType(person('p3'), 'name', '王五'),
    dataType(person('p3'), 'role', 'finance'),
    dataType(person('p3'), 'status', 'active'),
    nq(person('p3'), 'belongsTo', dept('财务部')),
    type(dept('技术部'), 'Department'),
    dataType(dept('技术部'), 'name', '技术部'),
    type(dept('财务部'), 'Department'),
    dataType(dept('财务部'), 'name', '财务部'),

    // Category.
    type(category('c1'), 'ExpenseCategory'),
    dataType(category('c1'), 'name', '差旅'),

    // Rules.
    type(rule('ar1'), 'ApprovalRule'),
    dataType(rule('ar1'), 'name', '差旅规则'),
    dataType(rule('ar1'), 'minAmount', '0', 'decimal'),
    dataType(rule('ar1'), 'maxAmount', '1000', 'decimal'),
    dataType(rule('ar1'), 'priority', '1', 'integer'),
    dataType(rule('ar1'), 'isActive', 'true', 'boolean'),
    dataType(rule('ar1'), 'approvalChain', CHAIN),
    nq(rule('ar1'), 'hasCategoryRule', category('c1')),
    type(rule('ar3'), 'ApprovalRule'),
    dataType(rule('ar3'), 'name', '大额规则'),
    dataType(rule('ar3'), 'minAmount', '1000', 'decimal'),
    dataType(rule('ar3'), 'maxAmount', '5000', 'decimal'),
    dataType(rule('ar3'), 'priority', '2', 'integer'),
    dataType(rule('ar3'), 'isActive', 'true', 'boolean'),
    dataType(rule('ar3'), 'approvalChain', LARGE_CHAIN),
    nq(rule('ar3'), 'hasCategoryRule', category('c1')),

    // Full paid report r1.
    type(report('r1'), 'ExpenseReport'),
    dataType(report('r1'), 'serialNo', 'RE-1'),
    dataType(report('r1'), 'amount', '500', 'decimal'),
    dataType(report('r1'), 'status', 'paid'),
    dataType(report('r1'), 'submittedAt', '2026-11-01T00:00:00Z', 'dateTime'),
    dataType(report('r1'), 'completedAt', '2026-11-02T00:00:00Z', 'dateTime'),
    dataType(report('r1'), 'paidAt', '2026-11-03T00:00:00Z', 'dateTime'),
    nq(report('r1'), 'submittedBy', person('p1')),
    nq(report('r1'), 'paidBy', person('p3')),
    nq(report('r1'), 'containsItem', item('i1')),
    nq(report('r1'), 'hasApproval', approval('a1')),
    nq(report('r1'), 'hasPaymentReceipt', payment('pay1')),
    type(item('i1'), 'ExpenseItem'),
    dataType(item('i1'), 'amount', '500', 'decimal'),
    nq(item('i1'), 'hasCategory', category('c1')),
    nq(item('i1'), 'hasInvoice', invoice('v1')),
    type(invoice('v1'), 'Invoice'),
    dataType(invoice('v1'), 'invoiceNo', 'INV-1'),
    dataType(invoice('v1'), 'verificationStatus', 'pass'),
    dataType(invoice('v1'), 'uploadedAt', '2026-11-01T00:01:00Z', 'dateTime'),
    type(approval('a1'), 'ApprovalRecord'),
    dataType(approval('a1'), 'step', '1', 'integer'),
    dataType(approval('a1'), 'result', 'approved'),
    dataType(approval('a1'), 'stepStartedAt', '2026-11-01T01:00:00Z', 'dateTime'),
    dataType(approval('a1'), 'approvedAt', '2026-11-01T02:00:00Z', 'dateTime'),
    nq(approval('a1'), 'approvedBy', person('p2')),
    type(payment('pay1'), 'PaymentReceipt'),
    dataType(payment('pay1'), 'verificationStatus', 'pass'),
    dataType(payment('pay1'), 'uploadedAt', '2026-11-03T00:00:00Z', 'dateTime'),

    // Amount mismatch report r2.
    type(report('r2'), 'ExpenseReport'),
    dataType(report('r2'), 'serialNo', 'RE-2'),
    dataType(report('r2'), 'amount', '999', 'decimal'),
    dataType(report('r2'), 'status', 'approved'),
    nq(report('r2'), 'submittedBy', person('p1')),
    nq(report('r2'), 'containsItem', item('i2')),
    type(item('i2'), 'ExpenseItem'),
    dataType(item('i2'), 'amount', '100', 'decimal'),
    nq(item('i2'), 'hasCategory', category('c1')),
    nq(item('i2'), 'hasInvoice', invoice('v2')),
    type(invoice('v2'), 'Invoice'),
    dataType(invoice('v2'), 'invoiceNo', 'DUP-1'),
    dataType(invoice('v2'), 'verificationStatus', 'warning'),

    // Missing approver report r3 (large rule requires the `auditor` role).
    type(report('r3'), 'ExpenseReport'),
    dataType(report('r3'), 'serialNo', 'RE-3'),
    dataType(report('r3'), 'amount', '2000', 'decimal'),
    dataType(report('r3'), 'status', 'pending'),
    nq(report('r3'), 'submittedBy', person('p1')),
    nq(report('r3'), 'containsItem', item('i3')),
    type(item('i3'), 'ExpenseItem'),
    dataType(item('i3'), 'amount', '2000', 'decimal'),
    nq(item('i3'), 'hasCategory', category('c1')),
    nq(item('i3'), 'hasInvoice', invoice('v3')),
    type(invoice('v3'), 'Invoice'),
    dataType(invoice('v3'), 'invoiceNo', 'DUP-1'),
    dataType(invoice('v3'), 'verificationStatus', 'pass'),
  ].join('\n');
}

async function storeWithSeed(): Promise<MemoryGraphStore> {
  const store = new MemoryGraphStore();
  await store.load(seed());
  return store;
}

/** A report/invoice graph with no projected rules, so validate uses the DB fallback. */
async function storeWithoutRules(): Promise<MemoryGraphStore> {
  const store = new MemoryGraphStore();
  await store.load([
    type(person('p1'), 'Person'),
    dataType(person('p1'), 'name', '张三'),
    nq(person('p1'), 'belongsTo', dept('技术部')),
    type(dept('技术部'), 'Department'),
    dataType(dept('技术部'), 'name', '技术部'),
    type(report('r1'), 'ExpenseReport'),
    dataType(report('r1'), 'serialNo', 'RE-1'),
    dataType(report('r1'), 'amount', '100', 'decimal'),
    dataType(report('r1'), 'status', 'pending'),
    nq(report('r1'), 'submittedBy', person('p1')),
    nq(report('r1'), 'containsItem', item('i1')),
    type(item('i1'), 'ExpenseItem'),
    dataType(item('i1'), 'amount', '100', 'decimal'),
    nq(item('i1'), 'hasInvoice', invoice('v1')),
    type(invoice('v1'), 'Invoice'),
    dataType(invoice('v1'), 'invoiceNo', 'INV-1'),
    dataType(invoice('v1'), 'verificationStatus', 'warning'),
  ].join('\n'));
  return store;
}

function fallbackPool() {
  return {
    query: async (sql: string) => {
      if (sql.includes('FROM expense_categories')) return { rows: [{ id: 'c1', name: '差旅' }] };
      if (sql.includes('FROM approval_rules')) {
        return {
          rows: [{
            id: 'db-rule',
            name: 'DB 规则',
            min_amount: '0',
            max_amount: '1000',
            category_ids: [],
            approval_chain: [{ step: 1, role: 'finance' }],
            priority: 1,
          }],
        };
      }
      if (sql.includes('FROM users')) return { rows: [{ cnt: '1' }] };
      return { rows: [] };
    },
  };
}

describe('reasoning services', () => {
  it('explains the full report chain with evidence', async () => {
    const store = await storeWithSeed();
    const explanation = await explainReport(store, report('r1'), { kind: 'all' });

    expect(explanation).not.toBeNull();
    expect(explanation!.report).toBe(report('r1'));
    expect(explanation!.timeline.length).toBeGreaterThanOrEqual(4);
    expect(explanation!.timeline.map((entry) => entry.event)).toEqual(
      expect.arrayContaining(['submitted', 'approved', 'paid']),
    );

    const matched = explanation!.why.find((entry) => entry.code === 'matched_rule');
    expect(matched?.message).toContain('差旅规则');
    expect(matched?.evidence).toContain(rule('ar1'));

    const invoices = explanation!.why.find((entry) => entry.code === 'invoice_verification');
    expect(invoices?.message).toContain('pass');
    expect(invoices?.evidence).toContain(invoice('v1'));

    const categories = explanation!.why.find((entry) => entry.code === 'categories');
    expect(categories?.message).toContain('差旅');
    expect(categories?.evidence).toContain(category('c1'));

    for (const entry of explanation!.why) {
      expect(entry.evidence.length).toBeGreaterThan(0);
    }
    expect(explanation!.evidenceUris).toEqual(
      expect.arrayContaining([
        report('r1'),
        rule('ar1'),
        category('c1'),
        invoice('v1'),
        approval('a1'),
        payment('pay1'),
      ]),
    );
  });

  it('returns null for out-of-scope reports', async () => {
    const store = await storeWithSeed();
    const explanation = await explainReport(store, report('r1'), { kind: 'self', userId: 'p2' });
    expect(explanation).toBeNull();
  });

  it('validates a matching rule with all approvers present', async () => {
    const store = await storeWithSeed();
    const result = await validateExpense(
      store,
      { amount: 500, category_name: '差旅' },
      { kind: 'all' },
    );

    expect(result.source).toBe('graph');
    expect(result.matched_rule?.name).toBe('差旅规则');
    expect(result.issues).toEqual([]);
    expect(result.valid).toBe(true);
  });

  it('reports a missing approver for the matched role', async () => {
    const store = await storeWithSeed();
    const result = await validateExpense(
      store,
      { amount: 2000, category_id: 'c1' },
      { kind: 'all' },
    );

    expect(result.valid).toBe(false);
    expect(result.matched_rule?.id).toBe('ar3');
    expect(result.issues.map((issue) => issue.code)).toContain('missing_approver');
    expect(result.issues.flatMap((issue) => issue.evidence)).toContain(rule('ar3'));
    expect(result.suggestions.join(' ')).toContain('auditor');
  });

  it('falls back to the DB implementation when the graph has no rules', async () => {
    const store = new MemoryGraphStore();
    await store.load(type(category('c1'), 'ExpenseCategory') + '\n' + dataType(category('c1'), 'name', '差旅'));
    const pool = {
      query: async (sql: string) => {
        if (sql.includes('FROM expense_categories')) return { rows: [{ id: 'c1', name: '差旅' }] };
        if (sql.includes('FROM approval_rules')) {
          return {
            rows: [{
              id: 'db-rule',
              name: 'DB 规则',
              min_amount: '0',
              max_amount: '1000',
              category_ids: [],
              approval_chain: [{ step: 1, role: 'finance' }],
              priority: 1,
            }],
          };
        }
        if (sql.includes('FROM users')) return { rows: [{ cnt: '1' }] };
        return { rows: [] };
      },
    };

    const result = await validateExpense(
      store,
      { amount: 100, category_id: 'c1' },
      { kind: 'all' },
      pool as any,
    );

    expect(result.source).toBe('db-fallback');
    expect(result.matched_rule?.name).toBe('DB 规则');
    expect(result.valid).toBe(true);
  });

  it('returns affected reports and people for a hypothetical rule change', async () => {
    const store = await storeWithSeed();
    const result = await impactAnalysis(
      store,
      { rule_id: 'ar1', min_amount: 0, max_amount: 2000 },
      { kind: 'all' },
    );

    expect(result.hypothetical).toBe(true);
    expect(result.affected_reports.map((entry) => entry.uri)).toEqual(
      expect.arrayContaining([report('r1'), report('r2')]),
    );
    expect(result.counts.reports).toBeGreaterThanOrEqual(2);
    expect(result.affected_people.map((entry) => entry.uri)).toContain(person('p1'));
    expect(result.affected_reports[0].reason).toBeTruthy();
  });

  it('finds the three v1 anomaly types', async () => {
    const store = await storeWithSeed();
    const result = await findAnomalies(store, { scope: { kind: 'all' } });
    const codes = result.anomalies.map((anomaly) => anomaly.code);

    expect(codes).toContain('amount_mismatch');
    expect(codes).toContain('duplicate_invoice_no');
    expect(codes).toContain('missing_approver');

    for (const anomaly of result.anomalies) {
      expect(anomaly.evidence.length).toBeGreaterThan(0);
      expect(anomaly.entities.length).toBeGreaterThan(0);
      expect(['error', 'warning', 'info']).toContain(anomaly.severity);
    }

    expect(result.summary.total).toBe(result.anomalies.length);
    expect(result.summary.byCode.amount_mismatch).toBe(1);
    expect(result.summary.byCode.duplicate_invoice_no).toBe(1);
    expect(result.summary.byCode.missing_approver).toBe(1);

    const mismatch = result.anomalies.find((anomaly) => anomaly.code === 'amount_mismatch');
    expect(mismatch?.evidence).toContain(report('r2'));
  });

  it('does not leak out-of-scope approvers or payers when a self-scoped employee explains their report', async () => {
    const store = await storeWithSeed();
    const explanation = await explainReport(store, report('r1'), { kind: 'self', userId: 'p1' });

    expect(explanation).not.toBeNull();
    const personPrefix = 'https://sse.local/person/';
    const people = explanation!.evidenceUris.filter((value) => value.startsWith(personPrefix));
    expect(people).not.toContain(person('p2'));
    expect(people).not.toContain(person('p3'));
    expect(people.every((value) => value === person('p1'))).toBe(true);

    const actors = explanation!.timeline
      .map((entry) => entry.actor)
      .filter((actor): actor is string => Boolean(actor));
    expect(actors).not.toContain('李四');
    expect(actors).not.toContain('王五');

    const approvalWhy = explanation!.why.find((entry) => entry.code.startsWith('approval_'));
    expect(approvalWhy?.evidence).not.toContain(person('p2'));

    // Global configuration stays visible even under self scope.
    expect(explanation!.evidenceUris).toContain(category('c1'));
    expect(explanation!.evidenceUris).toContain(rule('ar1'));
  });

  it('rejects an unknown impact rule_id instead of falling through to match-all', async () => {
    const store = await storeWithSeed();
    await expect(
      impactAnalysis(store, { rule_id: 'missing-rule' }, { kind: 'all' }),
    ).rejects.toBeInstanceOf(InvalidQueryError);
  });

  it('applies self and department scope to impact analysis', async () => {
    const store = await storeWithSeed();

    const outsider = await impactAnalysis(store, {}, { kind: 'self', userId: 'p2' });
    expect(outsider.affected_reports).toEqual([]);

    const sameDept = await impactAnalysis(store, {}, { kind: 'department', department: '技术部' });
    expect(sameDept.affected_reports.map((entry) => entry.uri)).toEqual(
      expect.arrayContaining([report('r1'), report('r2'), report('r3')]),
    );

    const otherDept = await impactAnalysis(store, {}, { kind: 'department', department: '财务部' });
    expect(otherDept.affected_reports).toEqual([]);
  });

  it('applies self and department scope to anomalies', async () => {
    const store = await storeWithSeed();

    const outsider = await findAnomalies(store, { scope: { kind: 'self', userId: 'p2' } });
    expect(outsider.anomalies).toEqual([]);

    const sameDept = await findAnomalies(store, { scope: { kind: 'department', department: '技术部' } });
    expect(sameDept.anomalies.map((anomaly) => anomaly.code)).toEqual(
      expect.arrayContaining(['amount_mismatch', 'duplicate_invoice_no', 'missing_approver']),
    );

    const otherDept = await findAnomalies(store, { scope: { kind: 'department', department: '财务部' } });
    expect(otherDept.anomalies).toEqual([]);
  });

  it('applies scope to report invoice validation in the graph path', async () => {
    const store = await storeWithSeed();

    const own = await validateExpense(
      store,
      { amount: 500, category_id: 'c1', report_id: 'r1' },
      { kind: 'self', userId: 'p1' },
    );
    expect(own.issues.map((issue) => issue.code)).not.toContain('out_of_scope');

    const outsider = await validateExpense(
      store,
      { amount: 500, category_id: 'c1', report_id: 'r1' },
      { kind: 'self', userId: 'p2' },
    );
    expect(outsider.issues.map((issue) => issue.code)).toContain('out_of_scope');

    const sameDept = await validateExpense(
      store,
      { amount: 500, category_id: 'c1', report_id: 'r1' },
      { kind: 'department', department: '技术部' },
    );
    expect(sameDept.issues.map((issue) => issue.code)).not.toContain('out_of_scope');

    const otherDept = await validateExpense(
      store,
      { amount: 500, category_id: 'c1', report_id: 'r1' },
      { kind: 'department', department: '财务部' },
    );
    expect(otherDept.issues.map((issue) => issue.code)).toContain('out_of_scope');
  });

  it('applies scope and invoice checks in the DB fallback', async () => {
    const store = await storeWithoutRules();
    const pool = fallbackPool();

    const own = await validateExpense(
      store,
      { amount: 100, category_id: 'c1', report_id: 'r1' },
      { kind: 'self', userId: 'p1' },
      pool as any,
    );
    expect(own.source).toBe('db-fallback');
    expect(own.issues.map((issue) => issue.code)).toContain('invoice_not_verified');
    expect(own.issues.map((issue) => issue.code)).not.toContain('out_of_scope');

    const outsider = await validateExpense(
      store,
      { amount: 100, category_id: 'c1', report_id: 'r1' },
      { kind: 'self', userId: 'p2' },
      pool as any,
    );
    expect(outsider.source).toBe('db-fallback');
    expect(outsider.issues.map((issue) => issue.code)).toContain('out_of_scope');

    const sameDept = await validateExpense(
      store,
      { amount: 100, category_id: 'c1', report_id: 'r1' },
      { kind: 'department', department: '技术部' },
      pool as any,
    );
    expect(sameDept.issues.map((issue) => issue.code)).toContain('invoice_not_verified');
    expect(sameDept.issues.map((issue) => issue.code)).not.toContain('out_of_scope');

    const otherDept = await validateExpense(
      store,
      { amount: 100, category_id: 'c1', report_id: 'r1' },
      { kind: 'department', department: '财务部' },
      pool as any,
    );
    expect(otherDept.issues.map((issue) => issue.code)).toContain('out_of_scope');
  });

  it('always attaches evidence to validation issues', async () => {
    const store = await storeWithSeed();

    const noMatch = await validateExpense(store, { amount: 99999 }, { kind: 'all' });
    const noMatchIssue = noMatch.issues.find((issue) => issue.code === 'no_matching_rule');
    expect(noMatchIssue?.evidence.length).toBeGreaterThan(0);

    const missingCategory = await validateExpense(
      store,
      { amount: 500, category_name: '不存在类别' },
      { kind: 'all' },
    );
    const categoryIssue = missingCategory.issues.find((issue) => issue.code === 'category_not_found');
    expect(categoryIssue?.evidence.length).toBeGreaterThan(0);

    const empty = await validateExpense(new MemoryGraphStore(), { amount: 100 }, { kind: 'all' });
    const noRules = empty.issues.find((issue) => issue.code === 'no_rules');
    expect(noRules?.evidence.length).toBeGreaterThan(0);
  });
});
