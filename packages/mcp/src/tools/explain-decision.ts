import type { ToolDefinition, ToolResult } from "./types.js";
import { errorResult, successResult } from "./types.js";
import { resolveAuthContext, enforceReadAccess } from "../auth.js";
import { pool } from "@sse/db";

export const definition: ToolDefinition = {
  name: "explain_decision",
  description: "解释报销单审批流程：匹配的规则、审批链、审批历史",
  inputSchema: {
    type: "object",
    properties: {
      report_id: { type: "string", description: "报销单 UUID" },
    },
    required: ["report_id"],
  },
};

export async function handler(args: Record<string, unknown>): Promise<ToolResult> {
  const auth = resolveAuthContext(args);
  if (!auth) return errorResult("UNAUTHORIZED", "无效或缺失 API key");
  const reportId = args.report_id as string;
  if (!reportId) return errorResult("INVALID_PARAMS", "请提供 report_id");
  try {
    const { rows: reports } = await pool.query("SELECT er.*, u.name as applicant_name, u.department FROM expense_reports er JOIN users u ON u.id = er.user_id WHERE er.id = $1", [reportId]);
    if (reports.length === 0) return errorResult("NOT_FOUND", "报销单不存在");
    const report = reports[0];
    if (!enforceReadAccess(auth, report.user_id, report.department)) return errorResult("NOT_FOUND", "无权访问");
    const { rows: items } = await pool.query("SELECT ei.*, ec.name as cat_name FROM expense_items ei LEFT JOIN expense_categories ec ON ec.id = ei.category_id WHERE ei.report_id = $1", [reportId]);
    const { rows: rules } = await pool.query("SELECT * FROM approval_rules WHERE is_active = true AND min_amount <= $1 AND max_amount > $1 ORDER BY priority ASC", [report.total_amount]);
    const matchedRule = rules.length > 0 ? rules[0] : null;
    const { rows: records } = await pool.query("SELECT ar.*, u.name as approver_name FROM approval_records ar LEFT JOIN users u ON u.id = ar.approver_id WHERE ar.report_id = $1 ORDER BY ar.step", [reportId]);
    const reportCategories = [...new Set(items.map((i: any) => i.cat_name))];
    const allRules = rules.map((r: any) => ({ name: r.name, range: `${r.min_amount} - ${r.max_amount}`, priority: r.priority, matched: r.id === matchedRule?.id }));
    const result = {
      report: { id: report.id, serial_no: report.serial_no, title: report.title, total_amount: report.total_amount, status: report.status, applicant: report.applicant_name, department: report.department, categories: reportCategories },
      approval_chain: matchedRule ? matchedRule.approval_chain : [],
      matched_rule: matchedRule ? { name: matchedRule.name, priority: matchedRule.priority, amount_range: `${matchedRule.min_amount} - ${matchedRule.max_amount}` } : null,
      all_candidate_rules: allRules,
      approval_history: records.map((r: any) => ({ step: r.step, approver: r.approver_name, result: r.result, comment: r.comment, approved_at: r.approved_at, step_started_at: r.step_started_at })),
      explanation: matchedRule ? `总金额 ¥${report.total_amount} 匹配规则"${matchedRule.name}"（${matchedRule.min_amount}-${matchedRule.max_amount}）` : "未匹配审批规则",
    };
    return successResult(result);
  } catch (err: any) {
    return errorResult("INTERNAL_ERROR", err.message || "内部错误");
  }
}
