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
];

const toolMap = new Map(allTools.map((t) => [t.definition.name, t]));

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
    return tool.handler(args);
  };

  // @ts-expect-error - SDK type union is overly broad for CallToolResult
  server.setRequestHandler(CallToolRequestSchema, callToolHandler);

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
