# 导航按角色过滤与无权限页（P1-11）设计

> 对应 `docs/2026-11-12-sse-multi-role-analysis.md` P1 第 11 项：
> “导航按角色过滤，消除 403/空页面。”
> 日期：2026-11-22

## 1. 目标与范围

### 目标

- 侧边导航只展示当前角色可访问的入口，不再对员工展示“审批管理”“统计分析”。
- 受角色限制的路由增加守卫：登录用户直接访问无权限 URL 时进入“无权限”页，而不是静默跳转或无意义空页面。
- “无权限”页明确说明当前角色、目标页面，并提供“返回工作台”“返回上一页”。
- 导航与路由守卫共用同一份角色矩阵，避免两处判断漂移。

### 非目标

- 不改后端 RBAC 与 API 权限（服务端仍为唯一强制点）。
- 不新增审计员角色（P1-12）。
- 不改动审批/统计/本体的业务逻辑与页面内部数据范围。
- 不做移动端底部导航的独立改造（沿用现有响应式侧栏）。
- 不引入后端下发的权限清单或动态菜单。

## 2. 现状与问题

| 位置 | 现状 | 问题 |
|---|---|---|
| `DefaultLayout.vue` | 导航对所有人显示工作台、报销列表、审批管理、统计分析、本体可视化 | 员工看到“审批管理”“统计分析” |
| `api/routes/approvals.ts` | `/approvals/pending` 仅 `dept_approver/finance/admin` | 员工进入后 403，页面提示“加载审批列表失败” |
| `api/routes/statistics.ts` | `/statistics` 仅 `finance/admin` | 员工、部门审批人进入后 403，页面显示加载失败 |
| `router/index.ts` | 只校验 `requiresAdmin` | 受限路由无角色守卫；无权限时静默 `next('/dashboard')`，无解释 |

### 角色与真实权限（以服务端为准）

| 能力 | employee | dept_approver | finance | admin |
|---|---|---|---|---|
| 工作台 `/dashboard` | ✓ | ✓ | ✓ | ✓ |
| 报销列表 `/expenses` | ✓ | ✓ | ✓ | ✓ |
| 审批管理 `/approvals` | — | ✓ | ✓ | ✓ |
| 统计分析 `/statistics` | — | — | ✓ | ✓ |
| 本体可视化 `/ontology`（只读） | ✓ | ✓ | ✓ | ✓ |
| 系统管理 `/admin/**` | — | — | — | ✓ |

说明：`finance` 在 `/approvals/pending` 中可见按 `approver_id` 匹配的步骤，且页面已有对应审批入口，因此审批管理对 finance 开放。

## 3. 关键决策

| 决策 | 结论 |
|---|---|
| 权限真源 | 前端新增 `packages/web/src/permissions.ts`，导出导航项、角色矩阵与纯函数 |
| 导航过滤 | `DefaultLayout` 渲染 `navItemsForRole(role)`，删除零散 `isAdmin` 判断 |
| 路由守卫 | 路由 `meta.allowedRoles`；未登录先跳 `/login`，角色不匹配跳 `/forbidden` |
| 无权限页 | 新增 `/forbidden`，仍在 `DefaultLayout` 内，保留导航 |
| 旧字段兼容 | `meta.requiresAdmin` 迁移为 `meta.allowedRoles: ['admin']`，守卫保留对旧字段的兜底 |
| 默认落点 | 登录后仍为 `/dashboard`，对所有角色可用 |

## 4. 组件与接口设计

### 4.1 `permissions.ts`（新）

```ts
export interface NavItem {
  path: string
  label: string
  icon: string
  roles: UserRole[]
}

export const NAV_ITEMS: NavItem[] = [ ... ]      // 含 admin 子项

export function navItemsForRole(role: string | undefined): NavItem[]
export function canAccessRoute(role: string | undefined, allowed?: readonly string[]): boolean
export function roleLabel(role: string | undefined): string
```

- `NAV_ITEMS` 顺序即导航顺序；admin 项 `roles: ['admin']`。
- `navItemsForRole` 对未知/空角色返回空数组（fail closed）。
- `canAccessRoute`：`allowed === undefined` 视为不限制，返回 `true`；`allowed` 为空数组或角色为空返回 `false`；否则 `allowed.includes(role)`。
- `roleLabel` 输出“员工/部门审批人/财务/系统管理员”，未知角色回退原值或“未知角色”。

### 4.2 路由 `meta`

```ts
meta: { title: '审批管理', allowedRoles: ['dept_approver', 'finance', 'admin'] }
meta: { title: '统计分析', allowedRoles: ['finance', 'admin'] }
meta: { title: '用户管理', allowedRoles: ['admin'] }   // admin/** 全部改用 allowedRoles
```

### 4.3 路由守卫

```ts
router.beforeEach((to) => {
  const auth = useAuthStore()
  if (to.meta.guest) return auth.isLoggedIn ? '/dashboard' : true
  if (!auth.isLoggedIn) return '/login'

  const allowed = to.meta.allowedRoles as string[] | undefined
  const requiresAdmin = to.meta.requiresAdmin === true
  if (requiresAdmin && auth.user?.role !== 'admin') {
    return { path: '/forbidden', query: { from: to.fullPath } }
  }
  if (allowed && !canAccessRoute(auth.user?.role, allowed)) {
    return { path: '/forbidden', query: { from: to.fullPath } }
  }
  return true
})
```

- `/forbidden` 自身不设置 `allowedRoles`/`requiresAdmin`。
- 守卫返回重定向对象，避免额外调用 `next`。

### 4.4 `Forbidden.vue`（新）

- 文案：`当前角色（{{ roleLabel(auth.user?.role) }}）无权访问 {{ targetLabel }}。`
- `targetLabel` 优先使用 `to.query.from` 对应路由的 `meta.title`，否则显示原始路径或“该页面”。
- 操作：`返回工作台`（`/dashboard`）、`返回上一页`（`router.back()`，无历史时回工作台）。
- 复用现有 `card` / `btn-primary` / `btn-secondary` 样式，保持视觉一致。

## 5. 数据流

1. 登录后 `auth.user.role` 来自 `/auth/profile`（既有流程）。
2. `DefaultLayout` 计算 `navItemsForRole(auth.user?.role)` 渲染导航。
3. 任意跳转先经 `beforeEach`：
   - 未登录 → `/login`
   - 角色不匹配 → `/forbidden?from=<fullPath>`
   - 通过 → 正常渲染
4. `Forbidden.vue` 读取 `from` 与当前角色，展示说明并提供返回操作。

## 6. 边界与失败处理

| 场景 | 行为 |
|---|---|
| 未登录访问受限页 | 先跳 `/login`（登录后再按角色判断） |
| 未知/空角色 | `canAccessRoute` 返回 `false`，导航仅显示无 `roles` 限制的公共项（fail closed） |
| 直接输入 `/forbidden` | 正常显示无权限页（不构成循环） |
| `/forbidden?from` 指向不存在路径 | 显示原始 path 文案，返回工作台可用 |
| `router.back()` 无历史 | 回退到 `/dashboard` |
| 管理员访问 `/admin` | 放行 |
| finance 访问 `/approvals` | 放行（API 允许） |
| dept_approver 访问 `/statistics` | 跳 `/forbidden` |
| 本体页 | 全员可进；编辑工具仍由页面内 `isAdmin` 控制 |

## 7. 测试策略

- 纯函数单测（`packages/web/src/utils/__tests__/permissions.test.ts`）：
  - 4 个角色各自可见的导航路径集合；
  - `canAccessRoute` 对允许/拒绝/未知角色/空 allowed 的行为；
  - `roleLabel` 输出。
- 路由守卫单测：把守卫逻辑抽为可测函数，或对 `router` 做最小挂载测试，覆盖 4 条路径（未登录、员工→统计、财务→审批、管理员→管理）。
- `Forbidden.vue` 挂载测试：渲染角色说明、`返回工作台` 链接、`返回上一页` 触发 `router.back`。
- 回归：员工侧栏不再出现“审批管理”“统计分析”；财务可见“审批管理”但不可见“系统管理”。
- 不依赖真实后端；延续现有 vitest + `@vue/test-utils` 模式。

## 8. 验收标准

1. 员工登录：侧栏仅工作台、报销列表、本体可视化；访问 `/approvals`、`/statistics` 显示无权限页。
2. 部门审批人登录：多出审批管理；访问 `/statistics` 显示无权限页。
3. 财务登录：可见审批管理、统计分析；访问 `/admin/**` 显示无权限页。
4. 管理员：可见全部导航与 `系统管理` 子项。
5. 无权限页显示当前角色与被拒绝页面，两个返回按钮可用。
6. `pnpm --filter @sse/web test`、`pnpm --filter @sse/web build` 通过。

## 9. 回滚

- 本次改动仅涉及前端 `packages/web`，回滚实现提交即可恢复原导航与守卫，无数据迁移。
- 若需临时放行某页面，只需调整对应导航项与路由 `allowedRoles`。
