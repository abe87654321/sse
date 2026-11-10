import type { ToolDefinition, ToolResult } from "./types.js";
import { errorResult, successResult } from "./types.js";
import { resolveAuthContext } from "../auth.js";
import { apiError, ontologyClient } from "./ontology-client.js";
import { UserRole } from "@sse/shared";

export const definition: ToolDefinition = {
  name: "query_sparql",
  description: "Execute a SELECT-only SPARQL query against the SSE ontology (bounded result set).",
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

  const query = typeof args.query === "string" ? args.query : "";
  if (!query) return errorResult("INVALID_PARAMS", "请提供 query");

  try {
    const res = await ontologyClient(auth).sparql(query);
    if (!res.ok) {
      const err = apiError(res);
      return errorResult(err.code, err.message);
    }
    return successResult(res.data);
  } catch (err: any) {
    return errorResult("INTERNAL_ERROR", err?.message || "内部错误");
  }
}
