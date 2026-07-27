import type { ToolDefinition, ToolResult } from "./types.js";
import { errorResult, successResult } from "./types.js";
import { resolveAuthContext } from "../auth.js";
import { pool } from "@sse/db";

export const definition: ToolDefinition = {
  name: "validate_expense",
  description: "合规检查：验证费用项是否符合审批规则",
  inputSchema: {
    type: "object",
    properties: {
      amount: { type: "number", description: "报销金额" },
      category_id: { type: "string", description: "费用类别 UUID（可选）" },
      category_name: { type: "string", description: "费用类别名称（可选）" },
    },
    required: ["amount"],
  },
};

export async function handler(args: Record<string, unknown>): Promise<ToolResult> {
  const auth = resolveAuthContext(args);
  if (!auth) return errorResult("UNAUTHORIZED", "无效或缺失 API key");
  const amount = args.amount as number;
  if (!amount || amount <= 0) return errorResult("INVALID_PARAMS", "请提供有效的 amount");
  try {
    const categoryId = args.category_id as string;
    const categoryName = args.category_name as string;
    let categoryMatch: any = null;
    if (categoryId) { const { rows } = await pool.query("SELECT id, name FROM expense_categories WHERE id = $1", [categoryId]); categoryMatch = rows[0] || null; }
    else if (categoryName) { const { rows } = await pool.query("SELECT id, name FROM expense_categories WHERE name ILIKE $1 LIMIT 1", [`%${categoryName}%`]); categoryMatch = rows[0] || null; }
    const { rows: rules } = await pool.query("SELECT * FROM approval_rules WHERE is_active = true AND min_amount <= $1 AND max_amount > $1 ORDER BY priority ASC", [amount]);
    let matchedRule = rules.length > 0 ? rules[0] : null;
    if (matchedRule && categoryMatch && matchedRule.category_ids && matchedRule.category_ids.length > 0) {
      if (!matchedRule.category_ids.includes(categoryMatch.id)) {
        matchedRule = rules.find((r: any) => !r.category_ids || r.category_ids.length === 0 || r.category_ids.includes(categoryMatch.id)) || null;
      }
    }
    const issues: string[] = [];
    const suggestions: string[] = [];
    if (!matchedRule) { issues.push("未匹配到有效的审批规则"); suggestions.push("请管理员检查审批规则配置"); }
    else {
      for (const step of (matchedRule.approval_chain || [])) {
        if (step.role) {
          const { rows: approvers } = await pool.query("SELECT COUNT(*) as cnt FROM users WHERE role = $1 AND status = 'active'", [step.role]);
          if (parseInt(approvers[0].cnt) === 0) { issues.push(`审批步骤 ${step.step}（${step.label || step.role}）没有在职审批人`); suggestions.push(`请为角色"${step.role}"添加在职用户`); }
        }
      }
    }
    if (!categoryMatch && (categoryId || categoryName)) { issues.push("指定费用类别不存在"); suggestions.push("请使用系统已知费用类别"); }
    return successResult({ valid: issues.length === 0, amount, category: categoryMatch ? { id: categoryMatch.id, name: categoryMatch.name } : null, matched_rule: matchedRule ? { name: matchedRule.name, amount_range: `${matchedRule.min_amount} - ${matchedRule.max_amount}`, approval_steps: matchedRule.approval_chain?.length || 0 } : null, issues, suggestions });
  } catch (err: any) {
    return errorResult("INTERNAL_ERROR", err.message || "内部错误");
  }
}
