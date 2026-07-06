import { pool } from "@sse/db";
import { resolveAuthContext, enforceReadAccess } from "../auth.js";
import { ToolDefinition, ToolResult, parseISO8601Date, errorResult, successResult } from "./types.js";

export const definition: ToolDefinition = {
  name: "get_user_summary",
  description: "获取用户报销汇总，包含报销单数、总额、分类汇总",
  inputSchema: {
    type: "object",
    properties: {
      user_id: { type: "string", description: "用户UUID" },
      date_from: { type: "string", description: "起始日期 YYYY-MM-DD" },
      date_to: { type: "string", description: "截止日期 YYYY-MM-DD" },
    },
    required: ["user_id"],
  },
};

export async function handler(args: Record<string, unknown>): Promise<ToolResult> {
  const auth = resolveAuthContext(args);
  if (!auth) {
    return errorResult("UNAUTHORIZED", "缺少有效的 API Key");
  }

  const userId = typeof args.user_id === "string" ? args.user_id : "";
  if (!userId) {
    return errorResult("INVALID_PARAMS", "user_id 为必填参数");
  }

  try {
    const { rows: targetUsers } = await pool.query(
      "SELECT department FROM users WHERE id = $1",
      [userId],
    );
    if (targetUsers.length === 0) {
      return errorResult("NOT_FOUND", `用户 ${userId} 不存在`);
    }

    const targetDept = targetUsers[0].department;
    if (!enforceReadAccess(auth, userId, targetDept)) {
      return errorResult("UNAUTHORIZED", "无权查看此用户的报销汇总");
    }

    const dateFrom = parseISO8601Date(args.date_from);
    const dateTo = parseISO8601Date(args.date_to);

    const conditions: string[] = ["er.user_id = $1"];
    const values: any[] = [userId];
    let idx = 2;

    if (dateFrom) { conditions.push(`er.created_at >= $${idx++}`); values.push(dateFrom); }
    if (dateTo) { conditions.push(`er.created_at <= $${idx++}`); values.push(dateTo); }

    const where = `WHERE ${conditions.join(" AND ")}`;

    const { rows: statRows } = await pool.query(
      `SELECT
         COALESCE(SUM(er.total_amount), 0) as total_amount,
         COUNT(*) as report_count
       FROM expense_reports er
       ${where}`,
      values,
    );

    const totalAmount = Number(statRows[0].total_amount);
    const reportCount = parseInt(statRows[0].report_count, 10);

    const { rows: byCategory } = await pool.query(
      `SELECT ec.name AS category, ec.id AS category_id, COALESCE(SUM(ei.amount), 0) AS amount, COUNT(DISTINCT er.id) AS count
       FROM expense_items ei
       JOIN expense_reports er ON er.id = ei.report_id
       JOIN expense_categories ec ON ec.id = ei.category_id
       ${where}
       GROUP BY ec.id, ec.name
       ORDER BY amount DESC`,
      values,
    );

    return successResult({
      user_id: userId,
      report_count: reportCount,
      total_amount: totalAmount,
      by_category: byCategory.map((r: any) => ({
        category: r.category,
        category_id: r.category_id,
        amount: Number(r.amount),
        count: parseInt(r.count, 10),
      })),
    });
  } catch (err) {
    return errorResult("INTERNAL_ERROR", err instanceof Error ? err.message : "查询失败");
  }
}
