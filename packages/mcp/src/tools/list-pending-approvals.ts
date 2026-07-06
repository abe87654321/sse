import { pool } from "@sse/db";
import { resolveAuthContext } from "../auth.js";
import { ToolDefinition, ToolResult, toPaginated, errorResult, successResult, formatTimestamp } from "./types.js";

export const definition: ToolDefinition = {
  name: "list_pending_approvals",
  description: "列出指定审批人的待审批报销单",
  inputSchema: {
    type: "object",
    properties: {
      approver_id: { type: "string", description: "审批人用户UUID" },
      page: { type: "number", description: "页码，默认1", default: 1 },
      page_size: { type: "number", description: "每页条数，默认20，最大100", default: 20 },
    },
    required: ["approver_id"],
  },
};

export async function handler(args: Record<string, unknown>): Promise<ToolResult> {
  const auth = resolveAuthContext(args);
  if (!auth) {
    return errorResult("UNAUTHORIZED", "缺少有效的 API Key");
  }

  const approverId = typeof args.approver_id === "string" ? args.approver_id : "";
  if (!approverId) {
    return errorResult("INVALID_PARAMS", "approver_id 为必填参数");
  }

  if (auth.role === "employee" && auth.userId !== approverId) {
    return errorResult("UNAUTHORIZED", "无权查询其他审批人的待审批列表");
  }

  if (auth.role === "dept_approver" && auth.userId !== approverId) {
    return errorResult("UNAUTHORIZED", "只能查询自己的待审批列表");
  }

  const page = Math.max(1, (typeof args.page === "number" ? args.page : parseInt(String(args.page ?? "1"), 10)) || 1);
  const pageSize = Math.min(100, Math.max(1, (typeof args.page_size === "number" ? args.page_size : parseInt(String(args.page_size ?? "20"), 10)) || 20));
  const offset = (page - 1) * pageSize;

  try {
    const [dataRes, countRes] = await Promise.all([
      pool.query(
        `SELECT DISTINCT er.* FROM expense_reports er
         JOIN approval_records ar ON ar.report_id = er.id
         WHERE ar.approver_id = $1 AND ar.result = 'pending'
         ORDER BY er.created_at DESC
         LIMIT $2 OFFSET $3`,
        [approverId, pageSize, offset],
      ),
      pool.query(
        `SELECT COUNT(DISTINCT er.id) FROM expense_reports er
         JOIN approval_records ar ON ar.report_id = er.id
         WHERE ar.approver_id = $1 AND ar.result = 'pending'`,
        [approverId],
      ),
    ]);

    const results = dataRes.rows.map((r: any) => ({
      id: r.id,
      serial_no: r.serial_no,
      user_id: r.user_id,
      title: r.title,
      total_amount: Number(r.total_amount),
      status: r.status,
      current_step: r.current_step,
      submitted_at: formatTimestamp(r.submitted_at),
      created_at: formatTimestamp(r.created_at),
    }));

    return successResult(
      toPaginated(results, parseInt(countRes.rows[0].count, 10), page, pageSize),
    );
  } catch (err) {
    return errorResult("INTERNAL_ERROR", err instanceof Error ? err.message : "查询失败");
  }
}
