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
    if (res.status === 404) {
      return errorResult("FORBIDDEN", "无权访问该实体");
    }
    if (!res.ok) {
      const err = apiError(res);
      return errorResult(err.code, err.message);
    }

    const rawNodes = Array.isArray(res.data?.nodes) ? res.data.nodes : [];
    // The legacy tool treated an out-of-scope root as forbidden; the API now
    // returns 404 for that case, but keep the empty-network guard as a fallback.
    if (rawNodes.length === 0) {
      return errorResult("FORBIDDEN", "无权访问该实体");
    }

    const nodes = rawNodes.map((node: any) => {
      const uri = typeof node?.uri === "string" ? node.uri : "";
      return {
        id: uri,
        uri,
        type: typeof node?.type === "string" ? node.type : "",
        properties: node?.properties && typeof node.properties === "object" ? node.properties : {},
      };
    });
    const edges = Array.isArray(res.data?.edges) ? res.data.edges : [];

    return successResult({
      center: targetUri,
      depth,
      nodes,
      edges,
      node_count: nodes.length,
      edge_count: edges.length,
    });
  } catch (err: any) {
    return errorResult("INTERNAL_ERROR", err?.message || "内部错误");
  }
}
