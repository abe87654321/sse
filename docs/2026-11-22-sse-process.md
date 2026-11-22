# SSE 开发过程记录（2026-11-22 · P1-11）

> 对应 `docs/2026-11-12-sse-multi-role-analysis.md` P1 第 11 项：
> “导航按角色过滤，消除 403/空页面。”

## 落地内容

- `packages/web/src/permissions.ts`（新）：`NAV_ITEMS` 导航注册表、`navItemsForRole`、`canAccessRoute`、`resolveGuard`、`roleLabel`，以及导出的角色组 `ALL_ROLES/APPROVER_ROLES/FINANCE_ROLES/ADMIN_ROLES`，作为导航、路由守卫与页面组件共用的权限真源。
- `Dashboard.vue`、`VerificationHistory.vue`、`Ontology.vue`：改用 `canAccessRoute(..., APPROVER_ROLES/FINANCE_ROLES/ADMIN_ROLES)`，移除组件内重复的角色判断。
- `packages/web/src/layouts/DefaultLayout.vue`：侧栏改为渲染 `navItemsForRole(auth.user?.role)`；审批红点仅在 `/approvals` 且数量大于 0 时显示；`onMounted` 的审批数量拉取由 `canAccessRoute(..., APPROVER_ROLE_NAMES)` 控制。
- `packages/web/src/router/index.ts`：扩展 `RouteMeta`；为审批管理、审批处理、统计分析及全部 `admin/**` 路由补充 `allowedRoles`；守卫对无权限角色重定向到 `/forbidden?from=<fullPath>`，并保留 `requiresAdmin` 作为兼容兜底。
- `packages/web/src/pages/Forbidden.vue`（新）：展示当前角色与被拒绝页面，提供“返回工作台”（`/dashboard`）与“返回上一页”（基于 `window.history.state.back`，无历史时回退 `/dashboard`）。
- 测试：新增 `src/__tests__/permissions.test.ts`、`src/router/__tests__/routes.test.ts`、`src/pages/__tests__/Forbidden.test.ts`。

## 权限矩阵

| 入口 | employee | dept_approver | finance | admin |
|---|---|---|---|---|
| 工作台 / 报销列表 / 本体 | ✓ | ✓ | ✓ | ✓ |
| 审批管理 | — | ✓ | ✓ | ✓ |
| 统计分析 | ✓ | ✓ | ✓ | ✓ |
| 系统管理 | — | — | — | ✓ |

> 说明：原始分析文档中“统计接口仅 finance/admin”的结论在 P1-8 之后已过时。`/statistics` 现按角色返回范围数据（employee 本人 / dept_approver 本部门 / finance+admin 全量），`/statistics/export` 仍仅 `finance/admin`。本次后续修复将 Web 权限矩阵与之对齐。

## 验证

- `pnpm --filter @sse/web test`：**Test Files 13 passed (13)，Tests 83 passed (83)**，退出码 0。
  - 其中 P1-11 相关：`src/__tests__/permissions.test.ts` 19 项、`src/router/__tests__/routes.test.ts` 2 项、`src/pages/__tests__/Forbidden.test.ts` 4 项、`src/pages/__tests__/Statistics.test.ts` 2 项全部通过。
- `pnpm --filter @sse/web build`：vite v5.4.21，**206 modules transformed**，`✓ built in 4.76s`，退出码 0，产物写入 `packages/web/dist/`。

## 关键提交

| SHA | 提交说明 |
|---|---|
| `fd3ee7f` | feat(web): add role-based navigation permission registry |
| `172ca12` | feat(web): add forbidden page for denied routes |
| `0f3821e` | fix(web): harden forbidden back navigation and cover it |
| `3941a55` | feat(web): guard role-restricted routes and expose allowed roles |
| `ab7b1d7` | fix(web): drop backup nav entry until backup routes land |
| `d5bee03` | test(web): cover guest guard branch and nav route targets |
| `95e0e4c` | feat(web): filter sidebar navigation by role |
| `146db3e` | fix(web): align statistics access with scoped API and unify role matrix |
| `0746a44` | docs: correct P1-11 statistics matrix |
| `f8729a1` | refactor(web): reuse shared role groups across pages |

## 复测要点

1. **employee**：侧栏不出现“审批管理”；可直接打开“统计分析”查看本人范围数据；访问 `/approvals`、`/admin/**` 均进入 `/forbidden?from=...`。
2. **dept_approver**：可见“审批管理”；可打开“统计分析”查看本部门范围数据。
3. **finance**：可见“审批管理”与“统计分析”（全量）；访问 `/admin/**` 进入无权限页。
4. **admin**：可见全部 11 个导航项（6 个一级入口 + 5 个系统管理子项）。
5. **无权限页按钮**：“返回工作台”回到 `/dashboard`；“返回上一页”在存在历史时回退，否则回 `/dashboard`。
6. **备份入口**：当前分支基于 master，尚无 `/admin/backups` 路由，故 `NAV_ITEMS` 中暂不包含备份入口；P1-7 合并后需重新补回。

## 已知后续

1. 仓库的 `build` 目前仅是 `vite build`，不做类型检查；建议增加 `vue-tsc --noEmit` 类型检查脚本，并修复既有的 DOM lib 配置问题。
2. 可选补充 `DefaultLayout` 组件挂载测试，覆盖导航渲染与审批红点门控。
3. P1-7 合并后，将 `/admin/backups` 导航项重新加回 `NAV_ITEMS` 并补对应路由测试。

## 会话收尾

- 分支 `feat/p1-11-role-navigation` 已本地 fast-forward 合并到 `master`，功能分支已删除。
- 最终 HEAD：`4e24772`；已推送到 `origin/master`（`cd69516..4e24772`）。
- 合并后在 `master` 复测：`pnpm --filter @sse/web test` 83 passed；`pnpm --filter @sse/web build` 通过。
- 未跟踪文件保持原样，未提交：`docs/handover-docs/**`、`docs/2026-11-12-sse-multi-role-analysis.md`。

### 测试机更新（仅前端，无数据库迁移）

```bash
cd /path/to/sse
git checkout master
git pull --ff-only
git rev-parse --short HEAD          # 期望 4e24772
pnpm install --frozen-lockfile
pnpm --filter @sse/web build        # 产物 packages/web/dist/

# 让静态站点生效（按实际部署方式二选一）
sudo nginx -s reload
# 或重启提供静态文件的 web 服务/容器
# 若用 dev server：重启 `pnpm --filter @sse/web dev --host`
```

复测前重新登录一次，以刷新 `localStorage` 中的角色信息。

### 下一次会话建议

P1-9（部门 CRUD）或 P1-10（MCP Key 管理）；同时可将 `vue-tsc --noEmit` 类型检查脚本作为独立小项处理。

---

# P1-9 部门管理（真实 CRUD + 数据正规化）

> 对应 `docs/2026-11-12-sse-multi-role-analysis.md` P1 第 9 项：
> “实现真实部门 CRUD，或移除无效入口。”
>
> 设计：`docs/superpowers/specs/2026-11-22-p1-9-departments-design.md`
> 计划：`docs/superpowers/plans/2026-11-22-p1-9-departments.md`
> TDD 证据：`docs/testing/departments.tdd.md`
> 分支：`feat/p1-9-departments`（基线 `e66c674`）

## 落地内容

| 层 | 变更 |
|---|---|
| 迁移 | `025_departments.sql`：`departments(id,name UNIQUE,is_protected)`、“未分配”受保护、从 `users.department` 回填、`users.department_id` NOT NULL + FK RESTRICT、删除文本列与 `mcp_api_keys.department`、保护触发器 |
| db | `PgDepartmentRepo`（list/find/create/rename/delete/resolveOrCreate）；`PgUserRepo` 与快照仓储改走 departments join；`Department` 类型 |
| shared | `User.departmentId?` |
| core | 统计谓词改为 `u.department_id = (SELECT id FROM departments WHERE name = $n)` |
| api | 部门 GET/POST/PATCH/DELETE；用户创建/更新支持 `departmentId` 或名称，未知 400 `UNKNOWN_DEPARTMENT`；审批/报销/统计/用户搜索/SCIM/本体查询改 join；SCIM/MDM 自动建部门并写审计；审计分类 `department.*` |
| mcp | key 刷新与 8 处工具 SQL 改 join/名称子查询 |
| web | `AdminDepartments.vue` id 驱动 CRUD（重命名、删除保护/占用禁用）；`AdminUsers.vue` 部门下拉来自 API，使用 `departmentId` |

## 关键提交

| SHA | 说明 |
|---|---|
| `52ac905` | feat(db): add departments table and repository |
| `2b4de8e` | refactor(db): read user department via departments join |
| `d91224c` | refactor(statistics): resolve department by id |
| `b86d462` | feat(api): implement department CRUD and user department resolution |
| `2985a94` | refactor(api): resolve departments through join |
| `2908d40` | feat(api): auto-create departments for identity sync |
| `041e569` | refactor(mcp): resolve departments through join |
| `f879da0` | feat(web): wire department management |
| `c22d265` | fix(api): finish department join migration in user, scim and ontology routes |

## 验证

```text
pnpm -r test    -> 842 passed（web 89 / core 70 / auth 30 / db 71 / ai 100 /
                              notifications 29 / ontology 176 / api 218 / mcp 59）
pnpm -r build   -> 11/11 个包完成
```

本机无 Docker，**未执行真实 PostgreSQL 迁移 025**；迁移 SQL 通过静态守卫测试，部署前须在测试机执行。

## 上线顺序（单副本约束）

```bash
# 1. 停 API（旧代码仍引用 users.department，迁移后不可继续运行）
# 2. 迁移
pnpm --filter @sse/db migrate
# 3. 重新构建并启动 API / Web
pnpm -r build
```

## 已知缺口

1. 重命名部门后，已登录 `dept_approver` 的旧 JWT 仍带旧部门名，数据范围 fail-closed；需重新登录。
2. 部门 CRUD 不写 Ontology；重命名后旧 Department 实体残留，待用户编辑时重同步。
3. `mcp_api_keys.department` 已删除，手工建 key 时不要再写该列。
4. 集成测试 `test/ontology-outbox.test.ts` 已改为 `department_id`，需在配置了 `TEST_DATABASE_URL` 的环境复跑。

## P1 清单进度

| 优先级 | 项 | 状态 |
|---|---|---|
| P1-5 | 报销单内容快照 | ✅ 已完成 |
| P1-6 | 发票核对历史版本 | ✅ 已完成 |
| P1-7 | 导出补齐明细/审批链/付款/发票 + XLSX + 导出审计 | 待处理 |
| P1-8 | 统计口径一致性 | ✅ 已完成 |
| P1-9 | 真实部门 CRUD | ✅ 已完成（本次会话） |
| P1-10 | MCP Key 管理界面 + 哈希存储 + 过期/吊销/最后使用 | 待处理 |
| P1-11 | 导航按角色过滤 | ✅ 已完成 |
| P1-12 | 只读审计员角色 + 审计查询页 | 待处理 |

**下一次会话建议：** P1-10（安全价值最高，迁移 014 已支持过期字段）或 P1-7（导出补齐）。

---

# P1-9 第 2 阶段：Ontology 同步与重命名提示

> 分支仍为 `feat/p1-9-departments`；提交 `e5b3e24`。

## 范围

1. **A. 部门变更同步 Ontology**：新增/重命名/删除部门时同步 legacy OwlStore 与 v2 图谱；
   重命名时把用户的 `belongsTo` 与新 `department` 属性迁移到新 URI，并删除旧 Department 实体。
2. **B. 重命名后旧 JWT 提示**：`PATCH /admin/departments/:id` 返回受影响用户数，前端提示重新登录。
3. **顺带修复第 1 阶段遗留**：v2 投影仍读 `users.department`，迁移后所有用户会被投影成“未分配”。

## 落地内容

| 层 | 变更 |
|---|---|
| 迁移 | `026_ontology_user_department.sql`：重写 outbox 触发器，为 `users` 载荷补 `department` 名称，保留脱敏 denylist |
| ontology | `reconcile` 的 users 查询 join `departments`；`shadow` 支持 SQL 表达式列并解析部门名；`OwlStore` 新增 `setProperty`，并修复 n3 v1 `removeMatches` 不生效导致的 `deleteEntity/deleteRelation` 空操作 |
| api | `services/department-ontology.ts`：legacy + v2 部门同步（create/rename/delete、用户关系迁移）；admin 路由接线；重命名返回 `affectedUsers` |
| web | 部门页重命名后展示“N 名用户需重新登录”提示 |

## 关键提交

| SHA | 说明 |
|---|---|
| `e5b3e24` | feat: sync department changes to ontology and fix v2 department projection |

## 验证

```text
pnpm -r test    -> 855 passed（web 89 / core 70 / auth 30 / db 74 / ai 100 /
                              notifications 29 / ontology 180 / api 224 / mcp 59）
pnpm -r build   -> 11/11 个包完成
```

本机无 Docker，**迁移 025/026 仍需在测试机真实执行**。

## 测试机复测新增点

1. 重命名部门：本体页人员节点显示新部门，旧 Department 节点消失；响应含 `affectedUsers`。
2. `ONTOLOGY_V2=shadow` 下执行一次 reconcile/shadow，对比无部门差异。
3. 迁移 026 后，`users` 的 outbox 事件 `new_row` 含 `department` 名称且不含手机号/邮箱等敏感字段。
4. 删除空部门后，本体页不再出现该 Department 节点。

## 更新后的已知缺口

1. 重命名后的旧 JWT 仍 fail-closed；已提供 `affectedUsers` 提示，未做每请求 DB 校验。
2. Ontology 同步为 best-effort，失败不回滚部门改名；下一次 reconcile 或用户编辑会校正。
3. `mcp_api_keys.department` 已删除，手工建 key 时不要再写该列。
4. 集成测试 `test/ontology-outbox.test.ts` 需在配置 `TEST_DATABASE_URL` 的环境复跑。
