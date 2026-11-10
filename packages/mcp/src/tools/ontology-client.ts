import { apiJson, type ApiRequestOptions, type ApiResult } from "./api-client.js";
import type { AuthContext } from "../auth.js";

export type OntologyDirection = "both" | "out" | "in";

/**
 * Serializes a plain object into a query string. Undefined/null/empty values
 * are dropped and arrays are joined with commas so multi-value filters such as
 * `codes` round-trip cleanly.
 */
function toQuery(input: Record<string, unknown>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(input)) {
    if (value === undefined || value === null || value === "") continue;
    if (Array.isArray(value)) {
      if (value.length === 0) continue;
      params.set(key, value.map((item) => String(item)).join(","));
      continue;
    }
    params.set(key, String(value));
  }
  return params.toString();
}

/**
 * Thin client for the ontology v2 REST surface. Every method returns the raw
 * `{ ok, status, data }` envelope so tool handlers own error mapping and no API
 * error shape is swallowed here.
 */
export function ontologyClient(auth: AuthContext, options: ApiRequestOptions = {}) {
  const call = (method: string, path: string, body?: unknown): Promise<ApiResult> =>
    apiJson(auth, method, path, body, options);

  return {
    getStatus: () => call("GET", "/ontology/status"),
    getSchema: () => call("GET", "/ontology/schema"),
    graph: () => call("GET", "/ontology/graph"),
    search: (input: Record<string, unknown>) => call("POST", "/ontology/query", input),
    listEntities: (input: Record<string, unknown>) =>
      call("GET", `/ontology/entities?${toQuery(input)}`),
    getEntity: (uri: string) =>
      call("GET", `/ontology/entities/${encodeURIComponent(uri)}`),
    network: (uri: string, depth: number, direction: OntologyDirection = "both") =>
      call(
        "GET",
        `/ontology/entities/${encodeURIComponent(uri)}/network?depth=${encodeURIComponent(
          String(depth),
        )}&direction=${encodeURIComponent(direction)}`,
      ),
    sparql: (query: string) => call("POST", "/ontology/sparql", { query }),
    validate: (input: Record<string, unknown>) => call("POST", "/ontology/validate", input),
    explain: (reportId: string) => call("POST", "/ontology/explain", { report_id: reportId }),
    impact: (input: Record<string, unknown>) => call("POST", "/ontology/impact", input),
    anomalies: (input: Record<string, unknown>) =>
      call("GET", `/ontology/anomalies?${toQuery(input)}`),
  };
}

export type OntologyClient = ReturnType<typeof ontologyClient>;

/**
 * Normalizes an API error envelope into `{ code, message }` so every tool maps
 * failures the same way. Non-JSON bodies fall back to an HTTP status message.
 */
export function apiError(res: ApiResult): { code: string; message: string } {
  const code =
    (typeof res.data?.error?.code === "string" && res.data.error.code) ||
    (res.status === 401 ? "UNAUTHORIZED" : "API_ERROR");
  const message =
    (typeof res.data?.error?.message === "string" && res.data.error.message) ||
    `本体 API 请求失败 (${res.status})`;
  return { code, message };
}
