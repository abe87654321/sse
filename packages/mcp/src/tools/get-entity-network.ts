import type { ToolDefinition, ToolResult } from "./types.js";
import { errorResult, successResult } from "./types.js";
import { resolveAuthContext } from "../auth.js";
import { apiError, ontologyClient, type OntologyDirection } from "./ontology-client.js";

export const definition: ToolDefinition = {
  name: "get_entity_network",
  description: "获取实体N跳语义关系网络，可视化报销单、人员、部门间的关联",
  inputSchema: {
    type: "object",
    properties: {
      entity_id: { type: "string", description: "实体标识，如报告ID或人员名称" },
      depth: { type: "number", description: "关系跳数，默认2，最大5" },
      direction: {
        type: "string",
        enum: ["both", "out", "in"],
        description: "关系方向，默认 both",
      },
    },
    required: ["entity_id"],
  },
};

function toDirection(value: unknown): OntologyDirection {
  return value === "out" || value === "in" ? value : "both";
}

export async function handler(args: Record<string, unknown>): Promise<ToolResult> {
  const auth = resolveAuthContext(args);
  if (!auth) return errorResult("UNAUTHORIZED", "无效或缺失 API key");

  const entityId = typeof args.entity_id === "string" ? args.entity_id : "";
  if (!entityId) return errorResult("INVALID_PARAMS", "请提供 entity_id");

  const rawDepth = typeof args.depth === "number" ? args.depth : Number(args.depth);
  const depth = Number.isFinite(rawDepth) ? Math.min(5, Math.max(0, Math.floor(rawDepth))) : 2;
  const direction = toDirection(args.direction);
  const targetUri = entityId.includes("://") ? entityId : `https://sse.local/${entityId}`;

  try {
    const res = await ontologyClient(auth).network(targetUri, depth, direction);
    if (!res.ok) {
      const err = apiError(res);
      return errorResult(err.code, err.message);
    }
    return successResult(res.data);
  } catch (err: any) {
    return errorResult("INTERNAL_ERROR", err?.message || "内部错误");
  }
}
