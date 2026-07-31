/**
 * SSE MCP Bridge — Pi extension
 *
 * Spawns the SSE MCP server (`packages/mcp/dist/index.js`) as a child process,
 * discovers its tools via the MCP JSON-RPC protocol, and registers them as Pi
 * tools through `pi.registerTool()`. Tool calls are forwarded to the MCP server
 * over stdio.
 *
 * Environment variables read from the process environment or the project's
 * `.env` file (parsed and merged into the child env):
 *   - SSE_MCP_SERVER  : override the MCP server command (default: node packages/mcp/dist/index.js)
 *   - MCP_API_KEYS    : key registrations (key=userId:role:department, comma separated)
 *   - MCP_API_KEY     : default key passed to tools
 *   - DB_*, JWT_SECRET, AI_ENDPOINT, AI_MODEL, MINIO_* : forwarded as-is
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { spawn, type ChildProcess } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";

interface McpToolDef {
  name: string;
  description?: string;
  inputSchema?: {
    type?: string;
    properties?: Record<string, any>;
    required?: string[];
  };
}

interface JsonRpcResponse {
  jsonrpc: string;
  id: number;
  result?: any;
  error?: { code: number; message: string; data?: unknown };
}

function loadEnvFile(cwd: string): Record<string, string> {
  const out: Record<string, string> = {};
  const envPath = join(cwd, ".env");
  if (!existsSync(envPath)) return out;
  try {
    for (const line of readFileSync(envPath, "utf-8").split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      let value = trimmed.slice(eq + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (key) out[key] = value;
    }
  } catch {
    /* ignore unreadable .env */
  }
  return out;
}

function mcpCommand(cwd: string): { file: string; args: string[] } {
  const override = process.env.SSE_MCP_SERVER;
  if (override) {
    const parts = override.split(/\s+/).filter(Boolean);
    return { file: parts[0], args: parts.slice(1) };
  }
  return {
    file: "node",
    args: [join(cwd, "packages", "mcp", "dist", "index.js")],
  };
}

function jsonSchemaToTypeBox(schema: any, required: boolean): any {
  const opts = schema?.description ? { description: schema.description } : {};
  switch (schema?.type) {
    case "string": {
      if (Array.isArray(schema.enum) && schema.enum.length > 0) {
        const t = Type.Union(schema.enum.map((v: string) => Type.Literal(v)), opts);
        return required ? t : Type.Optional(t);
      }
      const t = Type.String(opts);
      return required ? t : Type.Optional(t);
    }
    case "number": {
      const t = Type.Number(opts);
      return required ? t : Type.Optional(t);
    }
    case "integer": {
      const t = Type.Integer(opts);
      return required ? t : Type.Optional(t);
    }
    case "boolean": {
      const t = Type.Boolean(opts);
      return required ? t : Type.Optional(t);
    }
    case "array": {
      const t = Type.Array(jsonSchemaToTypeBox(schema.items || { type: "string" }, true), opts);
      return required ? t : Type.Optional(t);
    }
    default: {
      const t = Type.Any(opts);
      return required ? t : Type.Optional(t);
    }
  }
}

export default function sseMcpExtension(pi: ExtensionAPI) {
  const cwd = process.cwd();
  const envOverrides = loadEnvFile(cwd);

  let child: ChildProcess | null = null;
  let pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>();
  let nextId = 1;
  let initialized = false;
  let registered = false;

  function startServer(): void {
    if (child) return;
    const { file, args } = mcpCommand(cwd);
    child = spawn(file, args, {
      cwd,
      env: { ...process.env, ...envOverrides },
      stdio: ["pipe", "pipe", "pipe"],
    });

    let buf = "";
    child.stdout?.on("data", (chunk: Buffer) => {
      buf += chunk.toString("utf8");
      let idx: number;
      while ((idx = buf.indexOf("\n")) !== -1) {
        const line = buf.slice(0, idx).trim();
        buf = buf.slice(idx + 1);
        if (!line) continue;
        let msg: JsonRpcResponse;
        try {
          msg = JSON.parse(line);
        } catch {
          continue;
        }
        if (msg.id !== undefined && pending.has(msg.id)) {
          const p = pending.get(msg.id)!;
          pending.delete(msg.id);
          if (msg.error) p.reject(new Error(msg.error.message || "MCP error"));
          else p.resolve(msg.result);
        }
      }
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      console.error(`[sse-mcp] ${chunk.toString().trimEnd()}`);
    });
    child.on("exit", (code) => {
      child = null;
      initialized = false;
      for (const [, p] of pending) p.reject(new Error(`MCP server exited (code ${code})`));
      pending.clear();
    });
  }

  function request(method: string, params: unknown): Promise<any> {
    startServer();
    return new Promise((resolvePromise, reject) => {
      const id = nextId++;
      pending.set(id, { resolve: resolvePromise, reject });
      const payload = JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n";
      child!.stdin?.write(payload, (err) => {
        if (err) {
          pending.delete(id);
          reject(err);
        }
      });
    });
  }

  async function ensureInitialized(): Promise<void> {
    if (initialized) return;
    const res = await request("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "pi-sse-mcp", version: "0.1.0" },
    });
    initialized = !!res;
    child!.stdin?.write(
      JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n",
    );
  }

  function shutdown(): void {
    if (!child) return;
    try {
      child.kill();
    } catch {
      /* ignore */
    }
    child = null;
    initialized = false;
  }

  async function registerTools(): Promise<void> {
    if (registered) return;
    await ensureInitialized();
    const result = await request("tools/list", {});
    const tools: McpToolDef[] = result?.tools ?? [];
    for (const tool of tools) {
      const required = new Set(tool.inputSchema?.required ?? []);
      const properties: Record<string, unknown> = {};
      for (const [key, schema] of Object.entries(tool.inputSchema?.properties ?? {})) {
        properties[key] = jsonSchemaToTypeBox(schema, required.has(key));
      }
      pi.registerTool({
        name: tool.name,
        label: tool.name,
        description: tool.description ?? tool.name,
        promptSnippet: tool.description ?? tool.name,
        parameters: Type.Object(properties),
        async execute(_toolCallId, params) {
          try {
            await ensureInitialized();
            const result = await request("tools/call", {
              name: tool.name,
              arguments: params,
            });
            const content = Array.isArray(result?.content)
              ? (result.content as Array<{ type: string; text?: string }>)
                  .map((c) => c.text ?? "")
                  .join("\n")
              : JSON.stringify(result ?? null);
            return {
              content: [{ type: "text" as const, text: content }],
              details: { mcp: tool.name },
            };
          } catch (err: any) {
            return {
              content: [{ type: "text" as const, text: `[sse-mcp] ${err.message}` }],
              details: { mcp: tool.name, error: err.message },
            };
          }
        },
      });
    }
    registered = true;
    console.error(`[sse-mcp] registered ${tools.length} tools`);
  }

  pi.on("session_start", () => {
    registerTools().catch((err) => console.error(`[sse-mcp] tool registration failed: ${err.message}`));
  });

  pi.on("session_shutdown", () => {
    shutdown();
  });

  pi.registerCommand("sse-mcp", {
    description: "SSE MCP bridge status: /sse-mcp [status|reload]",
    handler: async (args, ctx) => {
      const cmd = (args || "").trim().toLowerCase();
      if (cmd === "reload") {
        shutdown();
        registered = false;
        await registerTools();
        ctx.ui.notify("SSE MCP bridge reloaded", "info");
      } else {
        const state = child ? (initialized ? "connected" : "starting") : "stopped";
        ctx.ui.notify(`SSE MCP bridge: ${state} (tools registered: ${registered})`, "info");
      }
    },
  });
}
