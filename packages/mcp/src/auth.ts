import { UserRole } from "@sse/shared";

export interface AuthContext {
  userId: string;
  role: string;
  department: string;
}

const apiKeyStore = new Map<string, AuthContext>();

apiKeyStore.set("mcp_dev_key_001", {
  userId: "00000000-0000-0000-0000-000000000001",
  role: UserRole.ADMIN,
  department: "管理部",
});

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
