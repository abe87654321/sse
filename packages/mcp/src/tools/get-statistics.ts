import { pool } from "@sse/db";
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
    const dateFrom = parseISO8601Date(args.date_from);
    const dateTo = parseISO8601Date(args.date_to);
    let department = typeof args.department === "string" ? args.department : undefined;

    if (auth.role === "dept_approver") {
      department = auth.department;
    } else if (auth.role === "employee") {
      department = undefined;
    }

    const conditions: string[] = [];
    const values: any[] = [];
    let idx = 1;
    let joinClause = "";
    let userJoin = "";

    if (auth.role === "employee") {
      conditions.push(`er.user_id = $${idx++}`);
      values.push(auth.userId);
    } else if (department) {
      userJoin = "JOIN users u ON u.id = er.user_id";
      conditions.push(`u.department = $${idx++}`);
      values.push(department);
    }

    if (dateFrom) { conditions.push(`er.created_at >= $${idx++}`); values.push(dateFrom); }
    if (dateTo) { conditions.push(`er.created_at <= $${idx++}`); values.push(dateTo); }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    const { rows: statRows } = await pool.query(
      `SELECT
         COALESCE(SUM(er.total_amount), 0) as total_amount,
         COUNT(*) as report_count
       FROM expense_reports er
       ${userJoin}
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
       ${userJoin}
       ${where}
       GROUP BY ec.id, ec.name
       ORDER BY amount DESC`,
      values,
    );

    const { rows: byDepartment } = await pool.query(
      `SELECT u.department, COALESCE(SUM(er.total_amount), 0) AS amount, COUNT(*) AS count
       FROM expense_reports er
       JOIN users u ON u.id = er.user_id
       ${userJoin ? "" : ""}
       ${where}
       GROUP BY u.department
       ORDER BY amount DESC`,
      values,
    );

    return successResult({
      total_amount: totalAmount,
      report_count: reportCount,
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
      average_per_report: reportCount > 0 ? totalAmount / reportCount : 0,
    });
  } catch (err) {
    return errorResult("INTERNAL_ERROR", err instanceof Error ? err.message : "查询失败");
  }
}
