# 报销单内容不可变快照（P1-5）设计

> 对应 `docs/2026-11-12-sse-multi-role-analysis.md` P1 第 5 项：
> “报销单内容快照：提交、每步审批、付款时保存不可变 JSON 快照。”
> 日期：2026-11-21

## 1. 目标与范围

### 目标

- 在报销单的生命周期关键点固化一份不可变的 JSON 快照，证明“审批/付款当时看到的内容”。
- 快照覆盖：提交、每次审批通过、每次驳回、付款。
- 保存内容：主单、明细、发票元信息、AI 核对结果、审批规则链、审批记录、付款与回单。
- 为历史非草稿单据一次性回填标记为 `legacy` 的快照。
- 提供 API 与 Web 展示：报销详情页、管理端。

### 非目标

- 不实现 P1-6 的“核对结果独立历史版本”；快照只固化每个业务时点的核对状态。
- 不改动已完成的 P0 删除策略与级联删除行为。
- 不实现快照的 WORM/外部 SIEM 导出（P2 合规增强）。
- 不做付款修改/撤销的快照；这两类变更已有 `payment_audit_logs` 的 before/after。

## 2. 关键决策

| 决策 | 结论 |
|---|---|
| 存储 | 独立表 `report_snapshots`，append-only，无外键 |
| 生命周期 | 用户级联删除后快照保留（与 `audit_events` 一致） |
| 完整性 | `content_hash = sha256(canonical JSONB text)`，读取时可复算并返回 `hashValid` |
| 触发点 | 提交、每步通过、每步驳回、付款 |
| 写入原子性 | 与业务写操作同一事务；失败则整体回滚 |
| 历史单据 | 迁移时一次性回填，`snapshot_type='backfill'`、`legacy=true` |
| 原始 OCR | 不纳入 payload（仅保留核对状态/结果） |
| 权限 | 报销单可见者：本人/同部门审批人/财务/管理员；管理端接口 admin-only |

## 3. 数据模型

迁移文件：`packages/db/src/migrations/023_report_snapshots.sql`。

```sql
CREATE TABLE IF NOT EXISTS report_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id UUID NOT NULL,
  snapshot_type TEXT NOT NULL,
  schema_version INT NOT NULL DEFAULT 1,
  approval_record_id UUID,
  step INT,
  actor_type TEXT NOT NULL DEFAULT 'user',
  actor_id UUID,
  actor_role TEXT,
  payload JSONB NOT NULL,
  content_hash TEXT NOT NULL,
  legacy BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_report_snapshots_report
  ON report_snapshots (report_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_report_snapshots_type
  ON report_snapshots (snapshot_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_report_snapshots_approval_record
  ON report_snapshots (approval_record_id);
CREATE INDEX IF NOT EXISTS idx_report_snapshots_actor
  ON report_snapshots (actor_id, created_at DESC);
```

约束与守卫：

- `snapshot_type` 仅允许 `submit/approve/reject/pay/backfill`（可用 `CHECK` 约束）。
- `report_id`、`approval_record_id`、`actor_id` **不设外键**，保证级联删除后审计证据仍可保留。
- `BEFORE UPDATE OR DELETE` 触发器 `trg_report_snapshots_append_only` 抛异常，禁止修改/删除。
- `content_hash` 在 SQL 中计算：`encode(sha256(convert_to(payload::text, 'UTF8')), 'hex')`。JSONB 会规范化键顺序，运行时与回填算法一致。PostgreSQL 16 内置 `sha256(bytea)`。

## 4. Payload v1

```jsonc
{
  "schemaVersion": 1,
  "snapshotType": "submit | approve | reject | pay | backfill",
  "capturedAt": "ISO-8601",
  "legacy": false,
  "report": {
    "id": "uuid",
    "serialNo": "string",
    "title": "string",
    "description": "string | null",
    "status": "draft | pending | approved | rejected | paid",
    "currentStep": 0,
    "totalAmount": 0,
    "userId": "uuid",
    "applicantName": "string | null",
    "applicantDepartment": "string | null",
    "submittedAt": "ISO-8601 | null",
    "completedAt": "ISO-8601 | null",
    "paidAt": "ISO-8601 | null",
    "paidBy": "uuid | null",
    "paymentRef": "string | null",
    "paymentComment": "string | null",
    "paymentUpdatedAt": "ISO-8601 | null",
    "paymentUpdatedBy": "uuid | null",
    "createdAt": "ISO-8601",
    "updatedAt": "ISO-8601"
  },
  "items": [
    {
      "id": "uuid",
      "categoryId": "uuid",
      "categoryName": "string | null",
      "amount": 0,
      "expenseDate": "YYYY-MM-DD",
      "description": "string",
      "invoices": [
        {
          "id": "uuid",
          "fileName": "string",
          "fileFormat": "pdf | ofd",
          "fileSize": 0,
          "checksum": "string",
          "invoiceNo": "string | null",
          "verificationStatus": "pending | unverified | warning | error | pass",
          "verificationResult": "object | null",
          "verifiedAt": "ISO-8601 | null",
          "uploadedAt": "ISO-8601"
        }
      ]
    }
  ],
  "verification": {
    "aggregateStatus": "no_invoices | pending | unverified | warning | error | pass",
    "acknowledged": false
  },
  "approval": {
    // 运行时快照为匹配到的规则；历史回填为 null
    "rule": null,
    "records": [
      {
        "id": "uuid",
        "step": 1,
        "approverId": "uuid",
        "approverName": "string | null",
        "result": "pending | approved | rejected",
        "comment": "string | null",
        "stepStartedAt": "ISO-8601",
        "approvedAt": "ISO-8601 | null"
      }
    ],
    "action": {
      "recordId": "uuid",
      "step": 1,
      "result": "approved | rejected",
      "comment": "string | null"
    }
  },
  "payment": {
    "paidAt": "ISO-8601",
    "paidBy": "uuid",
    "paidByName": "string | null",
    "paymentRef": "string | null",
    "paymentComment": "string | null",
    "receipt": {
      "id": "uuid",
      "fileName": "string",
      "fileFormat": "string",
      "checksum": "string",
      "verificationStatus": "string",
      "verificationResult": "object | null",
      "verifiedAt": "ISO-8601 | null"
    }
  }
}
```

说明：

- `approval.rule` 非空时结构为 `{ id, name, minAmount, maxAmount, priority, chain: [{ step, role, assigneeId, label }] }`。
- `approval.rule` 在历史回填中为 `null`（规则不可还原），这是预期。
- `approval.action` 仅在审批/驳回快照中出现；提交/付款快照为 `null`。
- `payment` 仅在付款快照中出现，其余为 `null`。
- `verification.aggregateStatus` 复用 `aggregateVerificationStatus` 的优先级：
  `no_invoices` → `warning` → `error` → `unverified` → `pass`。
- `verification.acknowledged` 取当前审批记录的 `verification_acknowledged`；提交快照为 `false`。

## 5. 代码结构

### shared

`packages/shared/src/types/report-snapshot.ts`

- `SnapshotType`
- `ReportSnapshot`（元数据）
- `ReportSnapshotDetail`（元数据 + `payload` + `hashValid`）
- `ReportSnapshotPayload` 及子结构

导出到 `packages/shared/src/types/index.ts` 与包入口。

### core

- `packages/core/src/ports/sql-executor.ts`：`SqlExecutor` 最小结构接口（`query(text, values?) => Promise<{rows:any[]}>`），供端口声明可选事务客户端，不引入 `pg` 依赖。
- `packages/core/src/ports/ireport-snapshot-repo.ts`：
  - `SnapshotCaptureInput`
  - `SnapshotQuery`
  - `IReportSnapshotRepo`
- `packages/core/src/services/report-snapshot.ts`：
  - `buildReportSnapshotPayload(input): ReportSnapshotPayload` 纯函数，输入为已映射的领域对象。
  - `canonicalSnapshotTypeLabel` 等展示辅助（可选）。
- 端口扩展（可选 `db` 参数，保持向后兼容）：
  - `IApprovalRecordRepo.create(record, db?)`
  - `IApprovalRecordRepo.updateResult(id, result, comment?, db?)`
  - `IExpenseRepo.updateStatus(id, status, currentStep?, db?)`
  - `ApprovalEngine.startApproval(..., db?)`
  - `ApprovalEngine.approveStep(..., db?)`
  - `ApprovalEngine.createNextStep(..., db?)`

### db

`packages/db/src/repositories/pg-report-snapshot-repo.ts`

- `capture(input, db?)`：
  1. 读取主单 + 申请人姓名/部门；
  2. 读取明细 + 分类名 + 发票；
  3. 读取付款回单；
  4. 读取审批记录 + 审批人姓名；
  5. 调用 `buildReportSnapshotPayload`；
  6. `INSERT`，`content_hash` 由 SQL 计算。
- `findByReportId(reportId, db?)`：元数据列表，`created_at DESC, id DESC`。
- `findDetailById(id)`：返回 payload，并计算 `hashValid`（`content_hash = encode(sha256(...))`）。
- `findDetailByReport(reportId, snapshotId)`：同上，带 report 归属校验。
- `query(filter)`：管理端分页筛选，`reportId/type/legacy/from/to`，limit 默认 50、最大 200。

`packages/db/src/index.ts` 导出 `PgReportSnapshotRepo`。

### api

- `packages/api/src/routes/expenses.ts`
  - 新增 `GET /:id/snapshots` 与 `GET /:id/snapshots/:snapshotId`。
  - 使用 `assertReportAccess` 校验可见性。
  - 提交、审批写入点改为事务内捕获：
    - 提交：`startApproval` + 状态更新 + `capture('submit')`。
    - 通过：`approveStep` + 状态推进 + `capture('approve')`。
    - 驳回：`approveStep` + 状态驳回 + `capture('reject')`。
    - 付款：`markPaid` + `paymentAuditRepo.create` + `capture('pay')`。
- `packages/api/src/routes/approvals.ts`
  - 通过/驳回路由改为 `withTransaction`，并传入 client 给引擎写入与捕获。
- `packages/api/src/routes/admin-snapshots.ts`（新增）
  - `router.use(authMiddleware)` + `router.use(requireRole(UserRole.ADMIN))`
  - `GET /`：分页筛选。
  - `GET /:id`：payload + `hashValid`。
- `packages/api/src/index.ts`：挂载 `app.use('/admin/snapshots', adminSnapshotRoutes)`。

### web

- `packages/web/src/components/SnapshotViewer.vue`
  - 弹窗/抽屉展示分区：主单、明细与发票、核对、审批、付款。
  - 顶部显示 `snapshotType`、`createdAt`、`actor`、`schemaVersion`、`legacy`、`contentHash`、`hashValid`。
- `packages/web/src/components/ReportSnapshots.vue`
  - 报销详情页卡片：列表 + “查看”打开 `SnapshotViewer`。
- `packages/web/src/pages/ExpenseDetail.vue`
  - 引入并渲染 `ReportSnapshots`。
- `packages/web/src/pages/AdminSnapshots.vue`（新增）
  - 筛选：reportId、type、legacy、时间范围。
  - 表格 + 分页 + `SnapshotViewer`。
- `packages/web/src/router/index.ts`
  - 新增 `/admin/snapshots`，`meta.requiresAdmin = true`。
- `packages/web/src/layouts/DefaultLayout.vue`
  - 管理员菜单新增“内容快照”。
- `packages/web/src/utils/snapshot.ts`（新增）
  - 类型标签、字段格式化等纯函数，便于测试。

## 6. 历史回填

迁移内一次性回填：

```sql
INSERT INTO report_snapshots (
  report_id, snapshot_type, schema_version, actor_type, payload, content_hash, legacy, created_at
)
SELECT
  p.report_id,
  'backfill',
  1,
  'system',
  p.payload,
  encode(sha256(convert_to(p.payload::text, 'UTF8')), 'hex'),
  true,
  NOW()
FROM ( /* 基于 expense_reports + items + invoices + payment_receipts + approval_records 聚合 */ ) p;
```

回填范围：`status <> 'draft'` 的所有报销单，每单一条。

回填 payload 结构：

- `report`、`items`、`verification.aggregateStatus`、`approval.records`、`payment` 均尽量还原当前状态。
- `approval.rule = null`、`approval.action = null`、`verification.acknowledged = false`。
- `snapshotType = 'backfill'`、`legacy = true`、`actor_type = 'system'`。

不生成 down 迁移（与 `021`、`022` 一致）。

## 7. 错误处理与一致性

- 快照写入失败 → 事务回滚，业务动作失败，避免“有审批无快照”。
- `capture` 使用业务事务的同一 `PoolClient`，确保读到本事务内刚写入的审批记录/付款字段。
- 读取端 `hashValid=false` 不回滚、不报错，仅在响应中标记，供审计发现篡改。
- 快照查询按 `created_at DESC, id DESC` 稳定排序。

## 8. 测试策略

遵循项目现有 Jest 模式（repo 用 mock `pool`，migration 用静态 SQL 断言，路由用 mock `@sse/db` + `fetch`）。

### core

- `buildReportSnapshotPayload`：
  - 完整输入生成全字段 payload；
  - 无发票 → `verification.aggregateStatus='no_invoices'`；
  - 多发票按 item 分组；
  - `legacy` 输入规则为 `null`；
  - `action`/`payment` 在非对应类型下为 `null`。

### db

- `migration-023.test.ts`（静态）：
  - 表、索引、无外键、append-only 触发器、`CHECK` 类型、回填 `INSERT ... SELECT`、`sha256` 哈希。
- `pg-report-snapshot-repo.test.ts`：
  - `capture` 插入参数与 SQL；
  - `findByReportId` 映射与排序；
  - `findDetailById` 返回 `hashValid`；
  - `query` 过滤、分页上限。

### api

- `snapshot-routes.test.ts`：
  - 本人/同部门审批人/财务/管理员可读；无关员工 403。
  - 管理端接口非管理员 403。
- 通过/驳回/付款/提交捕获调用：
  - 在 mock 事务中验证 `capture` 被调用且类型正确。

### web

- `snapshot.test.ts`：类型标签、哈希截断、金额/时间格式化。

### 验证命令

```bash
pnpm -r test
pnpm -r build
```

可选：本地 Docker Postgres 上执行 `pnpm --filter @sse/db migrate`，确认 `023` 回填行数与非草稿单据数一致，并验证 `UPDATE/DELETE report_snapshots` 被触发器拒绝。

## 9. 实施顺序

实现阶段使用 ECC skills：`tdd-workflow`（测试先行）、`code-reviewer`/`typescript-reviewer`（完成后审查）、必要时 `security-review`（快照权限与敏感字段）。

1. shared 类型 + core 端口/纯函数（先写测试）。
2. db 迁移 `023` + repo（先写测试）。
3. api 端口签名扩展 + 事务化写入 + 新路由（先写测试）。
4. web 组件/页面/路由/导航 + 工具测试。
5. 全量 `test`/`build`，可用的 Docker Postgres 上验证迁移与回填。
6. 更新 `docs/2026-11-21-sse-process.md` 记录本次改动与验证结果。

## 10. 风险与缓解

| 风险 | 缓解 |
|---|---|
| 端口增加 `db` 参数影响现有 mock/实现 | 参数为可选，默认 `pool`；现有测试不传即可 |
| 事务化改造引入连接泄漏 | 统一使用现有 `withTransaction`，其 `finally` 释放连接 |
| 回填 SQL 复杂、难测 | 迁移静态测试 + 本地真实库验证；回填仅一次 |
| payload 体积过大 | 不存原始 OCR；仅存核对结果对象 |
| 快照失败阻断业务 | 这是有意的 fail-closed；若需放宽，可后续增加告警而非静默 |
| 级联删除后快照残留 | 有意的审计保留；与 `audit_events` 策略一致 |
