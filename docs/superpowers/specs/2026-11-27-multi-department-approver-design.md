# 多部门审批人 + 管理员兼任 设计

> 需求：一个用户账号可以同时是多个部门的审批人，并可与管理员身份兼得。
>
> 分支：`feat/multi-department-approver`（基线 `master@2742986`，不在 master 上开发）
> 状态：设计已确认，待实现
> 关联：`docs/2026-07-28-fallback-approval-design.md`、`docs/superpowers/specs/2026-11-22-p1-9-departments-design.md`

## 1. 背景与现状

当前身份模型是"单角色 + 单部门"，无法表达"一人覆盖多部门"或"管理员兼部门审批人"：

| 现状 | 证据 |
|---|---|
| `users.role` 单值（employee/dept_approver/finance/admin） | `packages/db/src/migrations/001_initial.sql` users 表；`packages/shared/src/enums/user-role.ts` |
| `users.department_id` 单值 | `packages/db/src/migrations/025_departments.sql` |
| JWT 只带 `role` + `department`（名称），2h | `packages/auth/src/jwt.ts:7-24` |
| 审批步骤解析：按申请人部门找 `role='dept_approver'`，按姓名取第一个 | `packages/core/src/services/approval-engine.ts:40-84`；`packages/db/src/repositories/pg-user-repo.ts:65-91` |
| 待审批列表按 JWT 单部门过滤 | `packages/api/src/routes/approvals.ts:34-105` |
| 审批授权：`role===dept_approver && ownerDept===JWT.department` | `packages/api/src/routes/approvals.ts:118-133` |
| 数据范围按单部门 | `packages/auth/src/rbac.ts:51-91`；`statistics.ts:24-35`；`expenses.ts:124-135`；`ontology/src/graph-scope.ts:52-70` |
| 前端导航/守卫只认角色字符串 | `packages/web/src/permissions.ts:10-11`；`packages/web/src/stores/auth.ts` |
| 权限矩阵 `finance.canApprove=false`，但财务步骤实际可批 | `packages/auth/src/rbac.ts:21-33` vs `approvals.ts` |

## 2. 已确认决策

| # | 决策 |
|---|---|
| D1 | 一人可被指派为**多个部门**的审批人；**同一部门只允许一个**审批人；同部门多人任一审批（any-of）不做；转单/委托本期不做，仅预留字段 |
| D2 | 被指派为某部门审批人 ⇒ **授予该部门数据查看范围**（报销列表 / 统计 / 本体） |
| D3 | 某部门没有审批人 ⇒ **兜底到管理员**；全局管理员不自动指派进部门 |
| D4 | 支持"某人同时是多部门审批人 + 管理员"的组合；管理员本身是全局审批人，无需逐部门指派 |
| D5 | 指派变更**立即生效**：审批资格与数据范围按请求实时解析，不以 JWT 旧信息为准 |
| D6 | `finance` 的审批能力纳入统一"能力模型"（可批财务步骤即 `canApprove=true`），消除双真源 |
| D7 | 历史同部门多审批人冲突：**保留最早创建者**，其余降级为普通用户 |
| D8 | 无审批人兜底对象：**最早创建的 active 管理员**；不自动把管理员写进 `department_approvers` |

## 3. 核心模型：能力 = 主角色 + 审批指派

```
用户能力 = 主角色能力(role) ∪ 部门审批人能力(department_approvers) 
```

- `users.role` 保留为主角色（employee / finance / admin），继续决定管理、导出、打款等能力。
- `role='dept_approver'` 作为**兼容值**保留，但**审批资格不再由它单独决定**；资格由指派表 + admin 决定。
- `users.department_id` 仍是用户**所属部门**（用于本人报销、个人资料），与"审批哪些部门"无关。
- 有效能力（建议在登录/profile 返回）：

```ts
type Capabilities = {
  canSubmit: boolean;
  canApproveDepartment: boolean;   // admin || 有审批指派
  canApproveFinanceStep: boolean;  // finance || admin
  canFinalize: boolean;            // finance || admin
  canExport: boolean;              // finance || admin
  canManageUsers: boolean;         // admin
  canManageRules: boolean;         // admin
};
```

## 4. 数据模型与迁移 `027_department_approvers.sql`

```sql
CREATE TABLE IF NOT EXISTS department_approvers (
  department_id UUID PRIMARY KEY REFERENCES departments(id) ON DELETE CASCADE,
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  assigned_by   UUID REFERENCES users(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_department_approvers_user
  ON department_approvers(user_id);

-- 回填：现有 dept_approver 用户按其部门写入；同部门多人时保留最早创建者
INSERT INTO department_approvers (department_id, user_id)
SELECT DISTINCT ON (u.department_id) u.department_id, u.id
FROM users u
WHERE u.role = 'dept_approver' AND u.status = 'active'
ORDER BY u.department_id, u.created_at ASC, u.id ASC
ON CONFLICT (department_id) DO NOTHING;
```

- `PRIMARY KEY(department_id)` 直接强制"一部门一审批人"。
- `assigned_by/updated_at` 为将来"转单"预留（本期不实现）。
- 迁移 forward-only。冲突（同部门多审批人）可用以下查询列出，其余用户降级为 employee（人工确认后执行）：

```sql
SELECT u.department_id, array_agg(u.id ORDER BY u.created_at) AS approver_ids
FROM users u
WHERE u.role = 'dept_approver' AND u.status = 'active'
GROUP BY u.department_id
HAVING COUNT(*) > 1;
```

## 5. 主体解析：立即生效（D5）

新增 API 层 `principalMiddleware`（`authMiddleware` 之后、路由之前）：

- 按 `userId` 实时查询：
  - `users.role`、`users.department_id`、`departments.name`
  - `department_approvers` 中该用户的所有 `department_id`
- 注入 `req.user.approverDepartmentIds`（并将 `req.user.department` 视为 `homeDepartment`）。
- JWT **保持不变**，只作身份凭证；审批资格和数据范围一律以本次查询为准。
- 单副本（`ONTOLOGY_V2=on` 约束）下可选进程内缓存，但审批指派写操作必须主动失效；首版建议**每请求直查**（小团队数据量小，保证"立即生效"）。

> 注意：hexagonal 约束下 `@sse/auth` 不依赖 `@sse/db`。`principalMiddleware` 放在 `packages/api/src/middleware/`，通过 `PgUserRepo`/新增仓储读取，再把结果挂到 `req.user`。

## 6. 数据范围（D2）

扩展 `DataScope`：

```ts
type DataScope =
  | { kind: 'all' }                                   // admin / finance
  | { kind: 'departments'; departmentIds: string[] }  // 多部门审批人（并集）
  | { kind: 'self'; userId: string }
  | { kind: 'deny' };
```

改造点：

| 层 | 文件 | 改造 |
|---|---|---|
| auth | `auth/src/rbac.ts` | `resolveDataScope`/`canViewReport` 接受 `approverDepartmentIds`；union 语义；无任何范围 fail-closed |
| core | `core/src/services/statistics.ts` | `departments` scope → `u.department_id = ANY($n)` |
| api | `statistics.ts` | 聚合与导出的部门过滤改为 id 集合 |
| api | `expenses.ts` | 列表与 `assertReportAccess`：本人 / admin / finance / 被指派部门 / 该单据存在本人 pending 审批 |
| api | `ontology.ts`、`ontology-v2.ts` | 传给 graph scope 的多部门集合 |
| ontology | `ontology/src/graph-scope.ts` | `dept_approver` 分支支持多部门并集 |
| mcp | `auth.ts` + `search-expenses`/`get-statistics`/`query-expense-status`/`get-expense-detail`/`get-approval-status`/`list-pending-approvals` | 复用新的 scope 与能力判断 |

## 7. 审批解析、路由与兜底（D1/D3/D4）

### 7.1 指派解析

`ApprovalEngine.resolveStepAssignee`（及 `resolveApprovers`/`resolveNextAssignee`）：

- 步骤含 `assigneeId` → 该用户；
- 步骤 `role='dept_approver'` → 按**申请人部门 id** 查 `department_approvers` 的唯一 `user_id`；
- 查不到 → 取"最早创建的 active 管理员"（`ORDER BY created_at, id LIMIT 1`）；
- 仍查不到 → `NoApproverError`（fail-closed）。

> 一部门一审批人 ⇒ 引擎不再需要 `findByRole(...)[0]` 的隐式选择；`ORDER BY name` 的歧义消失。
> 若申请人部门是受保护的"未分配"，同样走管理员兜底。

### 7.2 待办与授权

- `GET /approvals/pending`
  - admin：全量（现状不变）；
  - finance：`approver_id = 当前用户`（财务步骤指派）；
  - 部门审批人：`approver_id = 当前用户`（覆盖其所有被指派部门），移除"按 JWT 单部门过滤"。
- `POST /approvals/:id/approve|reject`
  - 授权：`pendingRecord.approverId === userId || role === admin`；
  - 移除 `role===dept_approver && ownerDept===JWT.department` 的二次校验（指派在生成记录时已固化）。
- 在途记录策略：指派变更只影响**新提交**；已生成的 pending 记录保留原 `approver_id`（转单本期不做，管理员仍可兜底处理）。

### 7.3 兜底规则与管理员兜底的关系

- **规则级兜底**：无金额/类别匹配时走兜底审批规则（依赖优先级修复）。
- **人员级兜底**：部门无审批人时指派到管理员（本设计新增）。
- 两者独立，避免把"找不到审批人"错误地当作"无规则匹配"。

## 8. API

### 8.1 管理端用户接口

- `POST /admin/users`、`PUT /admin/users/:id` 增加 `approverDepartmentIds: string[]`：
  - 事务内 upsert `department_approvers`；
  - 每个部门只能有一人：冲突返回 `409 APPROVER_ALREADY_ASSIGNED`（附当前审批人）；
  - 未知部门 `400 UNKNOWN_DEPARTMENT`。
- `GET /admin/users`、`GET /admin/users/:id` 返回：
  ```json
  { "role": "admin", "department": "总公司",
    "approverDepartments": [{ "id": "...", "name": "技术部" }] }
  ```
- 新增只读 `GET /admin/departments/approvers`（部门 → 审批人）供管理页展示；或在部门列表中附带 `approver` 字段。

### 8.2 认证接口

- `POST /auth/login`、`POST /auth/api-key-login`、`POST /auth/refresh`、`GET /auth/profile` 返回：
  - `role`、`department`（所属部门）、`approverDepartments`
  - `capabilities`（见 §3）

## 9. 前端

- `AdminUsers.vue`：
  - 用户弹窗新增"兼任审批部门"多选（`approverDepartmentIds`）；
  - 列表用标签展示兼任部门；
  - 已被占用的部门在选项中标注当前审批人。
- `stores/auth.ts`：`UserInfo` 增加 `approverDepartments`、`capabilities`。
- `permissions.ts`：导航与路由守卫从"角色"改为"能力"：
  - `/approvals` 放行条件 `canApproveDepartment || canApproveFinanceStep`；
  - `/admin/**` 保持 `canManageUsers`（admin）；
  - 保留角色回退，避免旧会话（无 capabilities）直接崩溃。
- 登录后及路由切换时刷新 `/auth/profile`，保证指派变更后前端"立即生效"（服务端始终是权威）。

## 10. 本体 / MCP / 外部同步

- **Ontology（本期）**：投影新增"审批人-部门"关系（`sse:approverOf`），`graph-scope` 支持多部门并集；`department_approvers` 加入 outbox 触发器数组（参照 `016_ontology_outbox.sql`）。
- **MCP**：读工具复用新 scope；`list_pending_approvals` 去掉"dept_approver 只匹配 userId"的旧特判，统一按 pending 记录归属 + admin。
- **SCIM/MDM**：审批指派**不同步**（本地管理）；保持 admin 不可外部创建（`identity-role-policy.ts`）。

## 11. 审计

- `user.approver_departments.update`：记录 `userId`、before/after 部门集合、操作者。
- 部门删除导致的级联清理记录 `department.approver_removed`。
- 复用 `recordAuditEvent`（best-effort）与 `audit_events` append-only。

## 12. 测试与验收

| 层 | 用例 |
|---|---|
| migration | `migration-027.test.ts`：建表、PK、回填、按部门唯一、FK 级联 |
| db | `pg-approver-repo.test.ts`：按部门取审批人、按用户取部门、upsert/冲突 |
| core | `approval-engine.test.ts`：多部门指派、部门无审批人→管理员、无管理员→NO_APPROVER |
| auth | `rbac` 多部门 scope、fail-closed、能力矩阵（含 finance） |
| api | 提交路由到正确审批人；A/B 两部门均出现在待办；非指派 403；指派变更后**同一 token 立即生效**；管理员兜底 |
| web | `AdminUsers` 多选与冲突提示；导航按能力显示 `/approvals` |
| 闸门 | `pnpm -r test` 全绿；`pnpm -r build` 11/11 |

## 13. 上线与回滚

1. 先修审批规则优先级（兜底取最大值），否则多部门路由不会生效。
2. 迁移 `027`（单 API 副本，先停 API → migrate → 启动）。
3. 旧 JWT 无需强制重登：审批资格实时查询；前端 capabilities 在下次 `/auth/profile` 刷新后更新。
4. 回滚：代码回退到基于 `role` 的旧路径；`department_approvers` 表保留不影响旧逻辑（旧代码不读）。不自动删表。

## 14. 非目标与已知缺口

- 同部门多人任一审批（any-of）；
- 转单/委托（schema 已预留 `assigned_by/updated_at`）；
- 任意角色自由叠加的全面重构（仅把 finance 纳入能力模型）；
- SCIM/MDM 同步审批指派；
- 指派变更后自动重分配已生成的 pending 记录（在途保持不变）。

## 15. 风险与前置依赖

1. **审批规则优先级缺陷（前置）**：`matchRule` 升序取最小（`approval-engine.ts:36`、`pg-approval-rule-repo.ts:21`）。若兜底规则仍为 `priority=1`，会命中全部并被优先选中，多部门指派形同虚设。兜底应为最大值（设计文档建议 9999）。
2. **数据范围放大（已确认，风险受控）**：审批指派即授予部门数据查看；需保证 update 权限仅 admin、且所有查询走统一 scope。
3. **单副本**：principal 直查/缓存只在单 API 副本成立；多副本前需共享失效机制。
4. **在途记录**：指派变更不回溯、不转单，需在管理员操作提示中说明。

## 16. 实施拆分（待评审后细化）

1. 迁移 + 仓储 + 回填（行为不变）。
2. principal 解析 + DataScope 多部门 + 引擎指派/兜底 + 审批路由授权。
3. 管理端 API + `AdminUsers` 多选 + 能力驱动导航。
4. 统计/报销列表/本体/MCP scope 对齐。
5. Ontology 投影（审批人-部门关系）与 outbox。
