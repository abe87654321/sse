# P1-9 部门管理 TDD 证据

> 分支 `feat/p1-9-departments`；设计 `docs/superpowers/specs/2026-11-22-p1-9-departments-design.md`；
> 计划 `docs/superpowers/plans/2026-11-22-p1-9-departments.md`。

## 1. 行为清单与测试锚点

| 行为 | 测试 |
|---|---|
| 迁移建 departments、回填、FK、删文本列、保护触发器 | `packages/db/src/__tests__/migration-025.test.ts`（4） |
| 部门仓储 list/create/rename/delete/resolveOrCreate | `packages/db/src/__tests__/pg-department-repo.test.ts`（5） |
| 用户仓储通过 departments join 返回名称与 id | `packages/db/src/__tests__/pg-user-repo.test.ts`（3） |
| 统计按部门 id 过滤、按部门名聚合 | `packages/core/src/services/__tests__/statistics.test.ts`、`packages/api/src/__tests__/statistics.test.ts`、`packages/mcp/src/__tests__/get-statistics.test.ts` |
| 部门 CRUD 路由与错误码 | `packages/api/src/__tests__/admin-departments.test.ts`（12） |
| 用户创建按 departmentId 解析、未知部门 400 | 同上 |
| SCIM 未知部门自动创建、复用已有部门 | `packages/api/src/services/__tests__/identity-bridge.test.ts`（6） |
| 审计分类 department.create/update/delete | `packages/api/src/services/__tests__/audit.test.ts` |
| 用户页部门下拉来自 API | `packages/web/src/pages/__tests__/AdminUsers.test.ts`（4） |
| 部门页 CRUD、受保护/占用禁用 | `packages/web/src/pages/__tests__/AdminDepartments.test.ts`（5） |

## 2. RED → GREEN 记录

1. 迁移测试先写正则断言，再写 `025_departments.sql`。
2. `PgDepartmentRepo` 测试先断言 `u.department_id = d.id`、`ORDER BY d.name`、`ON CONFLICT (name)`，再实现仓储。
3. 统计测试把 `u.department = $n` 改为 `u.department_id = (SELECT id FROM departments WHERE name = $n)`，
   并新增 `LEFT JOIN departments d` 的聚合断言。
4. 部门路由测试覆盖：列表、新增、空名、重名 409、重命名、受保护 409、404、占用 409、删除成功。
5. 身份同步测试覆盖：自动建部门、复用已有部门、写入 `department_id`。
6. Web 测试覆盖：部门选项来自 API、创建载荷带 `departmentId`、部门页 CRUD 与禁用条件。

## 3. 第 2 阶段：Ontology 同步与旧 JWT 提示

| 行为 | 测试 |
|---|---|
| outbox 为 users 载荷补齐部门名，保留脱敏 denylist | `packages/db/src/__tests__/migration-026.test.ts`（3） |
| 重建图谱时 users 通过 departments join 取名称 | `packages/ontology/src/__tests__/reconcile.test.ts` |
| shadow 采样 SQL 解析用户部门名 | `packages/ontology/src/__tests__/shadow.test.ts` |
| OwlStore 属性替换与实体删除（修复 n3 v1 removeMatches 不生效） | `packages/ontology/src/__tests__/owl-store.test.ts`（2） |
| 部门创建/重命名/删除同步 legacy 与 v2 图谱 | `packages/api/src/services/__tests__/department-ontology.test.ts`（6） |
| 重命名返回受影响用户数并触发同步 | `packages/api/src/__tests__/admin-departments.test.ts` |
| 前端展示“需重新登录”提示 | `packages/web/src/pages/__tests__/AdminDepartments.test.ts` |

## 4. 全量验证（本地）

```text
pnpm -r test
  web           89 passed
  core          70 passed
  auth          30 passed
  db            74 passed
  ai           100 passed
  notifications 29 passed
  ontology     180 passed
  api          224 passed
  mcp           59 passed
  合计         855 passed

pnpm -r build
  11/11 个包完成（shared/web/core/ocr/ai/auth/db/notifications/ontology/api/mcp）
```

## 5. 已知边界与未在本机验证项

1. **真实 PostgreSQL 迁移未在本机执行**：本机无 Docker，`025`/`026` 仅通过静态守卫测试。
   部署前必须在测试机执行并核对回填结果。
2. **重命名后的旧 JWT**：token 内仍带旧部门名；`dept_approver` 的旧 token 会因
   `departments.name` 不存在而查不到数据（fail-closed，不越权）。重命名接口现在返回
   `affectedUsers`，前端提示相关用户重新登录。
3. **Ontology 同步是 best-effort**：legacy 与 v2 图谱都会更新，但失败不会回滚部门改名；
   下一次 reconcile 或用户编辑会再次校正。
4. **外部密钥**：`mcp_api_keys.department` 已删除；今后手工插入 key 时不要再写该列。
5. **集成测试**：`test/ontology-outbox.test.ts` 已改为 `department_id`；`test/mdm.test.ts` 通过 API 自动建部门。

## 6. 测试机迁移与复测

```bash
# 最终 HEAD：e768e80（已合并到 master 并推送）
docker compose exec -T postgres pg_dump -U sse sse > ~/sse-before-p1-9.sql
git checkout master
git pull --ff-only
git rev-parse --short HEAD            # 期望 e768e80
pnpm install --frozen-lockfile
pnpm -r build
# 停 API 后再迁移，避免旧代码访问已删除的 department 列
pnpm --filter @sse/db migrate

docker compose exec -T postgres psql -U sse -d sse -c "
  SELECT name, is_protected, COUNT(u.id) AS users
  FROM departments d LEFT JOIN users u ON u.department_id = d.id
  GROUP BY d.id ORDER BY d.name;"

# 迁移 026 生效：users 事件应带 department 名称
docker compose exec -T postgres psql -U sse -d sse -c "
  SELECT version FROM schema_migrations WHERE version = '026_ontology_user_department';"
```

复测要点：

1. 部门页可新增、重命名、删除空部门；有用户或“未分配”时按钮禁用且返回 409。
2. 用户页部门下拉来自真实部门表；创建/编辑后列表显示名称。
3. 重命名部门后，用该部门 `dept_approver` 重新登录可见新部门数据；未重新登录时看不到（fail-closed）。
4. SCIM/MDM 推送新部门名后自动出现在部门页，`audit_events` 有 `department.auto_create`。
5. 统计页按部门筛选与总览口径一致。
6. 直接 `UPDATE/DELETE` “未分配” 被触发器拒绝。
7. 重命名后刷新本体页：人员节点显示新部门，旧 Department 节点消失；重命名响应含 `affectedUsers`。
8. 执行一次 reconcile 后 shadow 对比（如启用 `ONTOLOGY_V2=shadow`）不出现部门差异。
