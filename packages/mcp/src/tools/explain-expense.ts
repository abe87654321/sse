import type { ToolDefinition, ToolResult } from "./types.js";
import { errorResult, successResult } from "./types.js";
import { resolveAuthContext } from "../auth.js";
import { apiError, ontologyClient } from "./ontology-client.js";

export const definition: ToolDefinition = {
  name: "explain_expense",
  description: "解释报销单的审批决策与证据链：匹配规则、审批链、关联实体",
  inputSchema: {
    type: "object",
    properties: {
      report_id: { type: "string", description: "报销单 UUID 或 URI" },
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
    const res = await ontologyClient(auth).explain(reportId);
    if (!res.ok) {
      const err = apiError(res);
      return errorResult(err.code, err.message);
    }
    return successResult(res.data);
  } catch (err: any) {
    return errorResult("INTERNAL_ERROR", err?.message || "内部错误");
  }
}
