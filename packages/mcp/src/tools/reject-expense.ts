import type { ToolDefinition, ToolResult } from "./types.js";
import { errorResult, successResult } from "./types.js";
import { resolveAuthContext } from "../auth.js";
import { callApprovalApi } from "./approval-client.js";

export const definition: ToolDefinition = {
  name: "reject_expense",
  description: "驳回报销单（部门审批人/财务/管理员），必须填写驳回意见。",
  inputSchema: {
    type: "object",
    properties: {
      report_id: { type: "string", description: "报销单 UUID" },
      comment: { type: "string", description: "驳回意见（必填）" },
    },
    required: ["report_id", "comment"],
  },
};

export async function handler(args: Record<string, unknown>): Promise<ToolResult> {
  const auth = resolveAuthContext(args);
  if (!auth) return errorResult("UNAUTHORIZED", "无效或缺失 API key");

  const reportId = typeof args.report_id === "string" ? args.report_id : "";
  if (!reportId) return errorResult("INVALID_PARAMS", "请提供 report_id");

  const comment = typeof args.comment === "string" ? args.comment.trim() : "";
  if (!comment) return errorResult("INVALID_PARAMS", "驳回时必须填写 comment");

  try {
    const { ok, status, data } = await callApprovalApi(auth, reportId, "reject", {
      comment,
    });

    if (!ok) {
      return errorResult(
        data?.error?.code || "REJECT_FAILED",
        data?.error?.message || `驳回失败 (HTTP ${status})`,
      );
    }
    return successResult(data);
  } catch (err: any) {
    return errorResult("INTERNAL_ERROR", err.message || "内部错误");
  }
}
