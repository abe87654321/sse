import type { ToolDefinition, ToolResult } from "./types.js";
import { errorResult, successResult } from "./types.js";
import { resolveAuthContext } from "../auth.js";
import { apiError, ontologyClient } from "./ontology-client.js";

const FILTER_KEYS = ["status", "department", "q", "page", "page_size"] as const;

export const definition: ToolDefinition = {
  name: "query_ontology",
  description: "查询本体图谱。可按类型、状态、部门、关键词过滤，获取实体列表或统计概览",
  inputSchema: {
    type: "object",
    properties: {
      type: { type: "string", description: "实体类型过滤，如 Person、ExpenseReport" },
      status: { type: "string", description: "状态过滤（可选）" },
      department: { type: "string", description: "部门过滤（可选）" },
      q: { type: "string", description: "关键词搜索（可选）" },
      page: { type: "number", description: "页码，默认 1" },
      page_size: { type: "number", description: "每页条数，默认 20，最大 100" },
    },
  },
};

function hasFilters(args: Record<string, unknown>): boolean {
  return FILTER_KEYS.some((key) => {
    const value = args[key];
    return value !== undefined && value !== null && value !== "";
  });
}

export async function handler(args: Record<string, unknown>): Promise<ToolResult> {
  const auth = resolveAuthContext(args);
  if (!auth) return errorResult("UNAUTHORIZED", "无效或缺失 API key");

  const type = typeof args.type === "string" && args.type ? args.type : undefined;

  try {
    const client = ontologyClient(auth);

    // Legacy `{ type }` contract: [{ uri, properties }] with a count wrapper.
    if (type && !hasFilters(args)) {
      const res = await client.listEntities({ type });
      if (!res.ok) {
        const err = apiError(res);
        return errorResult(err.code, err.message);
      }
      const entities = Array.isArray(res.data)
        ? res.data
        : Array.isArray(res.data?.results)
          ? res.data.results
          : [];
      return successResult({ type, count: entities.length, entities });
    }

    const body: Record<string, unknown> = {};
    for (const key of ["type", ...FILTER_KEYS]) {
      const value = args[key];
      if (value !== undefined && value !== null && value !== "") body[key] = value;
    }

    const res = await client.search(body);
    if (!res.ok) {
      const err = apiError(res);
      return errorResult(err.code, err.message);
    }
    return successResult(res.data);
  } catch (err: any) {
    return errorResult("INTERNAL_ERROR", err?.message || "内部错误");
  }
}
