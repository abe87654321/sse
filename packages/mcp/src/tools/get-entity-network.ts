import type { ToolDefinition, ToolResult } from "./types.js";
import { errorResult, successResult } from "./types.js";
import { resolveAuthContext } from "../auth.js";
import { OntologyEngine } from "@sse/ontology";
import type { GraphNode, GraphEdge } from "@sse/ontology";
import { readFileSync, existsSync } from "fs";
import { join } from "path";

const CONFIG_PATH = join(process.cwd(), "ai-config.json");

function getEngine(): OntologyEngine {
  const defaults = { fillEngine: { endpoint: "http://localhost:11434/v1/chat/completions", model: "llama3.2-vision" } };
  let cfg = defaults;
  try { if (existsSync(CONFIG_PATH)) { const saved = JSON.parse(readFileSync(CONFIG_PATH, "utf-8")); cfg = { ...defaults, fillEngine: { ...defaults.fillEngine, ...(saved.fillEngine || {}) } }; } } catch { /* use defaults */ }
  if (process.env.AI_ENDPOINT) cfg.fillEngine.endpoint = process.env.AI_ENDPOINT;
  if (process.env.AI_MODEL) cfg.fillEngine.model = process.env.AI_MODEL;
  return new OntologyEngine(cfg.fillEngine.endpoint, cfg.fillEngine.model);
}

export const definition: ToolDefinition = {
  name: "get_entity_network",
  description: "获取实体N跳语义关系网络，可视化报销单、人员、部门间的关联",
  inputSchema: {
    type: "object",
    properties: {
      entity_id: { type: "string", description: "实体标识，如报告ID或人员名称" },
      depth: { type: "number", description: "关系跳数，默认2" },
    },
    required: ["entity_id"],
  },
};

export async function handler(args: Record<string, unknown>): Promise<ToolResult> {
  const auth = resolveAuthContext(args);
  if (!auth) return errorResult("UNAUTHORIZED", "无效或缺失 API key");
  const entityId = args.entity_id as string;
  const depth = (args.depth as number) || 2;
  if (!entityId) return errorResult("INVALID_PARAMS", "请提供 entity_id");
  try {
    const engine = getEngine();
    const graph = engine.store.getGraph();
    const targetUri = entityId.includes("://") ? entityId : `https://sse.local/${entityId}`;
    const visited = new Set<string>();
    const neighborhoodNodes: typeof graph.nodes = [];
    const neighborhoodEdges: typeof graph.edges = [];
    function expand(currentUri: string, currentDepth: number) {
      if (currentDepth > depth || visited.has(currentUri)) return;
      visited.add(currentUri);
      const node = graph.nodes.find(n => n.id === currentUri);
      if (node && !neighborhoodNodes.find(n => n.id === currentUri)) neighborhoodNodes.push(node);
      for (const edge of graph.edges) {
        if (edge.from === currentUri || edge.to === currentUri) {
          if (!neighborhoodEdges.find(e => e.id === edge.id)) neighborhoodEdges.push(edge);
          const neighbor = edge.from === currentUri ? edge.to : edge.from;
          if (!visited.has(neighbor)) expand(neighbor, currentDepth + 1);
        }
      }
    }
    expand(targetUri, 0);
    return successResult({ center: targetUri, depth, nodes: neighborhoodNodes, edges: neighborhoodEdges, node_count: neighborhoodNodes.length, edge_count: neighborhoodEdges.length });
  } catch (err: any) {
    return errorResult("INTERNAL_ERROR", err.message || "内部错误");
  }
}
