# SSE 开发过程记录（2026-11-20�?
> 本次会话主题：按 `docs/2026-11-12-sse-multi-role-analysis.md` 优先级清单顺序，处理 P0 �?2 项—�?> 禁止物理删除已通过/已付款单据及审批记录，保留审计证据�?> 重要约束�?*级联删除功能必须保留**（用户明确要求），本次未移除、未禁用�?
---

## 一、本次范围与决策

### 清单�?2 项原�?
> 禁止物理删除已通过/已付款单据及审批记录；用户删除改为停�?匿名化，保留业务与审计数�?> （`expenses.ts:827`、`pg-user-repo.ts:99`�?
### 本次落地方式

- **报销单删�?*：`DELETE /expenses/:id` 只允许删除「草稿且没有任何审批/付款审计记录」的单据�?  已提交、已通过、已驳回、已付款单据一律返�?`409 REPORT_LOCKED`，提示保留审计证据�?- **数据库守�?*：迁�?`021_guard_report_deletion.sql` 增加 `BEFORE DELETE` 触发器，
  即使绕过 API 直接 SQL 删除，非草稿单据也会被拒绝；`approval_records.report_id`
  外键�?`ON DELETE CASCADE` 改为 `ON DELETE RESTRICT`，防止先删审计记录�?- **级联删除保留**：按用户要求，`DELETE /admin/users/:id?type=cascade` �?  `PgUserRepo.cascadeDelete` 原样保留。级联删除在事务内显式设�?  `SET LOCAL sse.allow_destructive_delete = 'on'`，触发器仅对该显式销毁操作放行�?  普通删除路径没有该标记，因此无法借级联之外的方式销毁审批证据�?- **硬删�?软删�?*：保持现状；硬删除仍只允许无业务数据的用户�?
### 未包含（留待后续�?
- 用户级联删除仍是显式破坏性操作，会删除其报销单及关联审计；这是本次按用户要求保留的能力，
  不是遗漏。后续如需“停�?匿名化”默认路径，应单独设计双人审批或 tombstone�?- 未实现报销单“作废”状态；当前策略是锁定而非作废�?- 未新增通用 `audit_events` 表（属于 P0 �?4 项）�?
---

## 二、代码变�?
| 文件 | 变更 |
|---|---|
| `packages/core/src/services/report-deletion.ts`（新增） | `evaluateReportDeletion`：仅草稿且无审计记录可删；非本人非管理员返回 `FORBIDDEN` |
| `packages/core/src/services/index.ts` | 导出删除策略 |
| `packages/api/src/routes/expenses.ts` | `DELETE /expenses/:id` 改用删除策略；查询审�?付款审计记录；`viewerActions.canDelete` 仅草稿可�?|
| `packages/db/src/migrations/021_guard_report_deletion.sql`（新增） | 删除守卫触发�?+ `approval_records` 外键�?`RESTRICT` + 级联显式放行 GUC |
| `packages/db/src/repositories/pg-user-repo.ts` | `cascadeDelete` �?`BEGIN` 后设�?`sse.allow_destructive_delete=on`，保持级联可�?|
| `packages/core/src/services/__tests__/report-deletion.test.ts`（新增） | 9 个策略用�?|
| `packages/db/src/__tests__/migration-021.test.ts`（新增） | 4 个迁移守卫用�?|
| `packages/db/src/__tests__/pg-user-repo-cascade.test.ts`（新增） | 验证级联删除仍会执行且带显式销毁标�?|

---

## 三、验证结�?
```
pnpm --filter @sse/core test  �?6 suites / 50 tests passed
pnpm --filter @sse/db test    �?7 suites / 26 tests passed
pnpm --filter @sse/api test   �?13 suites / 123 tests passed
pnpm -r build                 �?11 个包全部完成
```

未在测试机执行迁�?`021`，部署时需�?
```bash
pnpm --filter @sse/db migrate
```

---

## 四、清单进�?
| 优先�?| �?| 状�?|
|---|---|---|
| P0-1 | 修复审批人匹�?| 已完成（`741375b`�?|
| P0-2 | 禁止物理删除已通过/已付款单据及审批记录 | 已完成（级联删除按用户要求保留） |
| P0-3 | SCIM/MDM 角色白名单、来源映射、请求签名与审计 | 已完成（见第六节�?|
| P0-4 | 建立 append-only 通用审计事件�?| 下一次会�?|

---

## 五、下一次会�?
1. 在测试机应用迁移 `021`，用管理�?财务账号复测�?   - 草稿删除成功�?   - `pending/approved/rejected/paid` 删除返回 `409 REPORT_LOCKED`�?   - 测试机管理员级联删除仍可用（需明确这是破坏性操作）�?2. 生产/测试环境�?SCIM/MDM 配置签名密钥与角色白名单（见第六节），否则生产请求返�?503�?3. 开�?P0 �?4 项：`audit_events` 通用审计事件表（�?`[identity-audit]` 等事件持久化）�?4. 注意：本次改动尚未提�?git；提交前检�?`git status`，不要把 `.env` 或密钥带入提交�?
---

## 六、P0 �?3 项：SCIM/MDM 身份同步加固�?026-11-20�?
### 1. 角色白名单与来源映射

- 新增 `packages/api/src/services/identity-role-policy.ts`�?  - 新用户默�?`employee`�?  - 角色必须属于已知角色（`employee/dept_approver/finance/admin`）；
  - **`admin` 永远不允许由外部同步创建或提�?*，即使白名单/映射配置错误�?  - 白名单：`SCIM_ALLOWED_ROLES`、`MDM_ALLOWED_ROLES`（默认仅 `employee`）；
  - 映射：`SCIM_ROLE_MAP`、`MDM_ROLE_MAP`，格�?`externalRole=localRole,...`�?  - 已存在的特权本地用户（`dept_approver/finance/admin`）不会被外部同步降级�?- `identity-bridge.ts` 在写库前解析角色，拒绝时返回 400 `ROLE_NOT_ALLOWED` / `INVALID_ROLE`�?- MDM 增加用户字段与状态白名单校验（`active/inactive/disabled`）�?
### 2. 请求签名与防重放

- 新增 `packages/api/src/middleware/service-signature.ts`�?  - 请求�?`X-Timestamp`（Unix 秒）�?`X-Signature`（HMAC-SHA256 hex）；
  - 签名串：`timestamp + "\n" + METHOD + "\n" + originalUrl + "\n" + rawBody`�?  - 时间窗默�?300 秒，可用 `SERVICE_SIGNATURE_TOLERANCE_SECONDS` 调整�?  - 同一签名在时间窗内重复出现返�?401 `REPLAY_DETECTED`�?  - 密钥：`SCIM_SIGNING_SECRET`、`MDM_SIGNING_SECRET`/`WEBHOOK_SIGNING_SECRET`�?  - 生产环境未配置签名密钥返�?503 `SIGNING_SECRET_NOT_CONFIGURED`；非生产跳过并告警�?- `index.ts` �?`express.json` 增加 `captureRawBody`，SCIM/MDM 路由在服务令牌之后再校验签名�?- 注意：启用签名后，现�?SCIM/MDM 客户端必须发送两个新请求头；这是有意的破坏性安全升级�?- 防重放缓存是进程内内存；依赖现有「单 API 副本」约束。多副本前需改为 Redis/DB�?
### 3. 审计日志

- 新增 `packages/api/src/services/identity-audit.ts`，每次同�?拒绝/认证失败输出一�?stderr JSON�?  `[identity-audit] {"ts","source","action","outcome","externalId","localUserId","role","reason","ip"}`�?- 覆盖：SCIM/MDM 创建、更新、禁用、角色拒绝、令牌失败、签名失败、重放�?- 不记录请求体、手机号、密钥。持久化�?`audit_events` 属于 P0 �?4 项�?
### 4. 验证

```
pnpm --filter @sse/api test  �?16 suites / 141 tests passed
pnpm --filter @sse/api build �?通过
```

新增测试�?- `identity-role-policy.test.ts`�? 个）
- `identity-bridge.test.ts`�? 个）
- `service-signature.test.ts`�? 个）

### 5. 部署要求

```bash
# 生产必须配置（值不要提交到 git�?SCIM_TOKEN=...
MDM_TOKEN=...
SCIM_SIGNING_SECRET=...
MDM_SIGNING_SECRET=...          # �?WEBHOOK_SIGNING_SECRET
SCIM_ALLOWED_ROLES=employee
MDM_ALLOWED_ROLES=employee
# 可�?SCIM_ROLE_MAP=staff=employee,manager=dept_approver
SERVICE_SIGNATURE_TOLERANCE_SECONDS=300
```

升级后先验证：无签名请求 401；带正确签名请求 200；`role=admin` 请求 400；`[identity-audit]` 有对应记录�?
