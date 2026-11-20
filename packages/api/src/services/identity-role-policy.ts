export type IdentitySource = 'scim' | 'mdm';

export type RoleResolution =
  | { allowed: true; role: string; preserved: boolean }
  | {
      allowed: false;
      code: 'ROLE_NOT_ALLOWED' | 'INVALID_ROLE';
      message: string;
      requestedRole: string;
    };

const KNOWN_ROLES = new Set(['employee', 'dept_approver', 'finance', 'admin']);
const PRIVILEGED_ROLES = new Set(['dept_approver', 'finance', 'admin']);

function parseList(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseMap(value: string | undefined): Record<string, string> {
  const map: Record<string, string> = {};
  for (const pair of parseList(value)) {
    const [from, to] = pair.split('=').map((item) => item.trim());
    if (from && to) map[from] = to;
  }
  return map;
}

function envPrefix(source: IdentitySource): string {
  return source.toUpperCase();
}

export function resolveProvisionedRole(
  input: { source: IdentitySource; requestedRole?: string; currentRole?: string },
  env: NodeJS.ProcessEnv = process.env
): RoleResolution {
  const prefix = envPrefix(input.source);

  if (input.currentRole && PRIVILEGED_ROLES.has(input.currentRole)) {
    return { allowed: true, role: input.currentRole, preserved: true };
  }

  const requested = (input.requestedRole || '').trim() || 'employee';
  const mapped = parseMap(env[`${prefix}_ROLE_MAP`])[requested] || requested;

  if (!KNOWN_ROLES.has(mapped)) {
    return {
      allowed: false,
      code: 'INVALID_ROLE',
      message: `外部系统提交了未知角色：${requested}`,
      requestedRole: requested,
    };
  }

  if (mapped === 'admin') {
    return {
      allowed: false,
      code: 'ROLE_NOT_ALLOWED',
      message: '外部身份同步不允许创建管理员账号',
      requestedRole: requested,
    };
  }

  const allowed = parseList(env[`${prefix}_ALLOWED_ROLES`]);
  const whitelist = allowed.length > 0 ? allowed : ['employee'];
  if (!whitelist.includes(mapped)) {
    return {
      allowed: false,
      code: 'ROLE_NOT_ALLOWED',
      message: `角色 ${mapped} 不在 ${prefix}_ALLOWED_ROLES 白名单中`,
      requestedRole: requested,
    };
  }

  return { allowed: true, role: mapped, preserved: false };
}
