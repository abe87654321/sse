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
import type { ToolDefinition, ToolResult } from "./tools/types.js";

interface ToolEntry {
  definition: ToolDefinition;
  handler: (args: Record<string, unknown>) => Promise<ToolResult>;
}

const allTools: ToolEntry[] = [
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

const ratePruneTimer = setInterval(() => pruneRateLimitStore(rateStore), RATE_WINDOW_MS);
ratePruneTimer.unref?.();

function audit(event: Record<string, unknown>): void {
  if (!AUDIT_ENABLED) return;
  // stderr only: stdout is the JSON-RPC channel for the stdio transport.
  console.error(`[mcp-audit] ${JSON.stringify({ ts: new Date().toISOString(), ...event })}`);
}

export function startServer(): Server {
  const server = new Server(
    { name: "sse-mcp-server", version: "0.1.0" },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, () => ({
    tools: allTools.map((t) => t.definition),
  }));

  const callToolHandler: (request: any) => Promise<ToolResult> = async (request: any) => {
    const params = request.params;
    if (!params) {
      return {
        content: [{ type: "text", text: JSON.stringify({ error: { code: "INVALID_PARAMS", message: "缺少请求参数" } }) }],
        isError: true,
      };
    }

    const name = params.name;
    const tool = toolMap.get(name);

    if (!tool) {
      return {
        content: [{ type: "text", text: JSON.stringify({ error: { code: "NOT_FOUND", message: `未知工具: ${name}` } }) }],
        isError: true,
      };
    }

    const args = (params.arguments ?? {}) as Record<string, unknown>;

    const schema = tool.definition.inputSchema as any;
    if (schema?.required) {
      for (const field of schema.required) {
        if (args[field] === undefined || args[field] === null || args[field] === "") {
          return {
            content: [{ type: "text", text: JSON.stringify({ error: { code: "INVALID_PARAMS", message: `缺少必填参数: ${field}` } }) }],
            isError: true,
          };
        }
      }
    }

    const auth = resolveAuthContext(args);

    if (auth) {
      const limited = checkRateLimit(rateStore, auth.userId, {
        limit: RATE_LIMIT_PER_MIN,
        windowMs: RATE_WINDOW_MS,
      });
      if (!limited.allowed) {
        audit({ tool: name, userId: auth.userId, role: auth.role, ok: false, error: "RATE_LIMITED" });
        return {
          content: [{ type: "text", text: JSON.stringify({ error: { code: "RATE_LIMITED", message: "调用过于频繁，请稍后再试" } }) }],
          isError: true,
        };
      }
    }

    const startedAt = Date.now();
    try {
      const result = await tool.handler(args);
      audit({
        tool: name,
        userId: auth?.userId ?? null,
        role: auth?.role ?? null,
        ok: !result.isError,
        durationMs: Date.now() - startedAt,
      });
      return result;
    } catch (err: any) {
      audit({
        tool: name,
        userId: auth?.userId ?? null,
        role: auth?.role ?? null,
        ok: false,
        durationMs: Date.now() - startedAt,
        error: err?.message || "INTERNAL_ERROR",
      });
      return {
        content: [{ type: "text", text: JSON.stringify({ error: { code: "INTERNAL_ERROR", message: err?.message || "内部错误" } }) }],
        isError: true,
      };
    }
  };

  // The SDK's CallToolResult union now includes task-augmented variants; our
  // plain { content, isError } result is valid at runtime.
  server.setRequestHandler(CallToolRequestSchema, callToolHandler as any);

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
