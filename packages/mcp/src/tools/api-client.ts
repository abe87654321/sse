import { signToken } from "@sse/auth";
import type { AuthContext } from "../auth.js";

export const API_BASE =
  process.env.SSE_API_BASE || process.env.API_BASE_URL || "http://localhost:3000";

const DEFAULT_TIMEOUT_MS = Number(process.env.MCP_TOOL_TIMEOUT_MS) || 30_000;

export interface ApiRequestOptions {
  /** Abort the request after this many milliseconds. */
  timeoutMs?: number;
  /** Caller-provided signal. Overrides `timeoutMs` when supplied. */
  signal?: AbortSignal;
}

export interface ApiResult {
  ok: boolean;
  status: number;
  data: any;
}

/**
 * Builds an abort signal that fires after `timeoutMs`. Prefers the native
 * `AbortSignal.timeout` and falls back to a controller for older runtimes.
 */
function requestSignal(timeoutMs: number): AbortSignal {
  const timeout = Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : DEFAULT_TIMEOUT_MS;
  const withTimeout = (globalThis as any).AbortSignal?.timeout;
  if (typeof withTimeout === "function") {
    return withTimeout.call((globalThis as any).AbortSignal, timeout);
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  timer.unref?.();
  return controller.signal;
}

export function authHeaders(auth: AuthContext): Record<string, string> {
  const token = signToken({
    userId: auth.userId,
    role: auth.role,
    department: auth.department,
  });
  return { Authorization: `Bearer ${token}` };
}

export function decodeBase64(input: string): Buffer {
  const comma = input.indexOf(",");
  const payload = input.startsWith("data:") && comma >= 0 ? input.slice(comma + 1) : input;
  return Buffer.from(payload, "base64");
}

export function resolveInvoiceExt(
  fileName: string | undefined,
  fileFormat: string | undefined,
): string {
  const fromName = fileName?.split(".").pop()?.toLowerCase();
  if (fromName === "pdf" || fromName === "ofd") return fromName;
  if (fromName) return "image";
  return (fileFormat || "").toLowerCase() === "pdf" ? "pdf" : "image";
}

async function parseResponse(res: Response): Promise<ApiResult> {
  let data: any = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  return { ok: res.ok, status: res.status, data };
}

export async function apiJson(
  auth: AuthContext,
  method: string,
  path: string,
  body?: unknown,
  options: ApiRequestOptions = {},
): Promise<ApiResult> {
  const signal = options.signal ?? requestSignal(options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: { "Content-Type": "application/json", ...authHeaders(auth) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal,
  });
  return parseResponse(res);
}

export async function getReportDetail(
  auth: AuthContext,
  reportId: string,
): Promise<ApiResult> {
  return apiJson(auth, "GET", `/expenses/${encodeURIComponent(reportId)}`);
}

export async function uploadInvoiceFile(
  auth: AuthContext,
  reportId: string,
  itemId: string,
  file: { buffer: Buffer; fileName: string },
): Promise<ApiResult> {
  const ext = file.fileName.split(".").pop()?.toLowerCase() || "";
  const type =
    ext === "pdf" ? "application/pdf" : ext === "ofd" ? "application/ofd" : "application/octet-stream";

  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(file.buffer)], { type }), file.fileName);

  const res = await fetch(
    `${API_BASE}/expenses/${encodeURIComponent(reportId)}/items/${encodeURIComponent(itemId)}/invoice`,
    {
      method: "POST",
      headers: authHeaders(auth),
      body: form,
    },
  );
  return parseResponse(res);
}

export async function verifyReport(
  auth: AuthContext,
  reportId: string,
  force = false,
): Promise<ApiResult> {
  return apiJson(auth, "POST", `/expenses/${encodeURIComponent(reportId)}/verify`, { force });
}
