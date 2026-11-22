# P1-9 部门管理实施计划

> **For agentic workers:** 逐任务执行，TDD，频繁提交。设计见
> `docs/superpowers/specs/2026-11-22-p1-9-departments-design.md`。

**Goal:** 建立真实部门表与 CRUD，并把全系统部门读取正规化到 `users.department_id`。

**Architecture:** `departments` 为名称真源，`users.department_id` 唯一关联；应用层继续以部门名做入参与展示，SQL 通过 join/名称子查询解析；受保护“未分配”兜底；SCIM/MDM 自动建部门。

**Tech Stack:** PostgreSQL / TypeScript / Express / Vue 3 / Vitest。

---

### Task 1: 迁移 025

**Files:**
- Create: `packages/db/src/migrations/025_departments.sql`
- Test: `packages/db/src/__tests__/migration-025.test.ts`

- [ ] 按设计第 3 节写迁移 SQL。
- [ ] 写静态守卫测试：建表、`未分配` 受保护、`department_id` NOT NULL + FK RESTRICT、删除 `users.department`、删除 `mcp_api_keys.department`、保护触发器。
- [ ] `pnpm --filter @sse/db test` 通过。
- [ ] 提交 `feat(db): add departments table and normalize users`.

### Task 2: PgDepartmentRepo

**Files:**
- Create: `packages/db/src/repositories/pg-department-repo.ts`
- Modify: `packages/db/src/repositories/index.ts`
- Test: `packages/db/src/__tests__/pg-department-repo.test.ts`

- [ ] 实现 `list/findById/findByName/create/rename/delete/resolveOrCreate`（唯一冲突映射由 API 层处理，repo 抛原始错误）。
- [ ] 测试断言 SQL 含 `LEFT JOIN users u ON u.department_id = d.id`、`ORDER BY d.name`、`ON CONFLICT (name)`。
- [ ] 提交 `feat(db): add department repository`.

### Task 3: 用户仓储与共享类型

**Files:**
- Modify: `packages/shared/src/types/user.ts`（`departmentId?: string`）
- Modify: `packages/db/src/repositories/pg-user-repo.ts`
- Test: `packages/db/src/__tests__/pg-user-repo.test.ts`（若无则新建）

- [ ] `USER_COLUMNS` 改为 `u.id,...,u.department_id,d.name AS department`；所有查询 `FROM users u LEFT JOIN departments d ON d.id = u.department_id`。
- [ ] `findDeptApprovers` / `findByRole` 用 `d.name = $n`。
- [ ] `mapUser` 输出 `departmentId`。
- [ ] 更新受影响的 db/api 测试 SQL 断言。
- [ ] 提交 `refactor(db): read user department via departments join`.

### Task 4: 统计谓词与统计路由

**Files:**
- Modify: `packages/core/src/services/statistics.ts`
- Modify: `packages/api/src/routes/statistics.ts`
- Test: `packages/core/src/services/__tests__/statistics.test.ts`

- [ ] 谓词改为 `u.department_id = (SELECT id FROM departments WHERE name = $n)`。
- [ ] 部门聚合与导出改为 `d.name`（join `departments`）。
- [ ] 更新 core/api/mcp 统计测试断言。
- [ ] 提交 `refactor(statistics): resolve department by id`.

### Task 5: API 部门 CRUD

**Files:**
- Modify: `packages/api/src/routes/admin.ts`
- Test: `packages/api/src/__tests__/admin-departments.test.ts`

- [ ] 实现四个接口与错误码（含 `DEPARTMENT_EXISTS/PROTECTED/IN_USE`、`UNKNOWN_DEPARTMENT`）。
- [ ] 用户创建/更新支持 `departmentId`/`department`；列表 join 名称并返回 `departmentId`。
- [ ] `mapUserRow` 增加 `departmentId`。
- [ ] 提交 `feat(api): implement department CRUD`.

### Task 6: 审批/报销/快照/登录

**Files:**
- Modify: `packages/api/src/routes/approvals.ts`
- Modify: `packages/api/src/routes/expenses.ts`
- Modify: `packages/db/src/repositories/pg-report-snapshot-repo.ts`
- Modify: `packages/api/src/routes/auth.ts`
- Test: 对应 `__tests__` SQL 断言

- [ ] `u.department` → join `d.name`；报销范围用名称子查询。
- [ ] `api-key-login` 删除 `keyRow.department` 回退，SQL 去掉该列。
- [ ] 提交 `refactor(api): resolve departments through join`.

### Task 7: SCIM/MDM

**Files:**
- Modify: `packages/api/src/services/identity-bridge.ts`
- Modify: `packages/api/src/services/identity-audit.ts`（新增 `department.auto_create`）
- Test: `packages/api/src/services/__tests__/identity-bridge.test.ts`

- [ ] 写库前 `resolveOrCreate(department)`；空名落“未分配”；新部门写审计事件。
- [ ] 更新 INSERT/UPDATE 语句使用 `department_id`。
- [ ] 提交 `feat(api): auto-create departments for identity sync`.

### Task 8: MCP

**Files:**
- Modify: `packages/mcp/src/auth.ts`
- Modify: `packages/mcp/src/tools/{get-statistics,query-expense-status,search-expenses,get-user-summary,get-expense-detail,get-approval-status,explain-decision}.ts`
- Test: `packages/mcp/src/__tests__/*`

- [ ] key 刷新 join 部门取名称。
- [ ] `u.department` 过滤改为 `d.name` 或名称子查询；部门聚合用 `d.name`。
- [ ] 更新 SQL 断言。
- [ ] 提交 `refactor(mcp): resolve departments through join`.

### Task 9: 前端

**Files:**
- Modify: `packages/web/src/pages/AdminDepartments.vue`
- Modify: `packages/web/src/pages/AdminUsers.vue`
- Test: `packages/web/src/pages/__tests__/AdminDepartments.test.ts`、`AdminUsers.test.ts`

- [ ] 部门页 id 驱动 CRUD，受保护/占用禁用并提示。
- [ ] 用户页部门下拉来自 API，使用 `departmentId`。
- [ ] 提交 `feat(web): wire department management`.

### Task 10: 验证与文档

- [ ] `pnpm -r test` 全绿；`pnpm -r build` 11/11。
- [ ] 写 `docs/testing/departments.tdd.md` 与过程记录。
- [ ] 提交 `docs: record P1-9 departments`.

## 自审

- 覆盖设计第 3-7 节；无占位；类型统一使用 `departmentId`/`department`/`userCount`/`isProtected`。
