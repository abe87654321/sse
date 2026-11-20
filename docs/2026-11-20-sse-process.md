# SSE 开发过程记录（2026-11-20）

> 本次会话按 `docs/2026-11-12-sse-multi-role-analysis.md` 优先级清单顺序推进：
> P0 第 1 项（审批人匹配补修）、P0 第 2 项（删除审计证据）、P0 第 3 项（SCIM/MDM 加固）、
> P0 第 4 项（通用审计事件表）。
> 重要约束：**级联删除功能必须保留**（用户明确要求），未移除、未禁用。

---

## 零、P0 第 1 项补修：审批人匹配（2026-11-20）

> 复核发现 `741375b` 只改了 approve/reject 的 `userId` 比较，并未真正完成 P0 第 1 项。

### 复核发现的残留问题

1. `ApprovalEngine.startApproval/createNextStep` 仍回退写入角色名：
   `approverId: firstStep.assigneeId || firstStep.role || ''`。
   默认审批规则是 `role` 型步骤，`approval_records.approver_id` 是 `UUID NOT NULL`，
   这会导致建单提交失败或写入非 UUID 数据。
2. `GET /approvals/pending` 对 finance/dept_approver 仍用 `ar.approver_id = role` 过滤，
   记录改为真实 userId 后审批列表为空。
3. `GET /expenses/:id` 的 `viewerActions` 仍用 `approverId === role` 判断，
   非管理员审批人看不到「通过/驳回」按钮。

### 修复

- `ApprovalEngine` 新增 `resolveStepAssignee` / `resolveNextAssignee`：
  - `assigneeId` 直接解析为真实用户；
  - `dept_approver` 按申请人部门查人；
  - `finance` / `admin` 不再错误地按申请人部门过滤；
  - 找不到审批人抛 `NoApproverError`，绝不回退写角色名。
- `startApproval` / `createNextStep` 必须拿到真实 userId 才写记录。
- 提交审批：先解析第一审批人，失败返回 `400 NO_APPROVER`。
- 审批通过：先预检下一审批人，再记录当前审批；避免当前步骤已通过但下一审批人缺失导致流程卡死。
- `GET /approvals/pending` 改为按 `userId` 匹配，并保留 `role` 作为历史数据兼容条件。
- `viewerActions` 改为 `approverId === userId || approverId === role`（兼容历史数据）。
- `PgUserRepo.findByRole` 增加 `ORDER BY name`，多审批人时分配结果确定。

### 验证

```
pnpm --filter @sse/core test  -> 53 tests passed（engine 6 个）
pnpm --filter @sse/api test   -> 166 tests passed（新增 approvals-pending 2 个）
pnpm --filter @sse/core build -> 通过
pnpm --filter @sse/db build   -> 通过
pnpm --filter @sse/api build  -> 通过
```

新增测试：`approvals-pending.test.ts`；`approval-engine.test.ts` 增加 3 个审批人解析用例。


---

## 一、P0 第 2 项：禁止物理删除已通过/已付款单据及审批记录

### 清单原文

> 禁止物理删除已通过/已付款单据及审批记录；用户删除改为停用/匿名化，保留业务与审计数据
> （`expenses.ts:827`、`pg-user-repo.ts:99`）

### 落地方式

- **报销单删除**：`DELETE /expenses/:id` 只允许删除「草稿且没有任何审批/付款审计记录」的单据。
  已提交、已通过、已驳回、已付款单据一律返回 `409 REPORT_LOCKED`，提示保留审计证据。
- **数据库守卫**：迁移 `021_guard_report_deletion.sql` 增加 `BEFORE DELETE` 触发器，
  即使绕过 API 直接 SQL 删除，非草稿单据也会被拒绝；`approval_records.report_id`
  外键由 `ON DELETE CASCADE` 改为 `ON DELETE RESTRICT`。
- **级联删除保留**：按用户要求，`DELETE /admin/users/:id?type=cascade` 与
  `PgUserRepo.cascadeDelete` 原样保留。级联删除在事务内显式设置
  `SET LOCAL sse.allow_destructive_delete = 'on'`，触发器仅对该显式销毁操作放行。
- **硬删除/软删除**：保持现状；硬删除仍只允许无业务数据的用户。

### 未包含（留待后续）

- 用户级联删除仍是显式破坏性操作，会删除其报销单及关联审计；这是按用户要求保留的能力。
- 未实现报销单「作废」状态；当前策略是锁定而非作废。

### 代码变更

| 文件 | 变更 |
|---|---|
| `packages/core/src/services/report-deletion.ts`（新增） | `evaluateReportDeletion`：仅草稿且无审计记录可删；非本人非管理员返回 `FORBIDDEN` |
| `packages/api/src/routes/expenses.ts` | `DELETE /expenses/:id` 改用删除策略；查询审批/付款审计记录；`viewerActions.canDelete` 仅草稿可见 |
| `packages/db/src/migrations/021_guard_report_deletion.sql`（新增） | 删除守卫触发器 + `approval_records` 外键改 `RESTRICT` + 级联显式放行 GUC |
| `packages/db/src/repositories/pg-user-repo.ts` | `cascadeDelete` 在 `BEGIN` 后设置 `sse.allow_destructive_delete=on` |
| `packages/core/src/services/__tests__/report-deletion.test.ts`（新增） | 9 个策略用例 |
| `packages/db/src/__tests__/migration-021.test.ts`（新增） | 4 个迁移守卫用例 |
| `packages/db/src/__tests__/pg-user-repo-cascade.test.ts`（新增） | 验证级联删除仍会执行且带显式销毁标记 |

### 验证

```
pnpm --filter @sse/core test  -> 6 suites / 50 tests passed
pnpm --filter @sse/db test    -> 7 suites / 26 tests passed（当时）
pnpm --filter @sse/api test   -> 13 suites / 123 tests passed（当时）
pnpm -r build                 -> 11 个包全部完成
```

---

## 二、P0 第 3 项：SCIM/MDM 身份同步加固

### 1. 角色白名单与来源映射

- 新增 `packages/api/src/services/identity-role-policy.ts`：
  - 新用户默认 `employee`；
  - 角色必须属于已知角色（`employee/dept_approver/finance/admin`）；
  - **`admin` 永远不允许由外部同步创建或提升**，即使白名单/映射配置错误；
  - 白名单：`SCIM_ALLOWED_ROLES`、`MDM_ALLOWED_ROLES`（默认仅 `employee`）；
  - 映射：`SCIM_ROLE_MAP`、`MDM_ROLE_MAP`，格式 `externalRole=localRole,...`；
  - 已存在的特权本地用户（`dept_approver/finance/admin`）不会被外部同步降级。
- `identity-bridge.ts` 在写库前解析角色，拒绝时返回 400 `ROLE_NOT_ALLOWED` / `INVALID_ROLE`。
- MDM 增加用户字段与状态白名单校验（`active/inactive/disabled`）。

### 2. 请求签名与防重放

- 新增 `packages/api/src/middleware/service-signature.ts`：
  - 请求头 `X-Timestamp`（Unix 秒）与 `X-Signature`（HMAC-SHA256 hex）；
  - 签名串：`timestamp + "\n" + METHOD + "\n" + originalUrl + "\n" + rawBody`；
  - 时间窗默认 300 秒，可用 `SERVICE_SIGNATURE_TOLERANCE_SECONDS` 调整；
  - 同一签名在时间窗内重复出现返回 401 `REPLAY_DETECTED`；
  - 密钥：`SCIM_SIGNING_SECRET`、`MDM_SIGNING_SECRET`/`WEBHOOK_SIGNING_SECRET`；
  - 生产环境未配置签名密钥返回 503 `SIGNING_SECRET_NOT_CONFIGURED`；非生产跳过并告警。
- `index.ts` 的 `express.json` 增加 `captureRawBody`，SCIM/MDM 路由在服务令牌之后再校验签名。
- 注意：启用签名后，现有 SCIM/MDM 客户端必须发送两个新请求头；这是有意的破坏性安全升级。
- 防重放缓存是进程内内存；依赖现有「单 API 副本」约束。多副本前需改为 Redis/DB。

### 3. 审计日志

- 新增 `packages/api/src/services/identity-audit.ts`，每次同步/拒绝/认证失败输出一条 stderr JSON：
  `[identity-audit] {"ts","source","action","outcome","externalId","localUserId","role","reason","ip"}`。
- 覆盖：SCIM/MDM 创建、更新、禁用、角色拒绝、令牌失败、签名失败、重放。
- 不记录请求体、手机号、密钥。P0 第 4 项已将其同时持久化到 `audit_events`。

### 验证

```
pnpm --filter @sse/api test  -> 16 suites / 141 tests passed（当时）
pnpm --filter @sse/api build -> 通过
```

新增测试：`identity-role-policy.test.ts`（7 个）、`identity-bridge.test.ts`（4 个）、
`service-signature.test.ts`（7 个）。

### 部署要求

```bash
# 生产必须配置（值不要提交到 git）
SCIM_TOKEN=...
MDM_TOKEN=...
SCIM_SIGNING_SECRET=...
MDM_SIGNING_SECRET=...          # 或 WEBHOOK_SIGNING_SECRET
SCIM_ALLOWED_ROLES=employee
MDM_ALLOWED_ROLES=employee
# 可选
SCIM_ROLE_MAP=staff=employee,manager=dept_approver
SERVICE_SIGNATURE_TOLERANCE_SECONDS=300
```

升级后先验证：无签名请求 401；带正确签名请求 200；`role=admin` 请求 400；
`[identity-audit]` 有对应记录。

---

## 三、P0 第 4 项：append-only 通用审计事件表

### 1. 数据库

迁移 `packages/db/src/migrations/022_audit_events.sql`：

- 新增 `audit_events`：`occurred_at`、`actor_type/actor_id/actor_role`、`source`、`action`、
  `entity_type/entity_id`、`outcome`、`ip`、`request_id`、`details JSONB`。
- 不设置任何外键，用户/单据删除后审计记录仍可保留。
- 索引：时间、source+时间、action+时间、actor+时间、实体。
- `BEFORE UPDATE OR DELETE` 触发器 `trg_audit_events_append_only` 抛错，禁止修改/删除。
- 说明：触发器防的是应用/普通 SQL 篡改；表 owner 仍可临时禁用触发器，
  且当前没有哈希链/WORM/保留策略，这些属于后续合规增强。

### 2. 写入与查询

- `packages/db/src/repositories/pg-audit-repo.ts`（新增）：
  - `insert`：参数化写入，`details` 转 JSONB；
  - `query`：source/action/actor/entity/outcome/from/to 过滤，`occurred_at DESC, id DESC`，
    limit 默认 50、最大 200，返回 `{ items, total }`。
- `packages/api/src/services/audit.ts`（新增）：
  - `recordAuditEvent`：**best-effort**，写库失败只写 stderr，不阻塞业务；
  - `sanitizeAuditDetails`：递归屏蔽 password/secret/token/authorization/apiKey/credential，
    超过 8KB 直接丢弃为 `{ truncated: true }`；
  - `auditFromRequest`：从 `req.user`、`req.ip`、`X-Request-Id` 填充上下文；
  - `attachRequestId`：生成/透传 `X-Request-Id`；
  - `auditMutations`：全局挂载，记录所有写请求（POST/PUT/PATCH/DELETE），
    自动映射 `expense.create`、`user.update`、`approval.approve`、`ai_config.test` 等动作；
    只记录 role/status/deleteType 等非敏感字段，不记录请求体。
- 管理端只读查询：`GET /admin/audit-events`（admin-only），支持过滤与分页。
- 开关：`AUDIT_EVENTS=0` 可整体关闭审计写入（默认开启）；仅用于测试/紧急排障。

### 3. 已覆盖的事件来源

| 类别 | 事件 |
|---|---|
| 登录 | `login.success`、`login.failure`（reason：unknown_user/bad_password/disabled/rate_limited 等）、`api_key.login.*` |
| 增删改 | 全局写请求审计：`expense.*`、`approval.approve/reject`、`payment.*`、`user.*`、`approval_rule.*`、`reasoning_rule.*`、`broadcast.*` |
| 配置 | `ai_config.update/test`、规则增删改、用户角色/状态变更 |
| 导出 | `statistics.export`（format/日期范围/行数） |
| 下载 | `invoice.download`、`payment_receipt.download` |
| 身份同步 | `[identity-audit]` 同步写入 `audit_events`：创建/更新/禁用/角色拒绝/认证失败 |
| MCP 调用 | `mcp.tool_call`：工具、用户、角色、耗时、错误码、结果数、超时 |

### 4. 测试

```
pnpm -r test  -> 679 tests passed
  api 166、db 32、mcp 56、web 37、core 53、ai 100、auth 30、notifications 29、ontology 176
pnpm -r build -> 11 个包全部完成
```

新增测试：

- `packages/db/src/__tests__/migration-022.test.ts`（4 个）
- `packages/db/src/__tests__/pg-audit-repo.test.ts`（2 个）
- `packages/api/src/services/__tests__/audit.test.ts`（20 个）
- `packages/api/src/__tests__/audit-route.test.ts`（3 个）

### 5. 部署与验证

```bash
pnpm --filter @sse/db migrate

# 管理员查询（按需替换 token/过滤条件）
curl -s -H "Authorization: Bearer $TOKEN" \
  "http://127.0.0.1:3000/admin/audit-events?limit=20&action=login.failure"
```

验证要点：

1. 登录成功/失败、`PUT /auth/password`、管理员改角色后能查到事件；
2. 报销单创建/审批/付款、AI 配置保存、规则增删改能查到事件；
3. `GET /statistics/export` 与发票/回单下载能查到事件；
4. SCIM/MDM 同步成功与角色拒绝各有一条 `audit_events`；
5. MCP 工具调用后能查到 `mcp.tool_call`；
6. 直接 `UPDATE`/`DELETE audit_events` 被触发器拒绝。

---

## 四、清单进度

| 优先级 | 项 | 状态 |
|---|---|---|
| P0-1 | 修复审批人匹配 | 已完成（`741375b` 仅部分；本次补修完成） |
| P0-2 | 禁止物理删除已通过/已付款单据及审批记录 | 已完成（级联删除按用户要求保留） |
| P0-3 | SCIM/MDM 角色白名单、来源映射、请求签名与审计 | 已完成 |
| P0-4 | 建立 append-only 通用审计事件表 | 已完成 |
| P1-5 | 报销单内容不可变快照 | 下一次会话 |

---

## 五、下一次会话

1. 在测试机应用迁移 `021`、`022`，按第三节验证清单复测。
2. 为生产配置 SCIM/MDM 签名密钥与角色白名单（见第二节部署要求）。
3. 开始 P1 第 5 项：报销单内容快照（提交、每步审批、付款时保存不可变 JSON）。
4. 注意：本次改动尚未提交 git；提交前检查 `git status`，不要把 `.env` 或密钥带入提交。
