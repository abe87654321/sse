# 发票与回单核对历史版本（P1-6）设计

> 对应 `docs/2026-11-12-sse-multi-role-analysis.md` P1 第 6 项：
> “发票核对历史版本，不覆盖旧结果。”
> 范围确认：发票核对与打款回单核对都做；按核对动作分组；迁移回填已有结果；报销详情内查看历史。
> 日期：2026-11-21

## 1. 目标与范围

### 目标

- 每次发票/回单核对都追加一条不可变的“核对动作”记录，旧结果永不被覆盖或清空。
- 当明细修改、换发票、替换回单导致当前核对失效时，保留旧结果，并追加一条明确的失效事件（原因、操作人、原状态）。
- 回填上线前已存在的核对结果，标记为 `legacy`。
- 在报销详情页提供只读历史查看，支持展开逐张发票/回单结果。
- 为审计回答：谁在何时、因何触发核对；当时每张发票/回单的结论；旧结论何时因何失效。

### 非目标

- 不改变审批门禁：门禁继续读取 `invoices.verification_status` 与 `payment_receipts.verification_status` 的当前值。
- 不替代 `report_snapshots`：快照固化业务时点整单内容；本功能维护核对结果自身的版本链。
- 不做独立的管理端全局历史页面（留给 P1-12 审计页）。
- 不做历史自动清理/保留期限策略（P2 合规增强）。
- 不实现发票/回单核对的 WORM 或外部 SIEM 导出。

## 2. 关键决策

| 决策 | 结论 |
|---|---|
| 存储 | 两张 append-only 表：`verification_runs` + `verification_run_items` |
| 分组 | 一次核对动作一个 run；run 下逐张发票/回单一行 |
| 当前值 | 保留现有 `verification_*` 列作为审批门禁与详情页的“当前值” |
| 失效 | 追加 `invalidate` run + 逐张 item；当前列仍重置为 `pending` / `NULL` |
| 完整性 | 每行 `content_hash = sha256(canonical JSONB text)`，读取时复算 `hashValid` |
| 事务 | 当前值更新与历史写入同一事务；历史写失败则业务动作回滚 |
| 并发 | 发票路径锁报告行，回单路径锁回单行 |
| 迁移回填 | 非 pending 的现有结果回填为 `legacy=true` 的 `backfill` run |
| 生命周期 | 无外键；草稿删除或用户级联删除后历史仍保留 |
| 权限 | 发票历史随报告可见性；回单历史仅财务/管理员；员工读取时脱敏重复发票明细 |

## 3. 数据模型

迁移文件：`packages/db/src/migrations/024_verification_history.sql`。

```sql
CREATE TABLE IF NOT EXISTS verification_runs (
  id UUID PRIMARY KEY,
  report_id UUID NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('invoice', 'payment_receipt')),
  event_type TEXT NOT NULL CHECK (event_type IN ('verify', 'invalidate', 'backfill')),
  cause TEXT NOT NULL CHECK (cause IN (
    'manual', 'force_ocr', 'items_updated', 'invoice_uploaded',
    'receipt_replaced', 'system', 'backfill'
  )),
  reason TEXT,
  actor_type TEXT NOT NULL DEFAULT 'user' CHECK (actor_type IN ('user', 'system')),
  actor_id UUID,
  actor_role TEXT,
  status TEXT NOT NULL CHECK (status IN (
    'pass', 'warning', 'unverified', 'error', 'no_invoices', 'invalidated'
  )),
  summary JSONB NOT NULL,
  content_hash TEXT NOT NULL,
  legacy BOOLEAN NOT NULL DEFAULT false,
  checked_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS verification_run_items (
  id UUID PRIMARY KEY,
  run_id UUID NOT NULL,
  report_id UUID NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('invoice', 'payment_receipt')),
  subject_id UUID NOT NULL,
  item_id UUID,
  file_name TEXT,
  status TEXT NOT NULL CHECK (status IN (
    'pass', 'warning', 'unverified', 'error', 'no_invoices', 'invalidated'
  )),
  result JSONB NOT NULL,
  content_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_verification_runs_report
  ON verification_runs (report_id, checked_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_verification_runs_kind
  ON verification_runs (kind, checked_at DESC);
CREATE INDEX IF NOT EXISTS idx_verification_runs_actor
  ON verification_runs (actor_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_verification_run_items_run
  ON verification_run_items (run_id);
CREATE INDEX IF NOT EXISTS idx_verification_run_items_subject
  ON verification_run_items (subject_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_verification_run_items_report
  ON verification_run_items (report_id, kind, created_at DESC);
```

约束与守卫：

- `id` 由应用生成（`crypto.randomUUID()`），便于同一事务内先插 run、再插 items；不依赖 `RETURNING`。
- `report_id`、`run_id`、`subject_id`、`item_id`、`actor_id` **不设外键**，保证删除后历史可保留。
- `BEFORE UPDATE OR DELETE` 触发器分别拒绝修改/删除两张表，`ERRCODE='55000'`。
- `content_hash` 在 SQL 写入时计算：
  - run：`encode(sha256(convert_to(summary::text, 'UTF8')), 'hex')`
  - item：`encode(sha256(convert_to(result::text, 'UTF8')), 'hex')`
  - 依赖 PostgreSQL 16 内置 `sha256(bytea)`（与迁移 023 一致）。

### status 语义

- `pass / warning / unverified / error / no_invoices`：与现有核对状态一致。
- `invalidated`：仅用于失效事件（run 与 item 都是）。
- run 的 `status`：
  - `verify`：整次核对汇总状态（发票使用 `verifyInvoices` 的 status；回单使用 `verifyPaymentReceipt` 的 status）。
  - `no_invoices`：对无发票报告执行核对时记录，items 为空。
  - `invalidate`：`invalidated`。
  - `backfill`：历史汇总状态。

## 4. JSON 结构

### 4.1 run.summary

发票核对：

```jsonc
{
  "status": "warning",
  "checkedAt": "ISO-8601",
  "summary": "1 张发票核对存在差异",
  "counts": { "total": 2, "pass": 1, "warning": 1, "unverified": 0, "pending": 0 },
  "checks": [ { "key": "report_total", "label": "整单合计", "ok": false, "severity": "warning" } ]
}
```

回单核对：

```jsonc
{
  "status": "pass",
  "checkedAt": "ISO-8601",
  "summary": "打款回单核对通过",
  "checks": [ { "key": "amount_match", "label": "打款金额与报销金额一致", "ok": true, "severity": "warning" } ]
}
```

失效事件：

```jsonc
{
  "affected": 2,
  "note": "费用明细修改，原核对结果失效"
}
```

回填：

```jsonc
{
  "status": "pass",
  "checkedAt": "原 verified_at 最大值",
  "summary": "历史回填（上线前最后一次核对结果）",
  "counts": { "total": 1, "pass": 1, "warning": 0, "unverified": 0, "pending": 0 },
  "checks": []
}
```

### 4.2 item.result

- 发票核对：现有 `InvoiceVerificationResult`（`status/checks/summary/checkedAt/ocr/duplicates`）。
- 回单核对：现有 `PaymentReceiptVerification`（`status/checks/summary/checkedAt/ocr/duplicateReceipts`）。
- 失效事件：

```jsonc
{
  "event": "invalidated",
  "previousStatus": "pass",
  "previousVerifiedAt": "ISO-8601 | null",
  "previousRunId": "uuid | null"
}
```

`previousRunId` 取该 subject 最近一条 `verify` item 的 `run_id`；查不到则为 `null`。

## 5. 写入路径

### 5.1 发票核对 `POST /expenses/:id/verify`

1. 事务外：加载报告/明细/发票，按现有逻辑决定是否 OCR，收集 `ocrByInvoiceId`。
2. 事务内：
   - `SELECT id FROM expense_reports WHERE id = $1 FOR UPDATE` 锁报告行；
   - 重新读取明细与发票（放在锁之后，避免内容已变）；
   - 用 `ocrByInvoiceId` 为新读取的发票重建 sources（新出现且无 OCR 的发票按未识别处理）；
   - 查询重复发票（权限口径不变）；
   - `verifyInvoices()` 重新计算 summary；
   - 写 `invoices.ocr_result/invoice_no` 与 `verification_status/result/verified_at`；
   - `recordRun({ kind:'invoice', eventType:'verify', cause: force?'force_ocr':'manual', actor, status, summary, items })`。
3. 无发票时仍写一条 `no_invoices` run（items 为空），记录“执行过核对”。

### 5.2 明细修改 `PUT /expenses/:id`

- 现有事务内先锁报告行，再调用 `invalidateInvoiceReport`（`cause='items_updated'`）。
- 该方法内部：查询受影响发票（属于该报告且 `verification_result IS NOT NULL OR verification_status <> 'pending'`）→ 写 `event_type='invalidate'` run 与逐张 item（原状态、原 `verified_at`、最近一次 `verify` 的 `run_id`）→ 执行现有重置 SQL（`pending` / `NULL`）。
- 若没有受影响发票，返回 `null`，不写空事件。
- 保持现有行为：只要请求携带 `items` 就重置；不额外判断内容是否真的变化。

### 5.3 发票上传 `POST /expenses/:id/items/:itemId/invoice`

- 将“创建发票 + 失效旧结果 + 重置”包进同一事务。
- 创建新发票后调用 `invalidateInvoiceReport`（`cause='invoice_uploaded'`）；新发票本身是 `pending`，不进入失效 item。

### 5.4 回单上传/替换 `POST /expenses/:id/payment-receipts`

- 先读取现有回单（`findByReportId`）。
- 事务内锁回单行（若存在），再调用 `invalidateReceipt`（`cause='receipt_replaced'`）：
  - 若旧回单已有非 pending 结果，写 `kind='payment_receipt'`、`event_type='invalidate'` 的 run；
  - item `subject_id=回单 id`，`result` 记录原状态/时间/最近 verify run。
- 再执行 `upsert`；其现有重置逻辑不变（`pending` / `NULL`）。
- `upsert` 增加可选事务客户端。

### 5.5 回单核对 `POST /expenses/:id/payment-receipts/:receiptId/verify` 与异步队列

- OCR 在事务外；事务内锁回单行、重新读取回单/报告、计算 summary。
- 写当前 `verification_*` 与 `ocr_result`，再写一条 `kind='payment_receipt'`、`event_type='verify'` 的 run，单 item。
- HTTP 路径：`actor` 为真实用户，`cause` 为 `manual` 或 `force_ocr`。
- `queuePaymentReceiptVerification` 异步路径：`actor_type='system'`、`cause='system'`。
- `runPaymentReceiptVerification(receiptId, forceOcr, context?)` 扩展可选上下文参数，保持旧调用兼容。

### 5.6 并发与失败

- 发票相关写入统一锁报告行；回单相关写入锁回单行，避免“核对读到旧内容但历史记录为新内容”。
- 任何历史写入失败 → 整个事务回滚；发票/回单上传时已写入 MinIO 的对象可能成为孤儿，沿用现有上传语义并在部署说明记录。
- 草稿删除不额外写历史事件；历史行因无外键而保留。

## 6. 读取接口与权限

### `GET /expenses/:id/verification-history`

查询参数：

- `kind`: `all`（默认）| `invoice` | `payment_receipt`
- `limit`: 默认 20，最大 100
- `offset`: 默认 0

响应：

```jsonc
{
  "items": [
    {
      "id": "uuid",
      "reportId": "uuid",
      "kind": "invoice",
      "eventType": "verify",
      "cause": "manual",
      "reason": null,
      "actorType": "user",
      "actorId": "uuid",
      "actorRole": "finance",
      "status": "warning",
      "summary": { /* 4.1 */ },
      "hashValid": true,
      "legacy": false,
      "checkedAt": "ISO-8601",
      "createdAt": "ISO-8601",
      "items": [
        {
          "id": "uuid",
          "subjectId": "uuid",
          "itemId": "uuid",
          "fileName": "invoice.pdf",
          "status": "warning",
          "result": { /* 4.2 */ },
          "hashValid": true
        }
      ]
    }
  ],
  "total": 1,
  "limit": 20,
  "offset": 0
}
```

权限：

- `assertReportAccess`：本人、同部门审批人、财务、管理员。
- 发票历史：上述角色均可读；员工（`employee`）读取时移除 `result.duplicates`（替换为 `[{"restricted":true}]` 形式的受限标记），OCR 字段保留；run.summary 中若含 duplicates 同样脱敏。
- 回单历史中的 `duplicateReceipts` 同样只在财务/管理员响应中保留。
- 回单历史：仅 `finance` / `admin`。`kind=payment_receipt` 且无权限返回 403；`kind=all` 时对无权限角色过滤掉回单 run。
- 响应中的 `hashValid` 由 SQL 复算；不匹配只标记，不报错、不回滚。

### `GET /expenses/:id` 同源泄漏修复

- 非财务/管理员读取报销详情时，对 `invoices[].verificationResult.duplicates` 做同样的脱敏，避免通过当前结果看到其他报销单的重复发票信息。

## 7. 代码结构

### shared

`packages/shared/src/types/verification-history.ts`

- `VerificationHistoryKind = 'invoice' | 'payment_receipt'`
- `VerificationHistoryEventType = 'verify' | 'invalidate' | 'backfill'`
- `VerificationHistoryCause`
- `VerificationHistoryStatus`
- `VerificationRunSummary`（发票/回单/失效/回填的联合结构）
- `VerificationRun`
- `VerificationRunItem`
- `VerificationHistoryResponse`
- `VerificationRunDetail`（可选，用于未来单条详情）

导出到 `types/index.ts` 与包入口。

### core

- `packages/core/src/ports/iverification-history-repo.ts`
  - `RecordVerificationRunInput`
  - `InvalidateInvoiceReportInput`
  - `InvalidateReceiptInput`
  - `VerificationHistoryQuery`
  - `IVerificationHistoryRepo`
- `packages/core/src/services/verification-history.ts`
  - `redactVerificationHistory(run, { canSeeDuplicates, canSeeReceipts })` 纯函数。
  - `verificationHistoryStatusLabel` 等展示辅助（可选，Web 可自行实现）。
- 端口扩展（可选事务客户端，保持向后兼容）：
  - `IInvoiceRepo.updateVerification(id, status, result, db?)`
  - `IInvoiceRepo.updateOcrResult(id, ocrResult, invoiceNo?, db?)`
  - `IPaymentReceiptRepo.upsert(input, db?)`
  - `IPaymentReceiptRepo.updateVerification(id, status, result, ocrResult?, db?)`

### db

`packages/db/src/repositories/pg-verification-history-repo.ts`

- `recordRun(input, db?)`：插入 run + items；哈希由 SQL 计算。
- `invalidateInvoiceReport(input, db?)`：查询受影响发票 → 写失效 run/items → 重置当前列 → 返回 `{ runId, affected } | null`。
- `invalidateReceipt(input, db?)`：同上，针对单份回单。
- `findRunsByReport(query, db?)`：分页查询 run + items，`checked_at DESC, id DESC`，limit 上限 100，返回 `hashValid` 与 `total`。
- `findLatestVerifyRunId(subjectId, db?)`：失效事件回填 `previousRunId`。

`packages/db/src/index.ts` 导出 `PgVerificationHistoryRepo`。

### api

- `packages/api/src/routes/expenses.ts`
  - 发票核对：事务化 + 历史写入（5.1）。
  - 明细修改/发票上传：失效事件（5.2、5.3）。
  - 回单上传：失效事件（5.4）。
  - 新增 `GET /:id/verification-history`。
  - `GET /:id` 对非财务/管理员脱敏发票重复明细。
- `packages/api/src/services/payment-receipt-verifier.ts`
  - `runPaymentReceiptVerification` 接受可选 actor/cause；写入历史（5.5）。
- 不新增管理端路由。

### web

- `packages/web/src/components/VerificationHistory.vue`
  - 报销详情侧栏卡片，支持“发票核对 / 回单核对”切换。
  - 列表：时间、事件类型、操作人（姓名或“系统”）、状态、摘要、`legacy`、`hashValid=false` 警示。
  - 展开：逐张文件、状态、checks、金额/发票号、重复发票（已脱敏时显示“其他报销单已使用”）。
  - 失效事件：显示原因与 `previousStatus`。
- `packages/web/src/pages/ExpenseDetail.vue`
  - 引入并渲染 `VerificationHistory`。
- `packages/web/src/utils/verification-history.ts`
  - 事件/状态/原因标签、时间格式化、摘要提取、脱敏展示辅助，便于单测。
- 不使用独立管理页；不修改导航。

## 8. 迁移回填

范围：

- 发票：`invoices.verification_result IS NOT NULL` 的所有发票，按其 `report_id` 分组。
- 回单：`payment_receipts.verification_result IS NOT NULL` 的所有回单，每份一组。

行为：

- `event_type='backfill'`、`cause='backfill'`、`actor_type='system'`、`legacy=true`。
- run.checked_at：
  - 发票组取组内 `MAX(verified_at)`；
  - 回单取自身 `verified_at`。
- run.status：
  - 发票组按现有优先级：`warning` → `error` → `unverified` → `pass`；
  - 回单直接取 `payment_receipts.verification_status`。
- run.summary 使用第 4.1 节回填结构；发票组计算 counts。
- item.result 直接复制现有 `verification_result`；item.status 复制现有状态；`file_name` 复制文件名。
- 哈希由 SQL 计算。
- 不生成 down 迁移（与 `021`、`022`、`023` 一致）。

## 9. 错误处理与一致性

- 历史写入失败 → 事务回滚，核对/编辑/上传失败；不出现“当前值更新但历史缺失”。
- `hashValid=false` 仅在响应中标记；不阻断展示。
- `legacy=true` 表示上线前回填，UI 明确标注。
- `subject_id` 可能指向已删除发票/回单；历史仍展示 `file_name` 与结果，不依赖关联查询。
- 异步回单核对失败不写半截历史：当前值 + run 在同一事务内。

## 10. 测试策略

遵循现有 Jest / Vitest 模式。

### core

- `redactVerificationHistory`：
  - 员工移除发票 duplicates 与回单 duplicateReceipts；
  - 财务/管理员保留；
  - 无权限角色过滤回单 run。

### db

- `migration-024.test.ts`（静态）：
  - 两表、CHECK 约束、索引、append-only 触发器；
  - 无 `REFERENCES` 外键；
  - 回填 `INSERT ... SELECT`、`legacy=true`、`sha256`。
- `pg-verification-history-repo.test.ts`：
  - `recordRun` 插入 run + items 参数与哈希 SQL；
  - `invalidateInvoiceReport` 只选择非 pending 发票、写失效事件并重置；
  - `invalidateReceipt` 同理；
  - `findRunsByReport` 过滤、分页上限、`hashValid`。

### api

- 历史路由：
  - 本人/同部门审批人/财务/管理员可读发票历史；无关员工 403；
  - 员工看不到重复发票明细；
  - 非财务请求 `kind=payment_receipt` 403，`kind=all` 不含回单；
  - 分页与 kind 过滤。
- 核对写入：
  - 发票核对在 mock 事务中调用 `recordRun` 且类型/状态正确；
  - 明细修改写 `items_updated` 失效事件；
  - 发票上传写 `invoice_uploaded` 失效事件；
  - 回单上传写 `receipt_replaced` 失效事件；
  - 回单核对写 verify run（手动/异步 actor 区分）。
- `GET /expenses/:id` 对员工脱敏发票重复明细。

### web

- `verification-history.test.ts`：事件/状态/原因标签、时间格式、摘要提取。
- `pnpm --filter @sse/web build` 通过。

### 全量验证

```bash
pnpm -r test
pnpm -r build
```

迁移在测试机执行后验证：

1. 发票核对一次 → 新增 `verify` run 与逐张 items；
2. 重复核对 → 旧 run 仍在，新 run 追加；
3. 修改明细 → 当前状态变 `pending`，出现 `invalidate` run，旧结果仍可查；
4. 换发票 → 出现 `invoice_uploaded` 失效事件；
5. 回单上传/核对 → 同理；
6. 非 pending 历史结果迁移后有 `backfill` run 且 `legacy=true`；
7. 直接 `UPDATE` / `DELETE` 两张历史表被触发器拒绝；
8. 员工看不到重复发票明细，财务/管理员可见完整信息。

## 11. 实施顺序

1. shared 类型 + core 端口/脱敏函数（先写测试）。
2. db 迁移 `024` + `PgVerificationHistoryRepo`（先写测试）。
3. db 现有仓储事务客户端扩展。
4. api 核对/失效写入与历史读取路由（先写测试）。
5. web 历史组件、工具函数、详情页接入（先写测试）。
6. 全量 `test` / `build`；测试机执行迁移并复测。
7. 更新设计/计划/TDD 证据/当日 process 记录。

## 12. 风险与缓解

| 风险 | 缓解 |
|---|---|
| 历史表写入扩大事务范围 | 历史与当前值必须原子；查询使用索引，单次插入行数与发票数同阶 |
| 核对期间内容被修改 | 核对事务内锁报告行并重算 summary；OCR 结果按发票 id 复用 |
| 失效事件噪音 | 仅当存在非 pending 结果时写失效事件 |
| 回填 SQL 复杂 | 静态迁移测试 + 测试机真实库验证；仅一次执行 |
| 重复发票信息泄漏 | 历史读取与详情读取统一脱敏函数；财务/管理员保留完整信息 |
| 历史无限增长 | 当前数据量小；后续 P2 增加保留策略，不在本项内做 |
| 上传回滚留下孤儿对象 | 沿用现有 MinIO 上传语义；在部署说明中提示 |

## 13. 部署与回滚

- 部署前在测试机执行 `pnpm --filter @sse/db migrate`，确认 `024_verification_history` 出现在 `schema_migrations`。
- 回填校验：

```sql
SELECT kind, event_type, legacy, COUNT(*)
FROM verification_runs
GROUP BY 1, 2, 3
ORDER BY 1, 2, 3;
```

- 无 down 迁移；如需回滚应用，先停止写入再评估是否保留历史表（历史表本身可继续保留，不影响旧代码）。
