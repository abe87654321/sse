# SSE 开发过程记录（2026-11-20）

> 本次会话主题：按 `docs/2026-11-12-sse-multi-role-analysis.md` 优先级清单顺序，处理 P0 第 2 项——
> 禁止物理删除已通过/已付款单据及审批记录，保留审计证据。
> 重要约束：**级联删除功能必须保留**（用户明确要求），本次未移除、未禁用。

---

## 一、本次范围与决策

### 清单第 2 项原文

> 禁止物理删除已通过/已付款单据及审批记录；用户删除改为停用/匿名化，保留业务与审计数据
> （`expenses.ts:827`、`pg-user-repo.ts:99`）

### 本次落地方式

- **报销单删除**：`DELETE /expenses/:id` 只允许删除「草稿且没有任何审批/付款审计记录」的单据。
  已提交、已通过、已驳回、已付款单据一律返回 `409 REPORT_LOCKED`，提示保留审计证据。
- **数据库守卫**：迁移 `021_guard_report_deletion.sql` 增加 `BEFORE DELETE` 触发器，
  即使绕过 API 直接 SQL 删除，非草稿单据也会被拒绝；`approval_records.report_id`
  外键由 `ON DELETE CASCADE` 改为 `ON DELETE RESTRICT`，防止先删审计记录。
- **级联删除保留**：按用户要求，`DELETE /admin/users/:id?type=cascade` 与
  `PgUserRepo.cascadeDelete` 原样保留。级联删除在事务内显式设置
  `SET LOCAL sse.allow_destructive_delete = 'on'`，触发器仅对该显式销毁操作放行。
  普通删除路径没有该标记，因此无法借级联之外的方式销毁审批证据。
- **硬删除/软删除**：保持现状；硬删除仍只允许无业务数据的用户。

### 未包含（留待后续）

- 用户级联删除仍是显式破坏性操作，会删除其报销单及关联审计；这是本次按用户要求保留的能力，
  不是遗漏。后续如需“停用/匿名化”默认路径，应单独设计双人审批或 tombstone。
- 未实现报销单“作废”状态；当前策略是锁定而非作废。
- 未新增通用 `audit_events` 表（属于 P0 第 4 项）。

---

## 二、代码变更

| 文件 | 变更 |
|---|---|
| `packages/core/src/services/report-deletion.ts`（新增） | `evaluateReportDeletion`：仅草稿且无审计记录可删；非本人非管理员返回 `FORBIDDEN` |
| `packages/core/src/services/index.ts` | 导出删除策略 |
| `packages/api/src/routes/expenses.ts` | `DELETE /expenses/:id` 改用删除策略；查询审批/付款审计记录；`viewerActions.canDelete` 仅草稿可见 |
| `packages/db/src/migrations/021_guard_report_deletion.sql`（新增） | 删除守卫触发器 + `approval_records` 外键改 `RESTRICT` + 级联显式放行 GUC |
| `packages/db/src/repositories/pg-user-repo.ts` | `cascadeDelete` 在 `BEGIN` 后设置 `sse.allow_destructive_delete=on`，保持级联可用 |
| `packages/core/src/services/__tests__/report-deletion.test.ts`（新增） | 9 个策略用例 |
| `packages/db/src/__tests__/migration-021.test.ts`（新增） | 4 个迁移守卫用例 |
| `packages/db/src/__tests__/pg-user-repo-cascade.test.ts`（新增） | 验证级联删除仍会执行且带显式销毁标记 |

---

## 三、验证结果

```
pnpm --filter @sse/core test  → 6 suites / 50 tests passed
pnpm --filter @sse/db test    → 7 suites / 26 tests passed
pnpm --filter @sse/api test   → 13 suites / 123 tests passed
pnpm -r build                 → 11 个包全部完成
```

未在测试机执行迁移 `021`，部署时需：

```bash
pnpm --filter @sse/db migrate
```

---

## 四、清单进度

| 优先级 | 项 | 状态 |
|---|---|---|
| P0-1 | 修复审批人匹配 | 已完成（`741375b`） |
| P0-2 | 禁止物理删除已通过/已付款单据及审批记录 | 本次完成（级联删除按用户要求保留） |
| P0-3 | SCIM/MDM 角色白名单、来源映射、请求签名与审计 | 下一次会话 |
| P0-4 | 建立 append-only 通用审计事件表 | 待办 |

---

## 五、下一次会话

1. 在测试机应用迁移 `021`，用管理员/财务账号复测：
   - 草稿删除成功；
   - `pending/approved/rejected/paid` 删除返回 `409 REPORT_LOCKED`；
   - 测试机管理员级联删除仍可用（需明确这是破坏性操作）。
2. 开始 P0 第 3 项：SCIM/MDM 角色白名单与来源映射。
3. 注意：本次改动尚未提交 git；提交前检查 `git status`，不要把 `.env` 或密钥带入提交。
