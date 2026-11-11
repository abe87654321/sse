import type { ToolDefinition, ToolResult } from "./types.js";
import { errorResult, successResult } from "./types.js";
import { resolveAuthContext } from "../auth.js";
import { apiError, ontologyClient } from "./ontology-client.js";

export const definition: ToolDefinition = {
  name: "get_ontology_schema",
  description: "获取本体模式（类与属性列表），用于构造查询和了解可用的实体/关系",
  inputSchema: {
    type: "object",
    properties: {},
  },
};

export async function handler(args: Record<string, unknown>): Promise<ToolResult> {
  const auth = resolveAuthContext(args);
  if (!auth) return errorResult("UNAUTHORIZED", "无效或缺失 API key");

  try {
    const res = await ontologyClient(auth).getSchema();
    if (!res.ok) {
      const err = apiError(res);
      return errorResult(err.code, err.message);
    }
    return successResult(res.data);
  } catch (err: any) {
    return errorResult("INTERNAL_ERROR", err?.message || "内部错误");
  }
}
