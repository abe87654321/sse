# P1-9 部门管理（真实 CRUD + 正规化）设计

> 对应 `docs/2026-11-12-sse-multi-role-analysis.md` P1 第 9 项：
> “实现真实部门 CRUD，或移除无效入口。”
>
> 分支：`feat/p1-9-departments`；基线 `e66c674`。

## 1. 背景与现状

- `users.department` 是自由文本（`001_initial.sql:11`），没有部门表。
- `GET /admin/departments` 从 `users.department` 聚合（`admin.ts:452`）。
- `POST /admin/departments` 只查重后直接返回，不落库（`admin.ts:461`）。
- `DELETE /admin/departments/:name` 路由不存在，前端调用必然 404（`AdminDepartments.vue:87`）。
- `AdminUsers.vue:260` 硬编码 7 个部门，与真实数据不一致。
- 部门名参与数据域：审批（`approvals.ts:74`）、报销访问（`expenses.ts:71`）、统计（`statistics.ts`）、MCP（8 处 SQL）、本体同步。

## 2. 决策

| 决策 | 结论 |
|---|---|
| 部门真源 | 新建 `departments(id, name UNIQUE, is_protected)`；`users.department_id` 为唯一关联；删除 `users.department` |
| 应用层契约 | 仍以“部门名”作为主要入参/展示字段；SQL 通过 `departments` join 或名称子查询解析，尽量不改 core/MCP 契约 |
| 受保护部门 | 迁移创建 `未分配`（`is_protected=true`），禁止重命名/删除；历史空值归入它 |
| 外部同步未知部门 | SCIM/MDM 自动创建部门（审核事件 `department.auto_create`） |
| 管理端未知部门 | 返回 `400 UNKNOWN_DEPARTMENT`，不自动建（保持名册可控） |
| `mcp_api_keys.department` | 删除。`api-key-login` 的用户行是唯一真源，该字段只用于死回退分支 |
| JWT | 结构不变（仍带部门名）。重命名后旧 token 对 `dept_approver` fail-closed |
| Ontology | 部门 CRUD 不推送本体；用户编辑仍按部门名同步（已知缺口） |

## 3. 迁移 `025_departments.sql`

```sql
CREATE TABLE IF NOT EXISTS departments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  is_protected BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO departments (name, is_protected) VALUES ('未分配', true)
  ON CONFLICT (name) DO NOTHING;

INSERT INTO departments (name)
  SELECT DISTINCT TRIM(department) FROM users
  WHERE department IS NOT NULL AND TRIM(department) <> ''
  ON CONFLICT (name) DO NOTHING;

ALTER TABLE users ADD COLUMN department_id UUID;
UPDATE users u SET department_id = d.id
  FROM departments d WHERE d.name = TRIM(u.department);
UPDATE users SET department_id = (SELECT id FROM departments WHERE name = '未分配')
  WHERE department_id IS NULL;
ALTER TABLE users ALTER COLUMN department_id SET NOT NULL;
ALTER TABLE users ADD CONSTRAINT fk_users_department
  FOREIGN KEY (department_id) REFERENCES departments(id) ON DELETE RESTRICT;
CREATE INDEX IF NOT EXISTS idx_users_department_id ON users(department_id);
ALTER TABLE users DROP COLUMN department;

ALTER TABLE mcp_api_keys DROP COLUMN department;

CREATE OR REPLACE FUNCTION sse_departments_protect() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' AND OLD.is_protected THEN
    RAISE EXCEPTION 'protected department cannot be deleted';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF OLD.is_protected THEN
      RAISE EXCEPTION 'protected department cannot be modified';
    END IF;
    IF NEW.is_protected IS DISTINCT FROM OLD.is_protected THEN
      RAISE EXCEPTION 'is_protected cannot be changed';
    END IF;
    NEW.updated_at := NOW();
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_departments_protect ON departments;
CREATE TRIGGER trg_departments_protect
  BEFORE UPDATE OR DELETE ON departments
  FOR EACH ROW EXECUTE FUNCTION sse_departments_protect();
```

迁移 forward-only，不提供自动回滚；回滚需手写反向迁移（先加回文本列并按 join 回填）。

## 4. 数据访问

新增 `packages/db/src/repositories/pg-department-repo.ts`：

```ts
export interface Department {
  id: string;
  name: string;
  userCount: number;
  isProtected: boolean;
}
```

- `list()`：`SELECT d.id, d.name, d.is_protected, COUNT(u.id)::int AS user_count FROM departments d LEFT JOIN users u ON u.department_id = d.id GROUP BY d.id ORDER BY d.name`
- `findById(id)` / `findByName(name)`
- `create(name)`、`rename(id, name)`、`delete(id)`
- `resolveOrCreate(name)`：`INSERT ... ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name RETURNING id`，空名落 `未分配`

读取改造（保持返回字段 `department` 为名称）：

| 文件 | 改造 |
|---|---|
| `pg-user-repo.ts` | `SELECT ${USER_COLUMNS}` → `u.*` + `d.name AS department`，`FROM users u LEFT JOIN departments d ON d.id = u.department_id`；`findDeptApprovers`/`findByRole` 用 `d.name = $` |
| `admin.ts` | 用户列表/创建/更新/`mapUserRow`；新增 `departmentId` |
| `approvals.ts` | 审批列表 join 部门取名称；`dept_approver` 过滤用 `d.name` |
| `expenses.ts` | `assertReportAccess` 与部门用户列表用 `u.department_id = (SELECT id FROM departments WHERE name = $1)` |
| `core/statistics.ts` | 谓词改为 `u.department_id = (SELECT id FROM departments WHERE name = $n)`（`needsUserJoin` 语义不变） |
| `statistics.ts` | 部门聚合 `d.name`；导出 join 部门 |
| `pg-report-snapshot-repo.ts` | 快照申请人部门 `d.name` |
| `auth.ts` | 登录/API key 登录由 `PgUserRepo` 返回名称；`keyRow.department` 回退移除 |
| `identity-bridge.ts` | 写库前 `resolveOrCreate(department)` 取 `department_id` |
| MCP `auth.ts` + 8 处工具 SQL | `u.department` → `d.name` 或名称子查询 |
| `services/audit.ts` | `entityTypeFor` 增加 `/admin/departments` → `department` |

## 5. API

| 方法 | 路径 | 行为 |
|---|---|---|
| GET | `/admin/departments` | `[{id,name,userCount,isProtected}]` |
| POST | `/admin/departments` | 201；空名/超长 400；重名 409 `DEPARTMENT_EXISTS` |
| PATCH | `/admin/departments/:id` | 404；受保护 409 `DEPARTMENT_PROTECTED`；重名 409 |
| DELETE | `/admin/departments/:id` | 404；受保护 409；有用户 409 `DEPARTMENT_IN_USE`；成功 204/200 |

用户接口：
- 创建：`departmentId` 优先；否则 `department` 名称解析；都没有 → 400。
- 更新：`departmentId` / `department` 都可，未知 → `400 UNKNOWN_DEPARTMENT`。
- 响应保留 `department` 名称，新增 `departmentId`。

## 6. 前端

- `AdminDepartments.vue`：id 驱动；新增、重命名（行内或弹窗）、删除；受保护/有人时禁用并说明原因；显示用户数与“系统保留”。
- `AdminUsers.vue`：挂载时拉取 `/admin/departments`；`form.departmentId`；移除硬编码数组；编辑时按 `departmentId` 回填；列表显示名称。

## 7. 测试与验收

- `migration-025.test.ts`：建表、回填、FK、删列、保护触发器。
- `pg-department-repo.test.ts`：list/create/rename/delete/resolveOrCreate 的 SQL 与参数。
- `admin-departments.test.ts`：7 条路由用例。
- `admin-users-departments.test.ts`：按 id/名称解析、未知 400。
- `identity-bridge` 自动建部门用例；`audit.test.ts` 分类用例。
- 更新 core/db/api/mcp 既有 SQL 断言（`u.department` → 新写法）。
- 前端 `AdminDepartments` / `AdminUsers` 用例。
- 闸门：`pnpm -r test` 全绿；`pnpm -r build` 11/11。
- 测试机：先停 API → `pnpm --filter @sse/db migrate` → 重启；4 角色冒烟（含重命名后 dept_approver 重新登录）。

## 8. 非目标与已知缺口

- 不做部门层级、成本中心、部门级审批规则。
- 重命名后已登录 `dept_approver` 需重新登录才能看到新部门数据（fail-closed）。

## 9. 第 2 阶段补充（已实施）

- **Ontology 同步**：新增/重命名/删除部门时同步 legacy OwlStore 与 v2 图谱；
  重命名迁移用户 `belongsTo` 与 `department` 属性并删除旧 Department 实体；同步为 best-effort。
- **v2 投影修正**：迁移 026 为 outbox 的 `users` 载荷补部门名称；`reconcile` join `departments`；
  `shadow` 使用 SQL 表达式解析部门名。
- **OwlStore 修复**：n3 v1 `removeMatches` 返回新 Store 而非原地删除，改为 `getQuads + removeQuad`；
  新增 `setProperty`。
- **重命名提示**：`PATCH /admin/departments/:id` 返回 `affectedUsers`，前端提示相关用户重新登录。
