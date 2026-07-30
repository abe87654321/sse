import type { ToolDefinition, ToolResult } from "./types.js";
import { errorResult, successResult } from "./types.js";
import { resolveAuthContext } from "../auth.js";
import { getEngine } from "./get-engine.js";
import { executeSparql } from "@sse/ontology";

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
  try {
    const engine = getEngine();
    const store = engine.store.getStore();
    const result = executeSparql(store, args.query as string);
    return successResult(result);
  } catch (err: any) {
    return errorResult("INTERNAL_ERROR", err.message || "内部错误");
  }
}
