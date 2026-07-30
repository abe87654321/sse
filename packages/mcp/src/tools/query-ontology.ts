import type { ToolDefinition, ToolResult } from "./types.js";
import { errorResult, successResult } from "./types.js";
import { resolveAuthContext } from "../auth.js";
import { getEngine } from "./get-engine.js";

export const definition: ToolDefinition = {
  name: "query_ontology",
  description: "查询本体图谱。可按类型过滤，获取全图谱或统计概览",
  inputSchema: {
    type: "object",
    properties: {
      type: { type: "string", description: "实体类型过滤，不填返回全图谱" },
    },
  },
};

export async function handler(args: Record<string, unknown>): Promise<ToolResult> {
  const auth = resolveAuthContext(args);
  if (!auth) return errorResult("UNAUTHORIZED", "无效或缺失 API key");
  try {
    const engine = getEngine();
    if (args.type) {
      const entities = engine.store.queryByType(args.type as string);
      return successResult({ type: args.type, count: entities.length, entities });
    }
    const graph = engine.store.getGraph();
    const typeCounts: Record<string, number> = {};
    for (const node of graph.nodes) { typeCounts[node.type] = (typeCounts[node.type] || 0) + 1; }
    return successResult({ summary: { total_nodes: graph.nodes.length, total_edges: graph.edges.length, type_counts: typeCounts }, graph });
  } catch (err: any) {
    return errorResult("INTERNAL_ERROR", err.message || "内部错误");
  }
}
