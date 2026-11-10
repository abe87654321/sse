import { uri } from '../graph/namespaces';
import type { GraphStore } from '../graph/types';
import { OntologyQueryService, type Scope } from '../query/query-service';
import {
  activeRoleExists,
  hasType,
  iris,
  literal,
  loadFacts,
  localName,
  resolveCategory,
} from './graph-read';
import {
  loadRules,
  matchRule,
  parseApprovalChain,
  ruleUriForId,
  type ApprovalStep,
  type RuleFacts,
} from './match-rule';

const VALID_INVOICE_STATUSES = new Set(['pass', 'verified']);

export interface ValidationIssue {
  code: string;
  message: string;
  evidence: string[];
}

export interface MatchedRuleView {
  id: string;
  uri: string;
  name: string;
  min_amount: number;
  max_amount: number;
  amount_range: string;
  approval_steps: number;
  approval_chain: ApprovalStep[];
}

export interface ValidateExpenseInput {
  amount: number;
  category_id?: string;
  category_name?: string;
  report_id?: string;
}

export interface ValidateExpenseResult {
  valid: boolean;
  matched_rule: MatchedRuleView | null;
  issues: ValidationIssue[];
  suggestions: string[];
  source: 'graph' | 'db-fallback';
}

export interface ValidationPool {
  query(sql: string, params?: any[]): Promise<{ rows: any[] }>;
}

function matchedRuleView(rule: RuleFacts): MatchedRuleView {
  return {
    id: rule.id,
    uri: rule.uri,
    name: rule.name,
    min_amount: rule.minAmount,
    max_amount: rule.maxAmount,
    amount_range: `${rule.minAmount} - ${rule.maxAmount}`,
    approval_steps: rule.approvalChain.length,
    approval_chain: rule.approvalChain,
  };
}

function reportUriFromId(id: string): string {
  return id.startsWith('http') ? id : uri.report(id);
}

async function validateReportInvoices(
  store: GraphStore,
  reportUri: string,
  scope: Scope,
  issues: ValidationIssue[],
  suggestions: string[],
): Promise<void> {
  const inScope = await new OntologyQueryService(store).isInScope(reportUri, scope);
  if (!inScope) {
    issues.push({
      code: 'out_of_scope',
      message: '无权校验该报销单',
      evidence: [reportUri],
    });
    return;
  }

  const report = await loadFacts(store, reportUri);
  if (!hasType(report, 'ExpenseReport')) {
    issues.push({
      code: 'report_not_found',
      message: '报销单不存在',
      evidence: [reportUri],
    });
    return;
  }

  const invoiceUris = new Set<string>();
  for (const itemUri of iris(report, 'containsItem')) {
    const item = await loadFacts(store, itemUri);
    for (const invoiceUri of iris(item, 'hasInvoice')) invoiceUris.add(invoiceUri);
  }

  for (const invoiceUri of invoiceUris) {
    const invoice = await loadFacts(store, invoiceUri);
    const status = literal(invoice, 'verificationStatus');
    if (status && !VALID_INVOICE_STATUSES.has(status)) {
      const invoiceNo = literal(invoice, 'invoiceNo');
      issues.push({
        code: 'invoice_not_verified',
        message: `发票 ${invoiceNo ?? localName(invoiceUri)} 核对状态为 ${status}`,
        evidence: [invoiceUri],
      });
      suggestions.push('请重新核对发票或确认核对结果后再继续审批');
    }
  }
}

function dbResult(
  matched: any,
  issues: ValidationIssue[],
  suggestions: string[],
): ValidateExpenseResult {
  return {
    valid: issues.length === 0,
    matched_rule: matched
      ? {
        id: String(matched.id ?? ''),
        uri: ruleUriForId(String(matched.id ?? '')),
        name: matched.name ?? '',
        min_amount: Number(matched.min_amount ?? 0),
        max_amount: Number(matched.max_amount ?? Number.POSITIVE_INFINITY),
        amount_range: `${matched.min_amount} - ${matched.max_amount}`,
        approval_steps: Array.isArray(matched.approval_chain) ? matched.approval_chain.length : 0,
        approval_chain: Array.isArray(matched.approval_chain)
          ? matched.approval_chain
          : parseApprovalChain(matched.approval_chain),
      }
    : null,
    issues,
    suggestions,
    source: 'db-fallback',
  };
}

async function validateFromDb(
  pool: ValidationPool,
  input: ValidateExpenseInput,
): Promise<ValidateExpenseResult> {
  const issues: ValidationIssue[] = [];
  const suggestions: string[] = [];

  let categoryMatch: any = null;
  if (input.category_id) {
    const { rows } = await pool.query('SELECT id, name FROM expense_categories WHERE id = $1', [input.category_id]);
    categoryMatch = rows[0] ?? null;
  } else if (input.category_name) {
    const { rows } = await pool.query(
      'SELECT id, name FROM expense_categories WHERE name ILIKE $1 LIMIT 1',
      [`%${input.category_name}%`],
    );
    categoryMatch = rows[0] ?? null;
  }

  const { rows: rules } = await pool.query(
    'SELECT * FROM approval_rules WHERE is_active = true AND min_amount <= $1 AND max_amount > $1 ORDER BY priority ASC',
    [input.amount],
  );

  let matchedRule: any = rules.length > 0 ? rules[0] : null;
  if (matchedRule && categoryMatch && matchedRule.category_ids && matchedRule.category_ids.length > 0) {
    if (!matchedRule.category_ids.includes(categoryMatch.id)) {
      matchedRule = rules.find(
        (rule: any) =>
          !rule.category_ids ||
          rule.category_ids.length === 0 ||
          rule.category_ids.includes(categoryMatch.id),
      ) ?? null;
    }
  }

  if (!matchedRule) {
    issues.push({
      code: 'no_matching_rule',
      message: '未匹配到有效的审批规则',
      evidence: [],
    });
    suggestions.push('请管理员检查审批规则配置');
  } else {
    for (const step of matchedRule.approval_chain ?? []) {
      if (!step.role) continue;
      const { rows: approvers } = await pool.query(
        "SELECT COUNT(*) as cnt FROM users WHERE role = $1 AND status = 'active'",
        [step.role],
      );
      if (Number(approvers[0]?.cnt ?? 0) === 0) {
        issues.push({
          code: 'missing_approver',
          message: `审批步骤 ${step.step}（${step.label || step.role}）没有在职审批人`,
          evidence: [ruleUriForId(String(matchedRule.id ?? ''))],
        });
        suggestions.push(`请为角色"${step.role}"添加在职用户`);
      }
    }
  }

  if (!categoryMatch && (input.category_id || input.category_name)) {
    issues.push({
      code: 'category_not_found',
      message: '指定费用类别不存在',
      evidence: [],
    });
    suggestions.push('请使用系统已知费用类别');
  }

  return dbResult(matchedRule, issues, suggestions);
}

export async function validateExpense(
  store: GraphStore,
  input: ValidateExpenseInput,
  scope: Scope,
  pool?: ValidationPool,
): Promise<ValidateExpenseResult> {
  const issues: ValidationIssue[] = [];
  const suggestions: string[] = [];

  const category = await resolveCategory(store, {
    categoryId: input.category_id,
    categoryName: input.category_name,
  });
  if (!category && (input.category_id || input.category_name)) {
    issues.push({
      code: 'category_not_found',
      message: '指定费用类别不存在',
      evidence: input.category_id ? [`https://sse.local/category/${input.category_id}`] : [],
    });
    suggestions.push('请使用系统已知费用类别');
  }

  const rules = await loadRules(store);

  if (rules.length === 0) {
    if (pool) return validateFromDb(pool, input);
    return {
      valid: false,
      matched_rule: null,
      issues: [
        ...issues,
        { code: 'no_rules', message: '本体图尚未投影审批规则', evidence: [] },
      ],
      suggestions: [...suggestions, '请先运行本体重建或等待规则投影'],
      source: 'graph',
    };
  }

  const matched = matchRule(input.amount, category ? [category.id] : [], rules);

  if (!matched) {
    issues.push({
      code: 'no_matching_rule',
      message: '未匹配到有效的审批规则',
      evidence: category ? [category.uri] : [],
    });
    suggestions.push('请管理员检查审批规则配置');
  } else {
    for (const step of matched.approvalChain) {
      if (!step.role) continue;
      if (!(await activeRoleExists(store, step.role))) {
        issues.push({
          code: 'missing_approver',
          message: `审批步骤 ${step.step ?? ''}（${step.label || step.role}）没有在职审批人`,
          evidence: [matched.uri],
        });
        suggestions.push(`请为角色"${step.role}"添加在职用户`);
      }
    }
  }

  if (input.report_id) {
    await validateReportInvoices(
      store,
      reportUriFromId(input.report_id),
      scope,
      issues,
      suggestions,
    );
  }

  return {
    valid: issues.length === 0,
    matched_rule: matched ? matchedRuleView(matched) : null,
    issues,
    suggestions: [...new Set(suggestions)],
    source: 'graph',
  };
}
