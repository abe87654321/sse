import { AsyncLocalStorage } from "node:async_hooks";
import { resolveDataScope } from "@sse/auth";

export interface AuthContext {
  userId: string;
  role: string;
  department: string;
}

// Identity sources are kept separate so DB-backed keys can be refreshed
// periodically without dropping environment-defined keys.
const envKeys = new Map<string, AuthContext>();
const manualKeys = new Map<string, AuthContext>();
const dbKeys = new Map<string, AuthContext>();

// Per-request identity for HTTP transport. The stdio transport keeps using
// env/args; HTTP sets the resolved key context here so concurrent clients each
// get their own role/department instead of sharing the process default key.
const authStorage = new AsyncLocalStorage<AuthContext>();

export function runWithAuth<T>(auth: AuthContext, fn: () => T): T {
  return authStorage.run(auth, fn);
}

export function currentAuth(): AuthContext | undefined {
  return authStorage.getStore();
}

function parseEnvKeys(raw: string | undefined): void {
  if (!raw) return;
  for (const entry of raw.split(",")) {
    const [key, ctxStr] = entry.split("=");
    const [userId, role, department] = (ctxStr || "").split(":");
    if (key && userId && role) {
      envKeys.set(key.trim(), {
        userId: userId.trim(),
        role: role.trim(),
        department: (department || "").trim(),
      });
    }
  }
}

parseEnvKeys(process.env.MCP_API_KEYS);

const REFRESH_MS = Number(process.env.MCP_KEY_REFRESH_MS) || 60_000;

/**
 * Reloads active keys from the DB, joined with the current user row so role
 * and department follow the user (revoked/disabled users are dropped). On a
 * transient failure the previous snapshot is kept.
 */
export async function refreshApiKeys(): Promise<void> {
  try {
    const { pool } = await import("@sse/db");
    const select = (expiryFilter: string) => pool.query(
      `SELECT k.key, k.user_id, u.role, u.department
         FROM mcp_api_keys k
         JOIN users u ON u.id = k.user_id
        WHERE k.is_active = true AND u.status = 'active'${expiryFilter}`,
    );

    let rows: any[];
    try {
      ({ rows } = await select(" AND (k.expires_at IS NULL OR k.expires_at > NOW())"));
    } catch {
      // Pre-014 database: no expires_at column yet.
      ({ rows } = await select(""));
    }

    const next = new Map<string, AuthContext>();
    for (const row of rows) {
      next.set(row.key, {
        userId: row.user_id,
        role: row.role,
        department: row.department || "",
      });
    }
    dbKeys.clear();
    for (const [key, ctx] of next) dbKeys.set(key, ctx);
  } catch {
    /* keep the previous snapshot on transient DB failures */
  }
}

export function registerApiKey(key: string, ctx: AuthContext): void {
  manualKeys.set(key, ctx);
}

export function validateApiKey(key: string): AuthContext | null {
  return manualKeys.get(key) ?? envKeys.get(key) ?? dbKeys.get(key) ?? null;
}

export function resolveAuthContext(args?: Record<string, unknown>): AuthContext | null {
  const requestAuth = authStorage.getStore();
  if (requestAuth) return requestAuth;

  const argKey = args?.["api_key"];
  const key = (typeof argKey === "string" && argKey ? argKey : process.env.MCP_API_KEY) ?? null;
  if (!key) return null;
  return validateApiKey(key);
}

export function enforceReadAccess(
  auth: AuthContext,
  targetUserId: string,
  targetDepartment: string,
): boolean {
  const scope = resolveDataScope(auth);
  if (scope.kind === "all") return true;
  if (scope.kind === "department") {
    return !!targetDepartment && scope.department === targetDepartment;
  }
  if (scope.kind === "self") return scope.userId === targetUserId;
  return false;
}

// Keep DB-backed keys (and the role/department bound to them) fresh.
void refreshApiKeys();
const refreshTimer = setInterval(() => {
  void refreshApiKeys();
}, REFRESH_MS);
refreshTimer.unref?.();
