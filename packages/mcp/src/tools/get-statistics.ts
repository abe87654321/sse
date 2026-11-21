import { pool } from "@sse/db";
import {
  SPENDING_STATUSES,
  buildStatisticsPredicate,
  resolveStatisticsFilter,
  statisticsScopeLabel,
} from "@sse/core";
import { resolveDataScope } from "@sse/auth";
import { resolveAuthContext } from "../auth.js";
import { ToolDefinition, ToolResult, parseISO8601Date, errorResult, successResult } from "./types.js";

export const definition: ToolDefinition = {
  name: "get_statistics",
  description: "获取报销统计数据，包含总额、单数、分类汇总、部门汇总",
  inputSchema: {
    type: "object",
    properties: {
      date_from: { type: "string", description: "起始日期 YYYY-MM-DD" },
      date_to: { type: "string", description: "截止日期 YYYY-MM-DD" },
      department: { type: "string", description: "部门过滤（可选）" },
    },
  },
};

export async function handler(args: Record<string, unknown>): Promise<ToolResult> {
  const auth = resolveAuthContext(args);
  if (!auth) {
    return errorResult("UNAUTHORIZED", "缺少有效的 API Key");
  }

  try {
    const scope = resolveDataScope(auth);
    if (scope.kind === "deny") {
      return errorResult("FORBIDDEN", "当前角色无权查看统计");
    }

    const filter = resolveStatisticsFilter(scope, {
      dateFrom: parseISO8601Date(args.date_from),
      dateTo: parseISO8601Date(args.date_to),
      department: typeof args.department === "string" ? args.department : undefined,
    });
    const base = buildStatisticsPredicate(filter);
    const spending = buildStatisticsPredicate(filter, {
      statuses: SPENDING_STATUSES,
    });
    const userJoin = spending.needsUserJoin
      ? "JOIN users u ON u.id = er.user_id"
      : "";

    const { rows: statRows } = await pool.query(
      `SELECT
         COALESCE(SUM(er.total_amount) FILTER (WHERE er.status IN ('approved', 'paid')), 0) as total_amount,
         COUNT(*) FILTER (WHERE er.status IN ('approved', 'paid')) as total_count,
         COUNT(*) FILTER (WHERE er.status IN ('approved', 'paid')) as approved_count,
         COUNT(*) FILTER (WHERE er.status = 'rejected') as rejected_count,
         COUNT(*) FILTER (WHERE er.status = 'pending') as pending_count,
         COUNT(*) FILTER (WHERE er.status = 'draft') as draft_count
       FROM expense_reports er
       ${base.needsUserJoin ? "LEFT JOIN users u ON u.id = er.user_id" : ""}
       ${base.where}`,
      base.params,
    );

    const { rows: byCategory } = await pool.query(
      `SELECT COALESCE(ec.name, '未分类') AS category, ec.id AS category_id,
              COALESCE(SUM(ei.amount), 0) AS amount,
              COUNT(DISTINCT er.id) AS count
       FROM expense_items ei
       JOIN expense_reports er ON er.id = ei.report_id
       LEFT JOIN expense_categories ec ON ec.id = ei.category_id
       ${userJoin}
       ${spending.where}
       GROUP BY ec.id, COALESCE(ec.name, '未分类')
       ORDER BY amount DESC`,
      spending.params,
    );

    const { rows: byDepartment } = await pool.query(
      `SELECT COALESCE(u.department, '未分配') AS department,
              COALESCE(SUM(er.total_amount), 0) AS amount,
              COUNT(*) AS count
       FROM expense_reports er
       LEFT JOIN users u ON u.id = er.user_id
       ${spending.where}
       GROUP BY COALESCE(u.department, '未分配')
       ORDER BY amount DESC`,
      spending.params,
    );

    const { rows: byMonth } = await pool.query(
      `SELECT month, total_amount, report_count
       FROM (
         SELECT TO_CHAR(er.created_at, 'YYYY-MM') AS month,
                COALESCE(SUM(er.total_amount), 0) AS total_amount,
                COUNT(*) AS report_count
         FROM expense_reports er
         ${userJoin}
         ${spending.where}
         GROUP BY month
         ORDER BY month DESC
         LIMIT 12
       ) recent_months
       ORDER BY month ASC`,
      spending.params,
    );

    const stats = statRows[0];
    const totalAmount = Number(stats.total_amount);
    const reportCount = Number(stats.total_count);

    return successResult({
      scope: scope.kind,
      scope_label: statisticsScopeLabel(scope),
      total_amount: totalAmount,
      report_count: reportCount,
      approved_count: Number(stats.approved_count),
      rejected_count: Number(stats.rejected_count),
      pending_count: Number(stats.pending_count),
      draft_count: Number(stats.draft_count),
      by_category: byCategory.map((r: any) => ({
        category: r.category,
        category_id: r.category_id,
        amount: Number(r.amount),
        count: parseInt(r.count, 10),
      })),
      by_department: byDepartment.map((r: any) => ({
        department: r.department,
        amount: Number(r.amount),
        count: parseInt(r.count, 10),
      })),
      by_month: byMonth.map((r: any) => ({
        month: r.month,
        total_amount: Number(r.total_amount),
        report_count: parseInt(r.report_count, 10),
      })),
      average_per_report: reportCount > 0 ? totalAmount / reportCount : 0,
    });
  } catch (err) {
    return errorResult("INTERNAL_ERROR", err instanceof Error ? err.message : "查询失败");
  }
}
