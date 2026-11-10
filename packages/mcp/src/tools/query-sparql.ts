import type { ToolDefinition, ToolResult } from "./types.js";
import { errorResult, successResult } from "./types.js";
import { resolveAuthContext } from "../auth.js";
import { ensureOntologyLoaded } from "./get-engine.js";
import { executeSparql } from "@sse/ontology";
import { UserRole } from "@sse/shared";

export const definition: ToolDefinition = {
  name: "query_sparql",
  description: "Execute a SPARQL query against the SSE ontology knowledge graph for cross-domain queries.",
  inputSchema: {
    type: "object",
    properties: {
      query: { type: "string", description: "SPARQL SELECT query string, e.g. SELECT ?s ?p ?o WHERE { ?s ?p ?o }" },
    },
    required: ["query"],
  },
};

export async function handler(args: Record<string, unknown>): Promise<ToolResult> {
  const auth = resolveAuthContext(args);
  if (!auth) return errorResult("UNAUTHORIZED", "无效或缺失 API key");
  if (auth.role !== UserRole.ADMIN && auth.role !== UserRole.FINANCE) {
    return errorResult("FORBIDDEN", "仅管理员和财务可执行 SPARQL 查询");
  }
  try {
    const engine = await ensureOntologyLoaded();
    const store = engine.store.getStore();
    const result = executeSparql(store, args.query as string);
    return successResult(result);
  } catch (err: any) {
    return errorResult("INTERNAL_ERROR", err.message || "内部错误");
  }
}
