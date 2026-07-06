import { PgExpenseRepo, PgApprovalRecordRepo, pool } from "@sse/db";
import { resolveAuthContext } from "../auth.js";
import { ToolDefinition, ToolResult, errorResult, successResult, formatTimestamp } from "./types.js";
import { canViewReport } from "@sse/auth";
import { UserRole } from "@sse/shared";

export const definition: ToolDefinition = {
  name: "get_approval_status",
  description: "查询报销单审批状态，包含审批历史和当前进度",
  inputSchema: {
    type: "object",
    properties: {
      report_id: { type: "string", description: "报销单UUID" },
    },
    required: ["report_id"],
  },
};

export async function handler(args: Record<string, unknown>): Promise<ToolResult> {
  const auth = resolveAuthContext(args);
  if (!auth) {
    return errorResult("UNAUTHORIZED", "缺少有效的 API Key");
  }

  const reportId = typeof args.report_id === "string" ? args.report_id : "";
  if (!reportId) {
    return errorResult("INVALID_PARAMS", "report_id 为必填参数");
  }

  try {
    const expenseRepo = new PgExpenseRepo();
    const approvalRepo = new PgApprovalRecordRepo();

    const report = await expenseRepo.findById(reportId);
    if (!report) {
      return errorResult("NOT_FOUND", `报销单 ${reportId} 不存在`);
    }

    const { rows: userRows } = await pool.query("SELECT department FROM users WHERE id = $1", [report.userId]);
    const ownerDept = userRows[0]?.department ?? "";

    if (!canViewReport(auth.role as UserRole, auth.department, ownerDept, report.userId, auth.userId)) {
      return errorResult("UNAUTHORIZED", "无权查看此报销单的审批状态");
    }

    const records = await approvalRepo.findByReportId(reportId);

    return successResult({
      report_id: reportId,
      status: report.status,
      current_step: report.currentStep,
      total_steps: records.length,
      history: records.map((r) => ({
        step: r.step,
        approver_id: r.approverId,
        result: r.result,
        comment: r.comment ?? null,
        approved_at: formatTimestamp(r.approvedAt),
        started_at: formatTimestamp(r.stepStartedAt),
      })),
    });
  } catch (err) {
    return errorResult("INTERNAL_ERROR", err instanceof Error ? err.message : "查询失败");
  }
}
