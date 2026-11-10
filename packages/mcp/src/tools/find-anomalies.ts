import type { ToolDefinition, ToolResult } from "./types.js";
import { errorResult, successResult } from "./types.js";
import { resolveAuthContext } from "../auth.js";
import { apiError, ontologyClient } from "./ontology-client.js";

export const definition: ToolDefinition = {
  name: "find_anomalies",
  description: "扫描本体图谱中的异常：金额不一致、发票号重复、审批人缺失",
  inputSchema: {
    type: "object",
    properties: {
      codes: {
        type: "array",
        items: { type: "string" },
        description: "异常类型过滤，如 amount_mismatch、duplicate_invoice_no、missing_approver",
      },
      limit: { type: "number", description: "返回数量上限，默认 500" },
    },
  },
};

export async function handler(args: Record<string, unknown>): Promise<ToolResult> {
  const auth = resolveAuthContext(args);
  if (!auth) return errorResult("UNAUTHORIZED", "无效或缺失 API key");

  const input: Record<string, unknown> = {};
  if (Array.isArray(args.codes)) {
    const codes = args.codes.filter((code): code is string => typeof code === "string" && code !== "");
    if (codes.length > 0) input.codes = codes;
  }
  if (typeof args.limit === "number" && Number.isFinite(args.limit)) {
    input.limit = args.limit;
  }

  try {
    const res = await ontologyClient(auth).anomalies(input);
    if (!res.ok) {
      const err = apiError(res);
      return errorResult(err.code, err.message);
    }
    return successResult(res.data);
  } catch (err: any) {
    return errorResult("INTERNAL_ERROR", err?.message || "内部错误");
  }
}
