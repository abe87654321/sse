import { UserRole } from "@sse/shared";

export interface AuthContext {
  userId: string;
  role: string;
  department: string;
}

const apiKeyStore = new Map<string, AuthContext>();

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
  const key = (process.env.MCP_API_KEY || (args?.["api_key"] as string | undefined)) ?? null;
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
