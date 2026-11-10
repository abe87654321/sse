import type { ToolDefinition, ToolResult } from "./types.js";
import { errorResult, successResult } from "./types.js";
import { resolveAuthContext } from "../auth.js";
import { callApprovalApi } from "./approval-client.js";

export const definition: ToolDefinition = {
  name: "approve_expense",
  description:
    "审批通过报销单（部门审批人/财务/管理员）。若存在 AI 核对差异或尚未核对，需传 acknowledge_verification=true。",
  inputSchema: {
    type: "object",
    properties: {
      report_id: { type: "string", description: "报销单 UUID" },
      comment: { type: "string", description: "审批意见（可选）" },
      acknowledge_verification: {
        type: "boolean",
        description: "已知晓 AI 核对差异并继续审批（存在差异时必传 true）",
      },
    },
    required: ["report_id"],
  },
};

export async function handler(args: Record<string, unknown>): Promise<ToolResult> {
  const auth = resolveAuthContext(args);
  if (!auth) return errorResult("UNAUTHORIZED", "无效或缺失 API key");

  const reportId = typeof args.report_id === "string" ? args.report_id : "";
  if (!reportId) return errorResult("INVALID_PARAMS", "请提供 report_id");

  try {
    const { ok, status, data } = await callApprovalApi(auth, reportId, "approve", {
      comment: typeof args.comment === "string" ? args.comment : undefined,
      acknowledgeVerification: args.acknowledge_verification === true ? true : undefined,
    });

    if (!ok) {
      return errorResult(
        data?.error?.code || "APPROVE_FAILED",
        data?.error?.message || `审批失败 (HTTP ${status})`,
      );
    }
    return successResult(data);
  } catch (err: any) {
    return errorResult("INTERNAL_ERROR", err.message || "内部错误");
  }
}
