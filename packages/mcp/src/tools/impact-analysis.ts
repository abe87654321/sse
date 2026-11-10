import type { ToolDefinition, ToolResult } from "./types.js";
import { errorResult, successResult } from "./types.js";
import { resolveAuthContext } from "../auth.js";
import { apiError, ontologyClient } from "./ontology-client.js";

const FILTERS = [
  "rule_id",
  "category_id",
  "department",
  "min_amount",
  "max_amount",
  "amount_delta",
] as const;

export const definition: ToolDefinition = {
  name: "impact_analysis",
  description: "评估规则/类别/部门/金额变化对报销单与审批链的影响",
  inputSchema: {
    type: "object",
    properties: {
      rule_id: { type: "string", description: "审批规则 ID（可选）" },
      category_id: { type: "string", description: "费用类别 ID（可选）" },
      department: { type: "string", description: "部门过滤（可选）" },
      min_amount: { type: "number", description: "金额下限（可选）" },
      max_amount: { type: "number", description: "金额上限（可选）" },
      amount_delta: { type: "number", description: "金额变动量（可选）" },
    },
  },
};

export async function handler(args: Record<string, unknown>): Promise<ToolResult> {
  const auth = resolveAuthContext(args);
  if (!auth) return errorResult("UNAUTHORIZED", "无效或缺失 API key");

  const body: Record<string, unknown> = {};
  for (const key of FILTERS) {
    const value = args[key];
    if (value !== undefined && value !== null && value !== "") body[key] = value;
  }

  try {
    const res = await ontologyClient(auth).impact(body);
    if (!res.ok) {
      const err = apiError(res);
      return errorResult(err.code, err.message);
    }
    return successResult(res.data);
  } catch (err: any) {
    return errorResult("INTERNAL_ERROR", err?.message || "内部错误");
  }
}
