export type Role = 'employee' | 'dept_approver' | 'finance' | 'admin'

export interface NavItem {
  path: string
  label: string
  icon: string
  roles: readonly Role[]
}

const ALL_ROLES: readonly Role[] = ['employee', 'dept_approver', 'finance', 'admin']
const APPROVER_ROLES: readonly Role[] = ['dept_approver', 'finance', 'admin']
const FINANCE_ROLES: readonly Role[] = ['finance', 'admin']
const ADMIN_ROLES: readonly Role[] = ['admin']

export const APPROVER_ROLE_NAMES: readonly string[] = APPROVER_ROLES

export const NAV_ITEMS: readonly NavItem[] = [
  {
    path: '/dashboard',
    label: '工作台',
    roles: ALL_ROLES,
    icon: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></svg>',
  },
  {
    path: '/expenses',
    label: '报销列表',
    roles: ALL_ROLES,
    icon: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>',
  },
  {
    path: '/approvals',
    label: '审批管理',
    roles: APPROVER_ROLES,
    icon: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>',
  },
  {
    path: '/statistics',
    label: '统计分析',
    roles: FINANCE_ROLES,
    icon: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>',
  },
  {
    path: '/ontology',
    label: '本体可视化',
    roles: ALL_ROLES,
    icon: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="5" r="2.5"/><circle cx="5" cy="19" r="2.5"/><circle cx="19" cy="19" r="2.5"/><line x1="12" y1="7.5" x2="6.5" y2="17"/><line x1="12" y1="7.5" x2="17.5" y2="17"/><line x1="7" y1="17.5" x2="17" y2="17.5"/></svg>',
  },
  {
    path: '/admin',
    label: '系统管理',
    roles: ADMIN_ROLES,
    icon: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>',
  },
  {
    path: '/admin/users',
    label: '用户管理',
    roles: ADMIN_ROLES,
    icon: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
  },
  {
    path: '/admin/departments',
    label: '部门管理',
    roles: ADMIN_ROLES,
    icon: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>',
  },
  {
    path: '/admin/messages',
    label: '消息管理',
    roles: ADMIN_ROLES,
    icon: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/><polyline points="9 10 12 13 17 8"/></svg>',
  },
  {
    path: '/admin/reasoning-rules',
    label: '推理规则',
    roles: ADMIN_ROLES,
    icon: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2a10 10 0 1010 10M12 2a10 10 0 0110 10M12 2v10m10 0h-4l-2 4-2-8-2 4H2"/></svg>',
  },
  {
    path: '/admin/snapshots',
    label: '内容快照',
    roles: ADMIN_ROLES,
    icon: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 4h16v16H4z"/><path d="M8 8h8M8 12h8M8 16h5"/></svg>',
  },
]

const ROLE_LABELS: Record<string, string> = {
  employee: '员工',
  dept_approver: '部门审批人',
  finance: '财务',
  admin: '系统管理员',
}

export function navItemsForRole(role: string | undefined): NavItem[] {
  if (!role) return []
  return NAV_ITEMS.filter((item) => item.roles.includes(role as Role))
}

export function canAccessRoute(
  role: string | undefined,
  allowed?: readonly string[]
): boolean {
  if (allowed === undefined) return true
  if (!role) return false
  return allowed.includes(role)
}

export function roleLabel(role: string | undefined): string {
  if (!role) return '未知角色'
  return ROLE_LABELS[role] ?? role
}

export type GuardDecision = 'allow' | 'login' | 'dashboard' | 'forbidden'

export interface GuardMeta {
  guest?: boolean
  requiresAdmin?: boolean
  allowedRoles?: readonly string[]
}

export function resolveGuard(input: {
  isLoggedIn: boolean
  role?: string
  meta: GuardMeta
}): GuardDecision {
  const { isLoggedIn, role, meta } = input

  if (meta.guest) return isLoggedIn ? 'dashboard' : 'allow'
  if (!isLoggedIn) return 'login'
  if (meta.requiresAdmin && role !== 'admin') return 'forbidden'
  if (meta.allowedRoles && !canAccessRoute(role, meta.allowedRoles)) return 'forbidden'
  return 'allow'
}
