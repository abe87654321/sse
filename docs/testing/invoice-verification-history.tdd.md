# TDD Evidence: Invoice & Receipt Verification History (P1-6)

## 1. Source

- Design: `docs/superpowers/specs/2026-11-21-invoice-verification-history-design.md`
- Plan: `docs/superpowers/plans/2026-11-21-invoice-verification-history.md`

## 2. User journeys

1. 员工重复核对发票后，旧核对结果仍可查询。
2. 财务/审批人能看到每次核对的操作人、时间、逐张结果。
3. 明细修改或换发票后，旧结果保留并出现失效事件。
4. 回单上传/核对同样保留历史，非财务不可见。
5. 管理员可确认历史行哈希仍然匹配，直接 UPDATE/DELETE 被拒绝。

## 3. Task report

| Task | RED evidence | GREEN evidence |
|---|---|---|
| Shared types | build fails without type | `pnpm --filter @sse/shared build` |
| Core redaction | module not found | `pnpm --filter @sse/core test -- verification-history` |
| Migration 024 | ENOENT | `pnpm --filter @sse/db test -- migration-024` |
| Transaction clients | method ignores db | `pnpm --filter @sse/db test -- pg-invoice-repo-transaction` and `pnpm --filter @sse/db test -- pg-payment-receipt-repo-transaction` |
| History repo | module not found | `pnpm --filter @sse/db test -- pg-verification-history-repo` |
| API capture/history | 404 / not called | `pnpm --filter @sse/api test -- expenses-verification` |
| Receipt history | third arg missing | `pnpm --filter @sse/api test -- payment-receipt-history` |
| Detail redaction | serialNo leaked | `pnpm --filter @sse/api test -- expenses-detail-redaction` |
| Web helpers | import failed | `pnpm --filter @sse/web test -- verification-history` |
| Web build | component missing | `pnpm --filter @sse/web build` |

## 4. Verification results

```text
pnpm -r test
  web           56 passed
  core          63 passed
  db            56 passed
  auth          30 passed
  ai           100 passed
  notifications 29 passed
  ontology     176 passed
  api          193 passed
  mcp           56 passed
  合计         759 passed
  （9 个有测试的包；ocr/shared 无测试）

pnpm -r build
  11 个包全部完成（shared/web/core/ocr/ai/auth/db/notifications/ontology/api/mcp）
```

## 5. Known gaps

- 迁移未在本机真实 PostgreSQL 执行（本机 Docker 不可用时）；部署前在测试机执行并复测。
- 上传路由通过 mock 上传中间件覆盖，未做真实 multipart 文件流测试；文件签名校验沿用现有上传单测与中间件测试。
- `GET /expenses/:id/snapshots/:snapshotId` 与 MCP `get_expense_detail` 仍可能向员工暴露历史重复发票引用；本项仅修复报销详情与核对历史接口，残留面记录为后续审计增强。
