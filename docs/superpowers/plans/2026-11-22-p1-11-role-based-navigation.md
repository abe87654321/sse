# P1-11 导航按角色过滤 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 前端导航只显示当前角色可访问的入口，并用无权限页替换受限路由的 403/空页面。

**Architecture:** 新增 `packages/web/src/permissions.ts` 作为唯一的角色-入口矩阵与纯函数来源；`DefaultLayout` 用它渲染导航，vue-router 守卫用 `resolveGuard` 判断；新增 `/forbidden` 页面承载无权限说明。

**Tech Stack:** Vue 3 + vue-router 4 + Pinia + Vitest + @vue/test-utils

---

## 文件结构

| 文件 | 责任 |
|---|---|
| `packages/web/vitest.config.ts` | 增加 `@` 别名，使测试能解析 `@/permissions`、`@/stores/auth` |
| `packages/web/src/permissions.ts`（新） | `NAV_ITEMS`、`navItemsForRole`、`canAccessRoute`、`resolveGuard`、`roleLabel` |
| `packages/web/src/__tests__/permissions.test.ts`（新） | 角色矩阵与守卫纯函数单测 |
| `packages/web/src/pages/Forbidden.vue`（新） | 无权限页：角色说明 + 返回工作台/上一页 |
| `packages/web/src/pages/__tests__/Forbidden.test.ts`（新） | 无权限页渲染与返回按钮测试 |
| `packages/web/src/router/index.ts` | 增加 `RouteMeta` 类型、`/forbidden` 路由、`allowedRoles` 与守卫 |
| `packages/web/src/layouts/DefaultLayout.vue` | 导航改为 `navItemsForRole` |

---

### Task 1: 权限注册表与纯函数

**Files:**
- Modify: `packages/web/vitest.config.ts`
- Create: `packages/web/src/permissions.ts`
- Test: `packages/web/src/__tests__/permissions.test.ts`

- [ ] **Step 1: 让 Vitest 解析 `@` 别名**

把 `packages/web/vitest.config.ts` 改为：

```ts
import { defineConfig } from 'vitest/config';
import vue from '@vitejs/plugin-vue';
import { resolve } from 'path';

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: { '@': resolve(__dirname, 'src') },
  },
  test: {
    environment: 'jsdom',
    globals: true,
  },
});
```

- [ ] **Step 2: 写失败的测试**

创建 `packages/web/src/__tests__/permissions.test.ts`：

```ts
import { describe, expect, it } from 'vitest'
import {
  NAV_ITEMS,
  canAccessRoute,
  navItemsForRole,
  roleLabel,
} from '@/permissions'

const paths = (role?: string) => navItemsForRole(role).map((item) => item.path)

describe('navItemsForRole', () => {
  it('gives employees only shared entries', () => {
    expect(paths('employee')).toEqual(['/dashboard', '/expenses', '/ontology'])
  })

  it('adds approvals for dept approvers and finance', () => {
    expect(paths('dept_approver')).toEqual([
      '/dashboard',
      '/expenses',
      '/approvals',
      '/ontology',
    ])
    expect(paths('finance')).toEqual([
      '/dashboard',
      '/expenses',
      '/approvals',
      '/statistics',
      '/ontology',
    ])
  })

  it('gives admins every entry', () => {
    expect(paths('admin')).toEqual(NAV_ITEMS.map((item) => item.path))
  })

  it('fails closed for unknown or missing roles', () => {
    expect(paths(undefined)).toEqual([])
    expect(paths('ghost')).toEqual([])
  })
})

describe('canAccessRoute', () => {
  it('treats a missing allowed list as unrestricted', () => {
    expect(canAccessRoute('employee', undefined)).toBe(true)
  })

  it('checks role membership', () => {
    expect(canAccessRoute('finance', ['finance', 'admin'])).toBe(true)
    expect(canAccessRoute('employee', ['finance', 'admin'])).toBe(false)
  })

  it('denies an empty role or empty allow-list', () => {
    expect(canAccessRoute(undefined, ['employee'])).toBe(false)
    expect(canAccessRoute('employee', [])).toBe(false)
  })
})

describe('roleLabel', () => {
  it('maps known roles to Chinese labels', () => {
    expect(roleLabel('employee')).toBe('员工')
    expect(roleLabel('dept_approver')).toBe('部门审批人')
    expect(roleLabel('finance')).toBe('财务')
    expect(roleLabel('admin')).toBe('系统管理员')
  })

  it('falls back for unknown or missing roles', () => {
    expect(roleLabel(undefined)).toBe('未知角色')
    expect(roleLabel('ghost')).toBe('ghost')
  })
})
```

- [ ] **Step 3: 运行测试，确认失败**

Run:

```powershell
pnpm --filter @sse/web exec vitest run src/__tests__/permissions.test.ts
```

Expected: FAIL，报错类似 `Failed to resolve import "@/permissions"` 或 `Cannot find module '@/permissions'`。

- [ ] **Step 4: 实现 `permissions.ts`**

创建 `packages/web/src/permissions.ts`：

```ts
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
  {
    path: '/admin/backups',
    label: '备份与恢复',
    roles: ADMIN_ROLES,
    icon: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12a9 9 0 11-3-6.7L21 8"/><path d="M21 3v5h-5"/></svg>',
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
```

- [ ] **Step 5: 运行测试，确认通过**

Run:

```powershell
pnpm --filter @sse/web exec vitest run src/__tests__/permissions.test.ts
```

Expected: `Test Files 1 passed`、`Tests 9 passed`。

- [ ] **Step 6: 提交**

```powershell
git add packages/web/vitest.config.ts packages/web/src/permissions.ts packages/web/src/__tests__/permissions.test.ts
git commit -m "feat(web): add role-based navigation permission registry"
```

---

### Task 2: 无权限页

**Files:**
- Create: `packages/web/src/pages/Forbidden.vue`
- Test: `packages/web/src/pages/__tests__/Forbidden.test.ts`
- Modify: `packages/web/src/router/index.ts`（先加入 `/forbidden` 路由）

- [ ] **Step 1: 写失败的测试**

创建 `packages/web/src/pages/__tests__/Forbidden.test.ts`：

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'

const routerMock = vi.hoisted(() => ({
  push: vi.fn(),
  back: vi.fn(),
  resolve: vi.fn((path: string) => ({
    meta: path === '/statistics' ? { title: '统计分析' } : {},
  })),
}))

const routeMock = vi.hoisted(() => ({ query: { from: '/statistics' } }))

const authMock = vi.hoisted(() => ({
  user: { id: 'u1', name: '员工', phone: '13800000001', role: 'employee' },
}))

vi.mock('vue-router', () => ({
  useRouter: () => routerMock,
  useRoute: () => routeMock,
}))

vi.mock('@/stores/auth', () => ({
  useAuthStore: () => authMock,
}))

import Forbidden from '../Forbidden.vue'

beforeEach(() => {
  routerMock.push.mockReset()
  routerMock.back.mockReset()
})

describe('Forbidden page', () => {
  it('explains the denied page and the current role', () => {
    const wrapper = mount(Forbidden)

    expect(wrapper.text()).toContain('无权访问')
    expect(wrapper.text()).toContain('员工')
    expect(wrapper.text()).toContain('统计分析')
  })

  it('returns to the dashboard', async () => {
    const wrapper = mount(Forbidden)
    const buttons = wrapper.findAll('button')

    await buttons[0].trigger('click')

    expect(routerMock.push).toHaveBeenCalledWith('/dashboard')
  })
})
```

- [ ] **Step 2: 运行测试，确认失败**

Run:

```powershell
pnpm --filter @sse/web exec vitest run src/pages/__tests__/Forbidden.test.ts
```

Expected: FAIL，报错类似 `Failed to resolve import "../Forbidden.vue"`。

- [ ] **Step 3: 实现 `Forbidden.vue`**

创建 `packages/web/src/pages/Forbidden.vue`：

```vue
<template>
  <div class="card forbidden-card">
    <div class="forbidden-icon">&#128274;</div>
    <h2 class="forbidden-title font-heading">无权访问</h2>
    <p class="forbidden-text">
      你当前的角色（{{ currentRole }}）无权访问{{ targetSuffix }}。
      如需访问，请联系系统管理员调整权限。
    </p>
    <div class="forbidden-actions">
      <button class="btn-primary" @click="goDashboard">返回工作台</button>
      <button class="btn-secondary" @click="goBack">返回上一页</button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { roleLabel } from '@/permissions'

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()

const currentRole = computed(() => roleLabel(auth.user?.role))

const targetSuffix = computed(() => {
  const from = typeof route.query.from === 'string' ? route.query.from : ''
  if (!from) return '该页面'
  const resolved = router.resolve(from)
  const title = resolved.meta?.title as string | undefined
  return title ? `“${title}”` : from
})

function goDashboard() {
  router.push('/dashboard')
}

function goBack() {
  if (window.history.length > 1) router.back()
  else router.push('/dashboard')
}
</script>

<style scoped>
.forbidden-card {
  max-width: 560px;
  margin: 48px auto;
  padding: 40px 32px;
  text-align: center;
}
.forbidden-icon {
  font-size: 2.4rem;
  margin-bottom: 12px;
}
.forbidden-title {
  font-size: 1.4rem;
  color: var(--text-primary);
  margin-bottom: 12px;
}
.forbidden-text {
  font-size: 0.95rem;
  line-height: 1.7;
  color: var(--text-secondary);
  margin-bottom: 24px;
}
.forbidden-actions {
  display: flex;
  gap: 12px;
  justify-content: center;
  flex-wrap: wrap;
}
</style>
```

- [ ] **Step 4: 在路由中注册 `/forbidden`**

修改 `packages/web/src/router/index.ts`，在 `children` 数组末尾（`ontology` 之后）加入：

```ts
      {
        path: 'forbidden',
        name: 'Forbidden',
        component: () => import('@/pages/Forbidden.vue'),
        meta: { title: '无权访问', hidden: true }
      }
```

> 此时还不改守卫，`/forbidden` 可被任何已登录用户访问。

- [ ] **Step 5: 运行测试，确认通过**

Run:

```powershell
pnpm --filter @sse/web exec vitest run src/pages/__tests__/Forbidden.test.ts
```

Expected: `Test Files 1 passed`、`Tests 2 passed`。

- [ ] **Step 6: 提交**

```powershell
git add packages/web/src/pages/Forbidden.vue packages/web/src/pages/__tests__/Forbidden.test.ts packages/web/src/router/index.ts
git commit -m "feat(web): add forbidden page for denied routes"
```

---

### Task 3: 路由守卫与角色元数据

**Files:**
- Modify: `packages/web/src/router/index.ts`
- Modify: `packages/web/src/permissions.ts`
- Test: `packages/web/src/__tests__/permissions.test.ts`

- [ ] **Step 1: 写失败的守卫测试**

在 `packages/web/src/__tests__/permissions.test.ts` 顶部导入中加入 `resolveGuard`：

```ts
import {
  NAV_ITEMS,
  canAccessRoute,
  navItemsForRole,
  resolveGuard,
  roleLabel,
} from '@/permissions'
```

在文件末尾追加：

```ts
describe('resolveGuard', () => {
  it('redirects guests to login', () => {
    expect(resolveGuard({ isLoggedIn: false, meta: {} })).toBe('login')
  })

  it('sends logged-in users away from guest pages', () => {
    expect(
      resolveGuard({ isLoggedIn: true, role: 'employee', meta: { guest: true } })
    ).toBe('dashboard')
  })

  it('forbids employees from statistics', () => {
    expect(
      resolveGuard({
        isLoggedIn: true,
        role: 'employee',
        meta: { allowedRoles: ['finance', 'admin'] },
      })
    ).toBe('forbidden')
  })

  it('allows finance into approvals', () => {
    expect(
      resolveGuard({
        isLoggedIn: true,
        role: 'finance',
        meta: { allowedRoles: ['dept_approver', 'finance', 'admin'] },
      })
    ).toBe('allow')
  })

  it('keeps requiresAdmin compatibility', () => {
    expect(
      resolveGuard({ isLoggedIn: true, role: 'finance', meta: { requiresAdmin: true } })
    ).toBe('forbidden')
    expect(
      resolveGuard({ isLoggedIn: true, role: 'admin', meta: { requiresAdmin: true } })
    ).toBe('allow')
  })
})
```

- [ ] **Step 2: 运行测试，确认失败**

Run:

```powershell
pnpm --filter @sse/web exec vitest run src/__tests__/permissions.test.ts
```

Expected: FAIL，报错类似 `resolveGuard is not a function` / `No "resolveGuard" export`。

- [ ] **Step 3: 实现 `resolveGuard`**

在 `packages/web/src/permissions.ts` 末尾追加：

```ts
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
```

- [ ] **Step 4: 运行测试，确认通过**

Run:

```powershell
pnpm --filter @sse/web exec vitest run src/__tests__/permissions.test.ts
```

Expected: `Tests 14 passed`。

- [ ] **Step 5: 更新路由元数据**

修改 `packages/web/src/router/index.ts`：

1. 在文件顶部（`const routes` 之前）加入类型扩展：

```ts
declare module 'vue-router' {
  interface RouteMeta {
    title?: string
    icon?: string
    guest?: boolean
    hidden?: boolean
    requiresAdmin?: boolean
    allowedRoles?: string[]
  }
}
```

2. 把 `approvals` 与 `approvals/:reportId` 的 `meta` 改为：

```ts
meta: { title: '审批管理', icon: 'Checked', allowedRoles: ['dept_approver', 'finance', 'admin'] }
```

```ts
meta: { title: '审批处理', hidden: true, allowedRoles: ['dept_approver', 'finance', 'admin'] }
```

3. 把 `statistics` 的 `meta` 改为：

```ts
meta: { title: '统计分析', icon: 'DataAnalysis', allowedRoles: ['finance', 'admin'] }
```

4. 把 6 个 `admin/*` 路由的 `requiresAdmin: true` 全部替换为 `allowedRoles: ['admin']`：

```ts
meta: { title: '内容快照', allowedRoles: ['admin'] }
meta: { title: '备份与恢复', allowedRoles: ['admin'] }
meta: { title: '系统管理', icon: 'Setting', allowedRoles: ['admin'] }
meta: { title: '用户管理', allowedRoles: ['admin'] }
meta: { title: '部门管理', allowedRoles: ['admin'] }
meta: { title: '消息管理', allowedRoles: ['admin'] }
meta: { title: '推理规则', allowedRoles: ['admin'] }
```

- [ ] **Step 6: 改写守卫**

把 `packages/web/src/router/index.ts` 末尾的 `router.beforeEach(...)` 整体替换为：

```ts
router.beforeEach((to) => {
  const auth = useAuthStore()
  const decision = resolveGuard({
    isLoggedIn: auth.isLoggedIn,
    role: auth.user?.role,
    meta: to.meta,
  })

  if (decision === 'login') return { path: '/login' }
  if (decision === 'dashboard') return { path: '/dashboard' }
  if (decision === 'forbidden') {
    return { path: '/forbidden', query: { from: to.fullPath } }
  }
  return true
})
```

并在文件顶部的导入中加入 `resolveGuard`：

```ts
import { resolveGuard } from '@/permissions'
```

- [ ] **Step 7: 运行测试与构建**

Run:

```powershell
pnpm --filter @sse/web exec vitest run src/__tests__/permissions.test.ts
pnpm --filter @sse/web build
```

Expected: 测试通过；构建成功，无 TypeScript/vue-tsc 错误。

- [ ] **Step 8: 提交**

```powershell
git add packages/web/src/router/index.ts packages/web/src/permissions.ts packages/web/src/__tests__/permissions.test.ts
git commit -m "feat(web): guard role-restricted routes and expose allowed roles"
```

---

### Task 4: 导航按角色渲染

**Files:**
- Modify: `packages/web/src/layouts/DefaultLayout.vue`

- [ ] **Step 1: 替换共享脚本导入**

把 `packages/web/src/layouts/DefaultLayout.vue` 的 `<script setup>` 导入区：

```ts
import { ref, computed, onMounted } from 'vue'
import { useAuthStore } from '@/stores/auth'
import { useRouter } from 'vue-router'
import api from '../api/index'
```

改为：

```ts
import { ref, computed, onMounted } from 'vue'
import { useAuthStore } from '@/stores/auth'
import api from '../api/index'
import { APPROVER_ROLE_NAMES, canAccessRoute, navItemsForRole } from '@/permissions'
```

- [ ] **Step 2: 用 `navItemsForRole` 替换整个 `isAdmin` + `navItems` 块**

删除：

```ts
const isAdmin = computed(() => auth.user?.role === 'admin')

const navItems = computed(() => {
  const items = [
    // ... 原有全部导航项定义 ...
  ]
  if (isAdmin.value) {
    items.push(
      // ... admin 项 ...
    )
  }
  return items
})
```

替换为：

```ts
const navItems = computed(() => navItemsForRole(auth.user?.role))
```

- [ ] **Step 3: 更新导航模板中的徽标**

把：

```html
<span v-show="!collapsed && item.badge" class="nav-badge">{{ item.badge }}</span>
```

改为：

```html
<span
  v-show="!collapsed && item.path === '/approvals' && pendingApprovalCount > 0"
  class="nav-badge"
>{{ pendingApprovalCount }}</span>
```

- [ ] **Step 4: 更新 `onMounted` 的审批计数判断**

把：

```ts
onMounted(async () => {
  const role = auth.user?.role
  if (role === 'dept_approver' || role === 'admin') {
```

改为：

```ts
onMounted(async () => {
  if (canAccessRoute(auth.user?.role, APPROVER_ROLE_NAMES)) {
```

- [ ] **Step 5: 运行构建与全量 Web 测试**

Run:

```powershell
pnpm --filter @sse/web test
pnpm --filter @sse/web build
```

Expected: `Test Files` 全部通过；构建成功。

- [ ] **Step 6: 提交**

```powershell
git add packages/web/src/layouts/DefaultLayout.vue
git commit -m "feat(web): filter sidebar navigation by role"
```

---

### Task 5: 全量验证与进度记录

**Files:**
- Create: `docs/2026-11-22-sse-process.md`

- [ ] **Step 1: 运行完整验证**

Run:

```powershell
pnpm --filter @sse/web test
pnpm --filter @sse/web build
```

Expected:

```text
Test Files  N passed
Tests       M passed
vite ... built in ...
```

记录实际数字用于文档。

- [ ] **Step 2: 写进度记录**

创建 `docs/2026-11-22-sse-process.md`，内容包含：

```markdown
# SSE 开发过程记录（2026-11-22 · P1-11）

> 对应 `docs/2026-11-12-sse-multi-role-analysis.md` P1 第 11 项：
> 导航按角色过滤，消除 403/空页面。

## 落地内容

- `packages/web/src/permissions.ts`：唯一角色矩阵（工作台/报销/审批/统计/本体/管理），纯函数 `navItemsForRole`、`canAccessRoute`、`resolveGuard`、`roleLabel`。
- `DefaultLayout.vue`：侧栏改为按角色渲染；员工不再看到审批管理与统计分析；审批徽标仅对审批相关角色显示。
- `router/index.ts`：受限路由使用 `meta.allowedRoles`；守卫把无权限访问重定向到 `/forbidden?from=...`。
- `pages/Forbidden.vue`：说明当前角色与目标页面，提供返回工作台/上一页。

## 权限矩阵

| 入口 | employee | dept_approver | finance | admin |
|---|---|---|---|---|
| 工作台 / 报销列表 / 本体 | ✓ | ✓ | ✓ | ✓ |
| 审批管理 | — | ✓ | ✓ | ✓ |
| 统计分析 | — | — | ✓ | ✓ |
| 系统管理 | — | — | — | ✓ |

## 验证

- `pnpm --filter @sse/web test`：<填入实际结果>
- `pnpm --filter @sse/web build`：<填入实际结果>

## 复测要点

1. 员工登录：侧栏无“审批管理”“统计分析”；直接访问 `/statistics`、`/approvals` 进入无权限页。
2. 部门审批人：可见审批管理；`/statistics` 进入无权限页。
3. 财务：可见审批管理与统计分析；`/admin` 进入无权限页。
4. 管理员：可见全部入口。
5. 无权限页“返回工作台”“返回上一页”可用。
```

- [ ] **Step 3: 提交**

```powershell
git add docs/2026-11-22-sse-process.md
git commit -m "docs: record P1-11 role-based navigation"
```

---

## Self-Review 结果

- **Spec coverage:** 导航过滤（Task 4）、唯一角色矩阵（Task 1）、路由守卫（Task 3）、无权限页（Task 2）、测试（Task 1/2/3）、进度记录（Task 5）均有对应任务。
- **Placeholder scan:** 无 TBD/TODO；所有代码步骤含完整代码。
- **Type consistency:** `navItemsForRole`、`canAccessRoute`、`resolveGuard`、`roleLabel`、`APPROVER_ROLE_NAMES` 在各 Task 中命名一致；`RouteMeta` 字段与 `GuardMeta` 对齐。
