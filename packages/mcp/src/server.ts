import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

import * as searchExpensesTool from "./tools/search-expenses.js";
import * as getExpenseDetailTool from "./tools/get-expense-detail.js";
import * as getApprovalStatusTool from "./tools/get-approval-status.js";
import * as getStatisticsTool from "./tools/get-statistics.js";
import * as getUserSummaryTool from "./tools/get-user-summary.js";
import * as listPendingApprovalsTool from "./tools/list-pending-approvals.js";
import * as submitExpenseFromTextTool from "./tools/submit-expense-from-text.js";
import * as submitExpenseFromInvoiceTool from "./tools/submit-expense-from-invoice.js";
import * as approveExpenseTool from "./tools/approve-expense.js";
import * as rejectExpenseTool from "./tools/reject-expense.js";
import * as uploadInvoiceTool from "./tools/upload-invoice.js";
import * as verifyExpenseTool from "./tools/verify-expense.js";
import * as queryExpenseStatusTool from "./tools/query-expense-status.js";
import * as explainDecisionTool from "./tools/explain-decision.js";
import * as getEntityNetworkTool from "./tools/get-entity-network.js";
import * as validateExpenseTool from "./tools/validate-expense.js";
import * as queryOntologyTool from "./tools/query-ontology.js";
import * as querySparqlTool from "./tools/query-sparql.js";
import * as explainExpenseTool from "./tools/explain-expense.js";
import * as impactAnalysisTool from "./tools/impact-analysis.js";
import * as findAnomaliesTool from "./tools/find-anomalies.js";
import * as getOntologySchemaTool from "./tools/get-ontology-schema.js";
import { checkRateLimit, pruneRateLimitStore, type RateLimitWindow } from "@sse/auth";
import { resolveAuthContext } from "./auth.js";
import { errorResult } from "./tools/types.js";
import type { ToolDefinition, ToolResult } from "./tools/types.js";

export interface ToolEntry {
  definition: ToolDefinition;
  handler: (args: Record<string, unknown>) => Promise<ToolResult>;
}

export const allTools: ToolEntry[] = [
  searchExpensesTool,
  getExpenseDetailTool,
  getApprovalStatusTool,
  getStatisticsTool,
  getUserSummaryTool,
  listPendingApprovalsTool,
  submitExpenseFromTextTool,
  submitExpenseFromInvoiceTool,
  approveExpenseTool,
  rejectExpenseTool,
  uploadInvoiceTool,
  verifyExpenseTool,
  queryExpenseStatusTool,
  explainDecisionTool,
  getEntityNetworkTool,
  validateExpenseTool,
  queryOntologyTool,
  querySparqlTool,
  explainExpenseTool,
  impactAnalysisTool,
  findAnomaliesTool,
  getOntologySchemaTool,
];

const toolMap = new Map(allTools.map((t) => [t.definition.name, t]));

// Per-process, per-user fixed-window limit. Multiple MCP instances each keep
// their own window; put a shared limiter in front if you run a cluster.
const rateStore = new Map<string, RateLimitWindow>();
const RATE_LIMIT_PER_MIN = Number(process.env.MCP_RATE_LIMIT_PER_MIN) || 120;
const RATE_WINDOW_MS = 60_000;
const AUDIT_ENABLED = process.env.MCP_AUDIT_LOG !== "0";

export const TOOL_TIMEOUT_MS = Number(process.env.MCP_TOOL_TIMEOUT_MS) || 10_000;

const ratePruneTimer = setInterval(() => pruneRateLimitStore(rateStore), RATE_WINDOW_MS);
ratePruneTimer.unref?.();

function audit(event: Record<string, unknown>): void {
  if (!AUDIT_ENABLED) return;
  // stderr only: stdout is the JSON-RPC channel for the stdio transport.
  console.error(`[mcp-audit] ${JSON.stringify({ ts: new Date().toISOString(), ...event })}`);
}

function auditCall(event: {
  tool: string | null;
  userId: string | null;
  role: string | null;
  ok: boolean;
  durationMs: number;
  errorCode?: string | null;
  resultCount?: number | null;
  timedOut?: boolean;
}): void {
  audit({
    tool: event.tool,
    user_id: event.userId,
    role: event.role,
    duration_ms: event.durationMs,
    ok: event.ok,
    error_code: event.errorCode ?? null,
    result_count: event.resultCount ?? null,
    timed_out: event.timedOut ?? false,
  });
}

export class ToolTimeoutError extends Error {
  constructor(tool: string) {
    super(`tool ${tool} timed out`);
    this.name = "ToolTimeoutError";
  }
}

export function withTimeout<T>(
  promise: Promise<T>,
  tool: string,
  timeoutMs: number = TOOL_TIMEOUT_MS,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new ToolTimeoutError(tool)), timeoutMs);
    timer.unref?.();
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

function parseResultPayload(result: ToolResult): any {
  try {
    return JSON.parse(result.content?.[0]?.text ?? "");
  } catch {
    return null;
  }
}

/** Best-effort result cardinality for the audit trail. */
function resultCountOf(data: any): number | null {
  if (data === null || data === undefined) return null;
  if (Array.isArray(data)) return data.length;
  if (typeof data !== "object") return null;

  for (const key of [
    "results",
    "entities",
    "items",
    "anomalies",
    "nodes",
    "classes",
    "properties",
  ]) {
    if (Array.isArray(data[key])) return data[key].length;
  }
  if (data.summary && typeof data.summary.total === "number") return data.summary.total;
  if (typeof data.total === "number") return data.total;
  if (typeof data.count === "number") return data.count;
  return null;
}

export function createToolCallHandler(
  getTool: (name: string) => ToolEntry | undefined = (name) => toolMap.get(name),
  options: { timeoutMs?: number } = {},
): (request: any) => Promise<ToolResult> {
  const timeoutMs = options.timeoutMs ?? TOOL_TIMEOUT_MS;

  return async (request: any): Promise<ToolResult> => {
    const params = request?.params;

    if (!params) {
      return errorResult("INVALID_PARAMS", "缺少请求参数");
    }

    const name = params.name;
    const tool = getTool(name);

    if (!tool) {
      auditCall({
        tool: name ?? null,
        userId: null,
        role: null,
        ok: false,
        durationMs: 0,
        errorCode: "NOT_FOUND",
        resultCount: 0,
      });
      return errorResult("NOT_FOUND", `未知工具: ${name}`);
    }

    const args = (params.arguments ?? {}) as Record<string, unknown>;
    const auth = resolveAuthContext(args);

    const schema = tool.definition.inputSchema as any;
    if (schema?.required) {
      for (const field of schema.required) {
        if (args[field] === undefined || args[field] === null || args[field] === "") {
          auditCall({
            tool: name,
            userId: auth?.userId ?? null,
            role: auth?.role ?? null,
            ok: false,
            durationMs: 0,
            errorCode: "INVALID_PARAMS",
            resultCount: 0,
          });
          return errorResult("INVALID_PARAMS", `缺少必填参数: ${field}`);
        }
      }
    }

    if (auth) {
      const limited = checkRateLimit(rateStore, auth.userId, {
        limit: RATE_LIMIT_PER_MIN,
        windowMs: RATE_WINDOW_MS,
      });
      if (!limited.allowed) {
        auditCall({
          tool: name,
          userId: auth.userId,
          role: auth.role,
          ok: false,
          durationMs: 0,
          errorCode: "RATE_LIMITED",
          resultCount: 0,
        });
        return errorResult("RATE_LIMITED", "调用过于频繁，请稍后再试");
      }
    }

    const startedAt = Date.now();
    try {
      const result = await withTimeout(tool.handler(args), name, timeoutMs);
      const isError = !!result.isError;
      const data = parseResultPayload(result);

      auditCall({
        tool: name,
        userId: auth?.userId ?? null,
        role: auth?.role ?? null,
        ok: !isError,
        durationMs: Date.now() - startedAt,
        errorCode: isError ? (data?.error?.code ?? "TOOL_ERROR") : null,
        resultCount: isError ? 0 : resultCountOf(data),
      });
      return result;
    } catch (err: any) {
      const timedOut = err instanceof ToolTimeoutError;
      auditCall({
        tool: name,
        userId: auth?.userId ?? null,
        role: auth?.role ?? null,
        ok: false,
        durationMs: Date.now() - startedAt,
        errorCode: timedOut ? "TIMEOUT" : "INTERNAL_ERROR",
        resultCount: 0,
        timedOut,
      });

      if (timedOut) {
        return errorResult("TIMEOUT", `工具 ${name} 调用超时`);
      }
      return errorResult("INTERNAL_ERROR", err?.message || "内部错误");
    }
  };
}

export function startServer(): Server {
  const server = new Server(
    { name: "sse-mcp-server", version: "0.1.0" },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, () => ({
    tools: allTools.map((t) => t.definition),
  }));

  // The SDK's CallToolResult union now includes task-augmented variants; our
  // plain { content, isError } result is valid at runtime.
  server.setRequestHandler(CallToolRequestSchema, createToolCallHandler() as any);

  return server;
}

export async function runServer(): Promise<void> {
  const server = startServer();
  const transport = new StdioServerTransport();

  server.onerror = (err: Error) => {
    console.error("[MCP Server Error]", err);
  };

  server.onclose = () => {
    process.exit(0);
  };

  await server.connect(transport);
}
