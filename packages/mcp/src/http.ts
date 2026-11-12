/**
 * SSE MCP Server — HTTP entrypoint.
 *
 * Primary transport: Streamable HTTP (MCP 2025-03-26+) on `POST/GET/DELETE /mcp`
 *   — compatible with Claude Code / Cursor / VS Code and other modern clients.
 * Legacy transport: HTTP+SSE on `GET /sse` + `POST /messages?sessionId=...`
 *   — kept for older clients; disable with `MCP_LEGACY_SSE=0`.
 * Health: `GET /healthz`
 *
 * Auth: `Authorization: Bearer <mcp-api-key>` on every request. The resolved
 * identity is injected per request via `runWithAuth` (AsyncLocalStorage), so
 * concurrent clients never share the process default key.
 *
 * Start:
 *   MCP_HTTP_PORT=3001 node packages/mcp/dist/http.js
 */

import "./env.js";
import { createServer, IncomingMessage, ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { startServer } from "./server.js";
import { validateApiKey, runWithAuth, type AuthContext } from "./auth.js";

const PORT = Number(process.env.MCP_HTTP_PORT) || 3001;
const MAX_SESSIONS = Number(process.env.MCP_MAX_SESSIONS) || 100;
const MAX_BODY_BYTES = Number(process.env.MCP_MAX_BODY_BYTES) || 50 * 1024 * 1024;
const LEGACY_SSE = process.env.MCP_LEGACY_SSE !== "0";
const JSON_RESPONSE = process.env.MCP_JSON_RESPONSE === "1";
const CORS_ORIGIN = process.env.MCP_CORS_ORIGIN || "";

interface StreamSession {
  transport: StreamableHTTPServerTransport;
  auth: AuthContext;
}

interface SseSession {
  transport: SSEServerTransport;
  auth: AuthContext;
}

const streamSessions = new Map<string, StreamSession>();
const sseSessions = new Map<string, SseSession>();

function bearerToken(req: IncomingMessage): string | null {
  const h = req.headers.authorization;
  if (!h) return null;
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m ? m[1] : null;
}

// HTTP calls must present an explicit key. Unlike stdio, there is no
// process-default fallback: each session keeps the identity of its own key.
function authorize(req: IncomingMessage): AuthContext | null {
  const key = bearerToken(req);
  return key ? validateApiKey(key) : null;
}

function sendJson(res: ServerResponse, status: number, obj: unknown): void {
  const body = JSON.stringify(obj);
  res.writeHead(status, { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) });
  res.end(body);
}

function sendJsonRpcError(res: ServerResponse, status: number, code: number, message: string): void {
  sendJson(res, status, { jsonrpc: "2.0", error: { code, message }, id: null });
}

function applyCors(req: IncomingMessage, res: ServerResponse): void {
  if (!CORS_ORIGIN) return;
  res.setHeader("Access-Control-Allow-Origin", CORS_ORIGIN);
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Authorization, Content-Type, Mcp-Session-Id, Last-Event-ID, Mcp-Protocol-Version",
  );
  res.setHeader("Access-Control-Expose-Headers", "Mcp-Session-Id");
}

function readBody(req: IncomingMessage, limit: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error(`请求体超过限制 ${limit} 字节`));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
    req.on("aborted", () => reject(new Error("请求已中止")));
  });
}

async function handleStreamable(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const auth = authorize(req);
  if (!auth) {
    sendJsonRpcError(res, 401, -32001, "无效或缺失 API key");
    return;
  }

  const sessionId = req.headers["mcp-session-id"];
  const sid = Array.isArray(sessionId) ? sessionId[0] : sessionId;

  let existing: StreamSession | undefined;
  if (sid) {
    existing = streamSessions.get(sid);
    if (!existing) {
      sendJsonRpcError(res, 404, -32001, "Session not found");
      return;
    }
    if (existing.auth.userId !== auth.userId) {
      sendJsonRpcError(res, 403, -32003, "Session does not belong to this API key");
      return;
    }
  }

  let parsedBody: unknown;
  if (req.method === "POST") {
    try {
      const raw = await readBody(req, MAX_BODY_BYTES);
      parsedBody = raw.length ? JSON.parse(raw.toString("utf-8")) : undefined;
    } catch (err: any) {
      sendJsonRpcError(res, 400, -32700, err.message || "解析请求体失败");
      return;
    }
  }

  if (existing) {
    await runWithAuth(auth, () => existing!.transport.handleRequest(req, res, parsedBody));
    return;
  }

  if (req.method !== "POST" || !isInitializeRequest(parsedBody)) {
    sendJsonRpcError(res, 400, -32000, "Bad Request: no valid session ID provided");
    return;
  }

  if (streamSessions.size >= MAX_SESSIONS) {
    sendJsonRpcError(res, 503, -32000, "Too many open sessions");
    return;
  }

  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
    enableJsonResponse: JSON_RESPONSE,
    onsessioninitialized: (newId) => {
      streamSessions.set(newId, { transport, auth });
    },
  });
  transport.onclose = () => {
    const closedId = transport.sessionId;
    if (closedId) streamSessions.delete(closedId);
  };

  try {
    await startServer().connect(transport);
  } catch (err: any) {
    console.error("[sse-mcp-http] failed to initialize session:", err.message || err);
    try { await transport.close(); } catch { /* ignore */ }
    sendJsonRpcError(res, 500, -32603, "初始化 MCP 会话失败");
    return;
  }

  await runWithAuth(auth, () => transport.handleRequest(req, res, parsedBody));
}

async function handleLegacySse(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const auth = authorize(req);
  if (!auth) {
    sendJson(res, 401, { error: { code: "UNAUTHORIZED", message: "无效或缺失 API key" } });
    return;
  }
  if (sseSessions.size >= MAX_SESSIONS) {
    sendJson(res, 503, { error: { code: "TOO_MANY_SESSIONS", message: "会话数已达上限" } });
    return;
  }

  const transport = new SSEServerTransport("/messages", res);
  sseSessions.set(transport.sessionId, { transport, auth });
  transport.onclose = () => sseSessions.delete(transport.sessionId);
  res.on("close", () => sseSessions.delete(transport.sessionId));

  try {
    await startServer().connect(transport);
  } catch (err: any) {
    console.error("[sse-mcp-http] legacy SSE init failed:", err.message || err);
    sseSessions.delete(transport.sessionId);
    try { res.end(); } catch { /* ignore */ }
  }
}

async function handleLegacyMessage(
  req: IncomingMessage,
  res: ServerResponse,
  sessionId: string,
): Promise<void> {
  const entry = sseSessions.get(sessionId);
  if (!entry) {
    sendJson(res, 400, { error: { code: "NO_SSE_CONNECTION", message: "SSE 连接未建立，请先 GET /sse" } });
    return;
  }
  const auth = authorize(req);
  if (!auth) {
    sendJson(res, 401, { error: { code: "UNAUTHORIZED", message: "无效或缺失 API key" } });
    return;
  }
  if (entry.auth.userId !== auth.userId) {
    sendJson(res, 403, { error: { code: "FORBIDDEN", message: "会话不属于该 API key" } });
    return;
  }

  try {
    await runWithAuth(auth, () => entry.transport.handlePostMessage(req, res));
  } catch (err: any) {
    console.error("[sse-mcp-http]", err.message || err);
    if (!res.headersSent) {
      sendJson(res, 500, { error: { code: "INTERNAL_ERROR", message: err.message || "内部错误" } });
    }
  }
}

const server = createServer((req, res) => {
  void (async () => {
    const url = new URL(req.url || "/", "http://localhost");
    const path = url.pathname;

    applyCors(req, res);
    if (req.method === "OPTIONS") {
      res.writeHead(204).end();
      return;
    }

    if (path === "/healthz" && req.method === "GET") {
      sendJson(res, 200, {
        status: "ok",
        name: "sse-mcp-server",
        version: "0.1.0",
        uptime: Math.round(process.uptime()),
        sessions: { streamable: streamSessions.size, sse: sseSessions.size },
      });
      return;
    }

    if (path === "/" && req.method === "GET") {
      sendJson(res, 200, {
        name: "sse-mcp-server",
        endpoints: {
          streamableHttp: "/mcp",
          legacySse: LEGACY_SSE ? "/sse" : null,
          health: "/healthz",
        },
      });
      return;
    }

    if (path === "/mcp") {
      await handleStreamable(req, res);
      return;
    }

    if (LEGACY_SSE && path === "/sse" && req.method === "GET") {
      await handleLegacySse(req, res);
      return;
    }

    if (LEGACY_SSE && path === "/messages" && req.method === "POST") {
      await handleLegacyMessage(req, res, url.searchParams.get("sessionId") || "");
      return;
    }

    sendJson(res, 404, { error: { code: "NOT_FOUND", message: "未找到路径，MCP 请使用 /mcp" } });
  })().catch((err: any) => {
    console.error("[sse-mcp-http] unhandled:", err?.message || err);
    if (!res.headersSent) {
      sendJson(res, 500, { error: { code: "INTERNAL_ERROR", message: "内部错误" } });
    }
  });
});

let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[sse-mcp-http] ${signal} received, closing ${streamSessions.size + sseSessions.size} session(s)`);

  const closes: Promise<void>[] = [];
  for (const { transport } of streamSessions.values()) closes.push(transport.close().catch(() => undefined));
  for (const { transport } of sseSessions.values()) closes.push(transport.close().catch(() => undefined));
  await Promise.all(closes);
  streamSessions.clear();
  sseSessions.clear();

  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 5000).unref();
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

server.listen(PORT, () => {
  console.log(
    `[sse-mcp-http] listening on http://0.0.0.0:${PORT}/mcp (streamable)` +
      (LEGACY_SSE ? ` + /sse (legacy)` : ""),
  );
});
