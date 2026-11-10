import { AsyncLocalStorage } from "node:async_hooks";
import { UserRole } from "@sse/shared";

export interface AuthContext {
  userId: string;
  role: string;
  department: string;
}

const apiKeyStore = new Map<string, AuthContext>();

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

const keysEnv = process.env.MCP_API_KEYS;
if (keysEnv) {
  for (const entry of keysEnv.split(",")) {
    const [key, ctxStr] = entry.split("=");
    const [userId, role, department] = (ctxStr || "").split(":");
    if (key && userId && role) {
      apiKeyStore.set(key.trim(), {
        userId: userId.trim(),
        role: role.trim() as UserRole,
        department: (department || "").trim(),
      });
    }
  }
}

// Load keys from DB on startup
(async () => {
  try {
    const { pool } = await import("@sse/db");
    const { rows } = await pool.query("SELECT key, user_id, role, department FROM mcp_api_keys WHERE is_active = true");
    for (const row of rows) {
      apiKeyStore.set(row.key, {
        userId: row.user_id,
        role: row.role,
        department: row.department || "",
      });
    }
  } catch { /* table may not exist yet */ }
})();

export function registerApiKey(key: string, ctx: AuthContext): void {
  apiKeyStore.set(key, ctx);
}

export function validateApiKey(key: string): AuthContext | null {
  return apiKeyStore.get(key) ?? null;
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
  if (auth.role === UserRole.ADMIN || auth.role === UserRole.FINANCE) return true;
  if (auth.role === UserRole.DEPT_APPROVER) return auth.department === targetDepartment;
  return auth.userId === targetUserId;
}
