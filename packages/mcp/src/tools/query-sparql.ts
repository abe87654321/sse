import type { ToolDefinition, ToolResult } from "./types.js";
import { errorResult, successResult } from "./types.js";
import { resolveAuthContext } from "../auth.js";

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
    const apiBase = process.env.API_BASE || "http://localhost:3000";
    const res = await fetch(`${apiBase}/ontology/sparql`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${args["api_key"]}` },
      body: JSON.stringify({ query: args.query }),
    });
    return successResult(await res.json());
  } catch (err: any) {
    return errorResult("INTERNAL_ERROR", err.message || "内部错误");
  }
}
