/**
 * SSE MCP Server — HTTP transport entrypoint (方案 B)
 *
 * 暴露 HTTP + SSE transport 供原生 MCP 客户端（Claude Code / Cursor 等）连接。
 *
 *   GET /mcp      — 建立 SSE 流，返回 endpoint 事件（含 sessionId）
 *   POST /mcp     — 客户端发送 JSON-RPC 消息（?sessionId=xxx）
 *
 * 鉴权：HTTP header `Authorization: Bearer <mcp-api-key>`（与 MCP tools 的 API key 体系一致，
 * key 从 MCP_API_KEYS 环境变量或 DB mcp_api_keys 表加载）。
 *
 * 启动：
 *   MCP_HTTP_PORT=3001 node packages/mcp/dist/http.js
 */

import { createServer, IncomingMessage, ServerResponse } from "node:http";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { startServer } from "./server.js";
import { validateApiKey } from "./auth.js";

const PORT = Number(process.env.MCP_HTTP_PORT) || 3001;

const transports = new Map<string, SSEServerTransport>();

function bearerToken(req: IncomingMessage): string | null {
  const h = req.headers.authorization;
  if (!h) return null;
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m ? m[1] : null;
}

function authorize(req: IncomingMessage): boolean {
  const key = bearerToken(req) || process.env.MCP_API_KEY || "";
  return key ? validateApiKey(key) !== null : false;
}

function sendJson(res: ServerResponse, status: number, obj: unknown): void {
  const body = JSON.stringify(obj);
  res.writeHead(status, { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) });
  res.end(body);
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url || "/", "http://localhost");
  if (url.pathname !== "/mcp") {
    sendJson(res, 404, { error: { code: "NOT_FOUND", message: "未找到路径，请使用 /mcp" } });
    return;
  }

  if (req.method === "GET") {
    if (!authorize(req)) {
      sendJson(res, 401, { error: { code: "UNAUTHORIZED", message: "无效或缺失 API key" } });
      return;
    }
    const transport = new SSEServerTransport("/mcp", res);
    transports.set(transport.sessionId, transport);
    res.on("close", () => transports.delete(transport.sessionId));
    try {
      await startServer().connect(transport);
    } catch (err: any) {
      console.error("[sse-mcp-http]", err.message || err);
      try { res.end(); } catch { /* ignore */ }
    }
    return;
  }

  if (req.method === "POST") {
    const sessionId = url.searchParams.get("sessionId") || "";
    const transport = transports.get(sessionId);
    if (!transport) {
      sendJson(res, 500, { error: { code: "NO_SSE_CONNECTION", message: "SSE 连接未建立，请先 GET /mcp" } });
      return;
    }
    if (!authorize(req)) {
      sendJson(res, 401, { error: { code: "UNAUTHORIZED", message: "无效或缺失 API key" } });
      return;
    }
    try {
      await transport.handlePostMessage(req, res);
    } catch (err: any) {
      console.error("[sse-mcp-http]", err.message || err);
      try { sendJson(res, 500, { error: { code: "INTERNAL_ERROR", message: err.message || "内部错误" } }); } catch { /* ignore */ }
    }
    return;
  }

  sendJson(res, 405, { error: { code: "METHOD_NOT_ALLOWED", message: "仅支持 GET / POST" } });
});

server.listen(PORT, () => {
  console.log(`[sse-mcp-http] listening on http://0.0.0.0:${PORT}/mcp`);
});
