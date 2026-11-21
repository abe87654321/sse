# 发票与回单核对历史版本（P1-6）实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为发票与打款回单核对建立 append-only 历史版本，旧结果永不覆盖；失效事件可追溯；报销详情可查看历史。

**Architecture:** 两张 append-only 表 `verification_runs` + `verification_run_items`；当前 `verification_*` 列继续服务审批门禁；核对/失效与历史写入同事务；报告行/回单行加锁；读取时复算哈希并按角色脱敏重复明细。

**Tech Stack:** TypeScript、pnpm monorepo、Express、PostgreSQL 16、Jest、Vue 3、Vitest、MinIO。

**Spec:** `docs/superpowers/specs/2026-11-21-invoice-verification-history-design.md`

---

## 文件结构

### 新增

- `packages/shared/src/types/verification-history.ts` — 历史类型契约。
- `packages/core/src/ports/iverification-history-repo.ts` — 历史仓储端口。
- `packages/core/src/services/verification-history.ts` — 历史读取脱敏纯函数。
- `packages/core/src/services/__tests__/verification-history.test.ts` — 脱敏单测。
- `packages/db/src/migrations/024_verification_history.sql` — 建表、索引、触发器、回填。
- `packages/db/src/__tests__/migration-024.test.ts` — 迁移静态断言。
- `packages/db/src/repositories/pg-verification-history-repo.ts` — 历史仓储。
- `packages/db/src/__tests__/pg-verification-history-repo.test.ts` — 历史仓储单测。
- `packages/db/src/__tests__/pg-invoice-repo-transaction.test.ts` — 发票仓储事务客户端。
- `packages/db/src/__tests__/pg-payment-receipt-repo-transaction.test.ts` — 回单仓储事务客户端。
- `packages/api/src/__tests__/expenses-verification-history.test.ts` — 历史读取接口测试。
- `packages/api/src/__tests__/expenses-verification-capture.test.ts` — 核对/失效写入测试。
- `packages/api/src/__tests__/expenses-detail-redaction.test.ts` — 详情重复明细脱敏测试。
- `packages/web/src/utils/verification-history.ts` — 历史展示辅助。
- `packages/web/src/utils/__tests__/verification-history.test.ts` — 展示辅助单测。
- `packages/web/src/components/VerificationHistory.vue` — 详情页历史卡片。

### 修改

- `packages/shared/src/types/index.ts` — 导出历史类型。
- `packages/core/src/ports/index.ts` — 导出历史端口。
- `packages/core/src/services/index.ts` — 导出脱敏函数。
- `packages/core/src/ports/iinvoice-repo.ts` — 可选事务客户端。
- `packages/db/src/repositories/index.ts` — 导出历史仓储。
- `packages/db/src/repositories/pg-invoice-repo.ts` — 可选事务客户端。
- `packages/db/src/repositories/pg-payment-receipt-repo.ts` — 可选事务客户端。
- `packages/api/src/routes/expenses.ts` — 核对/失效写入、历史读取、详情脱敏。
- `packages/api/src/services/payment-receipt-verifier.ts` — 回单核对历史写入与 actor 上下文。
- `packages/web/src/pages/ExpenseDetail.vue` — 接入历史卡片。
- `docs/2026-11-21-sse-process.md` — 追加 P1-6 过程记录。
- `docs/testing/invoice-verification-history.tdd.md` — TDD 证据。

---

## Task 1: Shared 历史类型

**Files:**
- Create: `packages/shared/src/types/verification-history.ts`
- Modify: `packages/shared/src/types/index.ts`

- [ ] **Step 1: 写类型文件**

创建 `packages/shared/src/types/verification-history.ts`：

```ts
import type { VerificationCheck } from './invoice-verification';

export type VerificationHistoryKind = 'invoice' | 'payment_receipt';

export type VerificationHistoryEventType = 'verify' | 'invalidate' | 'backfill';

export type VerificationHistoryCause =
  | 'manual'
  | 'force_ocr'
  | 'items_updated'
  | 'invoice_uploaded'
  | 'receipt_replaced'
  | 'system'
  | 'backfill';

export type VerificationHistoryStatus =
  | 'pass'
  | 'warning'
  | 'unverified'
  | 'error'
  | 'no_invoices'
  | 'invalidated';

export type VerificationRunSummary = {
  status: VerificationHistoryStatus;
  checkedAt?: string | null;
  summary?: string;
  counts?: {
    total: number;
    pass: number;
    warning: number;
    unverified: number;
    pending: number;
  };
  checks?: VerificationCheck[];
  affected?: number;
  note?: string;
};

export type VerificationRunItem = {
  id: string;
  runId: string;
  reportId: string;
  kind: VerificationHistoryKind;
  subjectId: string;
  itemId?: string | null;
  fileName?: string | null;
  status: VerificationHistoryStatus;
  result: Record<string, any>;
  hashValid: boolean;
  createdAt: string | Date;
};

export type VerificationRun = {
  id: string;
  reportId: string;
  kind: VerificationHistoryKind;
  eventType: VerificationHistoryEventType;
  cause: VerificationHistoryCause;
  reason?: string | null;
  actorType: 'user' | 'system';
  actorId?: string | null;
  actorRole?: string | null;
  status: VerificationHistoryStatus;
  summary: VerificationRunSummary;
  contentHash: string;
  hashValid: boolean;
  legacy: boolean;
  checkedAt: string | Date;
  createdAt: string | Date;
  items: VerificationRunItem[];
};

export type VerificationHistoryResponse = {
  items: VerificationRun[];
  total: number;
  limit: number;
  offset: number;
};
```

- [ ] **Step 2: 导出类型**

在 `packages/shared/src/types/index.ts` 末尾追加：

```ts
export type {
  VerificationHistoryKind,
  VerificationHistoryEventType,
  VerificationHistoryCause,
  VerificationHistoryStatus,
  VerificationRunSummary,
  VerificationRunItem,
  VerificationRun,
  VerificationHistoryResponse,
} from './verification-history';
```

- [ ] **Step 3: 构建 shared**

Run: `pnpm --filter @sse/shared build`
Expected: 构建成功，无 TS 错误。

- [ ] **Step 4: 提交**

```bash
git add packages/shared/src/types/verification-history.ts packages/shared/src/types/index.ts
git commit -m "feat(shared): add verification history types"
```

---

## Task 2: Core 脱敏函数与历史端口

**Files:**
- Create: `packages/core/src/ports/iverification-history-repo.ts`
- Create: `packages/core/src/services/verification-history.ts`
- Create: `packages/core/src/services/__tests__/verification-history.test.ts`
- Modify: `packages/core/src/ports/index.ts`
- Modify: `packages/core/src/services/index.ts`
- Modify: `packages/core/src/ports/iinvoice-repo.ts`

- [ ] **Step 1: 写失败测试**

创建 `packages/core/src/services/__tests__/verification-history.test.ts`：

```ts
import type { VerificationRun } from '@sse/shared';
import { redactVerificationHistory } from '../verification-history';

function invoiceRun(): VerificationRun {
  return {
    id: 'run-1',
    reportId: 'r1',
    kind: 'invoice',
    eventType: 'verify',
    cause: 'manual',
    actorType: 'user',
    actorId: 'u1',
    actorRole: 'employee',
    status: 'warning',
    summary: { status: 'warning', summary: '存在差异' },
    contentHash: 'hash',
    hashValid: true,
    legacy: false,
    checkedAt: '2026-11-21T08:00:00Z',
    createdAt: '2026-11-21T08:00:00Z',
    items: [
      {
        id: 'item-1',
        runId: 'run-1',
        reportId: 'r1',
        kind: 'invoice',
        subjectId: 'inv-1',
        itemId: 'it-1',
        fileName: 'a.pdf',
        status: 'warning',
        result: {
          status: 'warning',
          duplicates: [
            { invoiceId: 'inv-2', reportId: 'r2', serialNo: 'RE-2', status: 'approved' },
          ],
          ocr: { invoiceNo: 'NO-1' },
        },
        hashValid: true,
        createdAt: '2026-11-21T08:00:00Z',
      },
    ],
  };
}

function receiptRun(): VerificationRun {
  return {
    id: 'run-2',
    reportId: 'r1',
    kind: 'payment_receipt',
    eventType: 'verify',
    cause: 'manual',
    actorType: 'user',
    actorId: 'fin-1',
    actorRole: 'finance',
    status: 'pass',
    summary: { status: 'pass', summary: '通过' },
    contentHash: 'hash',
    hashValid: true,
    legacy: false,
    checkedAt: '2026-11-21T09:00:00Z',
    createdAt: '2026-11-21T09:00:00Z',
    items: [
      {
        id: 'item-2',
        runId: 'run-2',
        reportId: 'r1',
        kind: 'payment_receipt',
        subjectId: 'receipt-1',
        itemId: null,
        fileName: 'receipt.pdf',
        status: 'pass',
        result: {
          status: 'pass',
          duplicateReceipts: [{ receiptId: 'receipt-2', serialNo: 'RE-3' }],
        },
        hashValid: true,
        createdAt: '2026-11-21T09:00:00Z',
      },
    ],
  };
}

describe('redactVerificationHistory', () => {
  it('masks invoice duplicate details for employees but keeps OCR', () => {
    const result = redactVerificationHistory(invoiceRun(), {
      canSeeDuplicates: false,
      canSeeReceipts: true,
    });

    expect(result).not.toBeNull();
    expect(result!.items[0].result.duplicates).toEqual([{ restricted: true }]);
    expect(result!.items[0].result.ocr).toEqual({ invoiceNo: 'NO-1' });
  });

  it('keeps invoice duplicate details for approvers and finance', () => {
    const result = redactVerificationHistory(invoiceRun(), {
      canSeeDuplicates: true,
      canSeeReceipts: true,
    });

    expect(result!.items[0].result.duplicates).toEqual([
      { invoiceId: 'inv-2', reportId: 'r2', serialNo: 'RE-2', status: 'approved' },
    ]);
  });

  it('drops receipt runs for roles without payment visibility', () => {
    expect(
      redactVerificationHistory(receiptRun(), {
        canSeeDuplicates: false,
        canSeeReceipts: false,
      })
    ).toBeNull();
  });

  it('masks receipt duplicates for finance when duplicates are restricted', () => {
    const result = redactVerificationHistory(receiptRun(), {
      canSeeDuplicates: false,
      canSeeReceipts: true,
    });

    expect(result!.items[0].result.duplicateReceipts).toEqual([{ restricted: true }]);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm --filter @sse/core test -- verification-history`
Expected: FAIL，提示 `Cannot find module '../verification-history'`。

- [ ] **Step 3: 写端口**

创建 `packages/core/src/ports/iverification-history-repo.ts`：

```ts
import type {
  VerificationHistoryCause,
  VerificationHistoryEventType,
  VerificationHistoryKind,
  VerificationHistoryResponse,
  VerificationHistoryStatus,
  VerificationRun,
  VerificationRunSummary,
} from '@sse/shared';
import type { SqlExecutor } from './sql-executor';

export type VerificationRunItemInput = {
  subjectId: string;
  itemId?: string | null;
  fileName?: string | null;
  status: VerificationHistoryStatus;
  result: Record<string, any>;
};

export type VerificationRunActor = {
  type: 'user' | 'system';
  id?: string | null;
  role?: string | null;
};

export type RecordVerificationRunInput = {
  reportId: string;
  kind: VerificationHistoryKind;
  eventType: VerificationHistoryEventType;
  cause: VerificationHistoryCause;
  reason?: string | null;
  actor: VerificationRunActor;
  status: VerificationHistoryStatus;
  summary: VerificationRunSummary;
  checkedAt?: string | Date;
  legacy?: boolean;
  items: VerificationRunItemInput[];
};

export type InvalidateInvoiceReportInput = {
  reportId: string;
  cause: VerificationHistoryCause;
  reason?: string | null;
  actor: VerificationRunActor;
};

export type InvalidateReceiptInput = {
  reportId: string;
  receiptId: string;
  cause: VerificationHistoryCause;
  reason?: string | null;
  actor: VerificationRunActor;
};

export type VerificationHistoryQuery = {
  reportId: string;
  kind?: VerificationHistoryKind;
  limit?: number;
  offset?: number;
};

export interface IVerificationHistoryRepo {
  recordRun(input: RecordVerificationRunInput, db?: SqlExecutor): Promise<VerificationRun>;
  invalidateInvoiceReport(
    input: InvalidateInvoiceReportInput,
    db?: SqlExecutor
  ): Promise<{ runId: string; affected: number } | null>;
  invalidateReceipt(
    input: InvalidateReceiptInput,
    db?: SqlExecutor
  ): Promise<{ runId: string; affected: number } | null>;
  findRunsByReport(
    query: VerificationHistoryQuery,
    db?: SqlExecutor
  ): Promise<VerificationHistoryResponse>;
  findLatestVerifyRunId(subjectId: string, db?: SqlExecutor): Promise<string | null>;
}
```

- [ ] **Step 4: 写脱敏函数**

创建 `packages/core/src/services/verification-history.ts`：

```ts
import type { VerificationRun } from '@sse/shared';

const RESTRICTED_MARKER = [{ restricted: true }];

function redactItemResult(
  result: Record<string, any>,
  kind: string
): Record<string, any> {
  if (!result || typeof result !== 'object') return result;
  const clone = { ...result };

  if (kind === 'invoice' && Array.isArray(result.duplicates)) {
    clone.duplicates = result.duplicates.length > 0 ? RESTRICTED_MARKER : [];
  }
  if (kind === 'payment_receipt' && Array.isArray(result.duplicateReceipts)) {
    clone.duplicateReceipts =
      result.duplicateReceipts.length > 0 ? RESTRICTED_MARKER : [];
  }

  return clone;
}

export function redactVerificationHistory(
  run: VerificationRun,
  options: { canSeeDuplicates: boolean; canSeeReceipts: boolean }
): VerificationRun | null {
  if (run.kind === 'payment_receipt' && !options.canSeeReceipts) return null;
  if (options.canSeeDuplicates) return run;

  return {
    ...run,
    items: run.items.map((item) => ({
      ...item,
      result: redactItemResult(item.result, item.kind),
    })),
  };
}
```

- [ ] **Step 5: 更新导出与发票端口**

`packages/core/src/ports/index.ts` 追加：

```ts
export type {
  IVerificationHistoryRepo,
  RecordVerificationRunInput,
  VerificationRunActor,
  VerificationRunItemInput,
  InvalidateInvoiceReportInput,
  InvalidateReceiptInput,
  VerificationHistoryQuery,
} from './iverification-history-repo';
```

`packages/core/src/services/index.ts` 追加：

```ts
export { redactVerificationHistory } from './verification-history';
```

`packages/core/src/ports/iinvoice-repo.ts` 增加可选事务客户端：

```ts
import type { SqlExecutor } from './sql-executor';
import type { DuplicateInvoiceRef, Invoice, VerificationStatus } from '@sse/shared';

export interface IInvoiceRepo {
  findById(id: string, db?: SqlExecutor): Promise<Invoice | null>;
  findByItemId(itemId: string, db?: SqlExecutor): Promise<Invoice | null>;
  create(invoice: Omit<Invoice, 'id' | 'uploadedAt'>, db?: SqlExecutor): Promise<Invoice>;
  updateOcrResult(
    id: string,
    ocrResult: any,
    invoiceNo?: string,
    db?: SqlExecutor
  ): Promise<void>;
  updateVerification(
    id: string,
    status: VerificationStatus,
    result: unknown,
    db?: SqlExecutor
  ): Promise<void>;
  findDuplicatesByInvoiceNo(
    invoiceNo: string,
    excludeInvoiceId: string,
    db?: SqlExecutor
  ): Promise<DuplicateInvoiceRef[]>;
}
```

- [ ] **Step 6: 运行测试确认通过**

Run: `pnpm --filter @sse/core test -- verification-history`
Expected: PASS，4 tests passed。

Run: `pnpm --filter @sse/core build`
Expected: 构建成功。

- [ ] **Step 7: 提交**

```bash
git add packages/core/src/ports/iverification-history-repo.ts \
  packages/core/src/ports/index.ts \
  packages/core/src/ports/iinvoice-repo.ts \
  packages/core/src/services/verification-history.ts \
  packages/core/src/services/index.ts \
  packages/core/src/services/__tests__/verification-history.test.ts
git commit -m "feat(core): add verification history port and redaction"
```

---

## Task 3: 迁移 024 与回填

**Files:**
- Create: `packages/db/src/migrations/024_verification_history.sql`
- Create: `packages/db/src/__tests__/migration-024.test.ts`

- [ ] **Step 1: 写失败测试**

创建 `packages/db/src/__tests__/migration-024.test.ts`：

```ts
import { readFileSync } from 'fs';
import { join } from 'path';

const sql = readFileSync(
  join(__dirname, '..', 'migrations', '024_verification_history.sql'),
  'utf-8'
);

describe('024_verification_history', () => {
  it('creates both history tables with the expected status checks', () => {
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS verification_runs/i);
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS verification_run_items/i);
    expect(sql).toMatch(/kind TEXT NOT NULL CHECK \(kind IN \('invoice', 'payment_receipt'\)\)/i);
    expect(sql).toMatch(
      /event_type TEXT NOT NULL CHECK \(event_type IN \('verify', 'invalidate', 'backfill'\)\)/i
    );
    expect(sql).toMatch(/status TEXT NOT NULL CHECK \(status IN/i);
    expect(sql).toMatch(/summary JSONB NOT NULL/i);
    expect(sql).toMatch(/result JSONB NOT NULL/i);
    expect(sql).toMatch(/content_hash TEXT NOT NULL/i);
    expect(sql).toMatch(/legacy BOOLEAN NOT NULL DEFAULT false/i);
  });

  it('does not bind history to users, reports, invoices or receipts', () => {
    expect(sql).not.toMatch(/REFERENCES users/i);
    expect(sql).not.toMatch(/REFERENCES expense_reports/i);
    expect(sql).not.toMatch(/REFERENCES invoices/i);
    expect(sql).not.toMatch(/REFERENCES payment_receipts/i);
  });

  it('blocks updates and deletes on both tables', () => {
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION sse_verification_runs_append_only/i);
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION sse_verification_run_items_append_only/i);
    expect(sql).toMatch(/BEFORE UPDATE OR DELETE ON verification_runs/i);
    expect(sql).toMatch(/BEFORE UPDATE OR DELETE ON verification_run_items/i);
    expect(sql).toMatch(/RAISE EXCEPTION/i);
  });

  it('computes SHA-256 hashes for runs and items', () => {
    expect(sql).toMatch(/encode\(sha256\(convert_to\(summary::text, 'UTF8'\)\), 'hex'\)/i);
    expect(sql).toMatch(/encode\(sha256\(convert_to\(result::text, 'UTF8'\)\), 'hex'\)/i);
  });

  it('backfills legacy invoice and receipt results', () => {
    expect(sql).toMatch(/INSERT INTO verification_runs/i);
    expect(sql).toMatch(/'backfill'/i);
    expect(sql).toMatch(/'legacy', true/i);
    expect(sql).toMatch(/FROM invoices i/i);
    expect(sql).toMatch(/FROM payment_receipts pr/i);
    expect(sql).toMatch(/verification_result IS NOT NULL/i);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm --filter @sse/db test -- migration-024`
Expected: FAIL，`ENOENT ... 024_verification_history.sql`。

- [ ] **Step 3: 写迁移 SQL**

创建 `packages/db/src/migrations/024_verification_history.sql`：

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

CREATE OR REPLACE FUNCTION sse_verification_runs_append_only()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'verification_runs is append-only (%); insert a new run instead', TG_OP
    USING ERRCODE = '55000';
END;
$$;

DROP TRIGGER IF EXISTS trg_verification_runs_append_only ON verification_runs;
CREATE TRIGGER trg_verification_runs_append_only
  BEFORE UPDATE OR DELETE ON verification_runs
  FOR EACH ROW
  EXECUTE FUNCTION sse_verification_runs_append_only();

CREATE OR REPLACE FUNCTION sse_verification_run_items_append_only()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'verification_run_items is append-only (%); insert a new item instead', TG_OP
    USING ERRCODE = '55000';
END;
$$;

DROP TRIGGER IF EXISTS trg_verification_run_items_append_only ON verification_run_items;
CREATE TRIGGER trg_verification_run_items_append_only
  BEFORE UPDATE OR DELETE ON verification_run_items
  FOR EACH ROW
  EXECUTE FUNCTION sse_verification_run_items_append_only();

WITH invoice_groups AS (
  SELECT
    ei.report_id,
    COALESCE(MAX(i.verified_at), NOW()) AS checked_at,
    CASE
      WHEN bool_or(i.verification_status = 'warning') THEN 'warning'
      WHEN bool_or(i.verification_status = 'error') THEN 'error'
      WHEN bool_or(i.verification_status IN ('unverified', 'pending')) THEN 'unverified'
      ELSE 'pass'
    END AS status,
    COUNT(*)::int AS total,
    COUNT(*) FILTER (WHERE i.verification_status = 'pass')::int AS pass_count,
    COUNT(*) FILTER (WHERE i.verification_status = 'warning')::int AS warning_count,
    COUNT(*) FILTER (WHERE i.verification_status = 'unverified')::int AS unverified_count
  FROM invoices i
  JOIN expense_items ei ON ei.id = i.item_id
  WHERE i.verification_result IS NOT NULL
  GROUP BY ei.report_id
),
invoice_run_source AS (
  SELECT
    report_id,
    checked_at,
    status,
    jsonb_build_object(
      'status', status,
      'checkedAt', checked_at,
      'summary', '历史回填（上线前最后一次核对结果）',
      'counts', jsonb_build_object(
        'total', total,
        'pass', pass_count,
        'warning', warning_count,
        'unverified', unverified_count,
        'pending', 0
      ),
      'checks', '[]'::jsonb,
      'legacy', true
    ) AS summary
  FROM invoice_groups
),
invoice_runs AS (
  INSERT INTO verification_runs (
    id, report_id, kind, event_type, cause, actor_type, status,
    summary, content_hash, legacy, checked_at, created_at
  )
  SELECT
    gen_random_uuid(), report_id, 'invoice', 'backfill', 'backfill', 'system', status,
    summary,
    encode(sha256(convert_to(summary::text, 'UTF8')), 'hex'),
    true,
    checked_at,
    NOW()
  FROM invoice_run_source
  RETURNING id, report_id
)
INSERT INTO verification_run_items (
  id, run_id, report_id, kind, subject_id, item_id, file_name, status, result,
  content_hash, created_at
)
SELECT
  gen_random_uuid(),
  r.id,
  ei.report_id,
  'invoice',
  i.id,
  i.item_id,
  i.file_name,
  CASE WHEN i.verification_status = 'pending' THEN 'unverified' ELSE i.verification_status END,
  i.verification_result,
  encode(sha256(convert_to(i.verification_result::text, 'UTF8')), 'hex'),
  NOW()
FROM invoices i
JOIN expense_items ei ON ei.id = i.item_id
JOIN invoice_runs r ON r.report_id = ei.report_id
WHERE i.verification_result IS NOT NULL;

WITH receipt_source AS (
  SELECT
    pr.report_id,
    pr.id,
    pr.file_name,
    pr.verification_status,
    pr.verification_result,
    COALESCE(pr.verified_at, NOW()) AS checked_at,
    jsonb_build_object(
      'status', CASE WHEN pr.verification_status = 'pending' THEN 'unverified' ELSE pr.verification_status END,
      'checkedAt', COALESCE(pr.verified_at, NOW()),
      'summary', '历史回填（上线前最后一次核对结果）',
      'checks', COALESCE(pr.verification_result -> 'checks', '[]'::jsonb),
      'legacy', true
    ) AS summary
  FROM payment_receipts pr
  WHERE pr.verification_result IS NOT NULL
),
receipt_runs AS (
  INSERT INTO verification_runs (
    id, report_id, kind, event_type, cause, actor_type, status,
    summary, content_hash, legacy, checked_at, created_at
  )
  SELECT
    gen_random_uuid(), report_id, 'payment_receipt', 'backfill', 'backfill', 'system',
    CASE WHEN verification_status = 'pending' THEN 'unverified' ELSE verification_status END,
    summary,
    encode(sha256(convert_to(summary::text, 'UTF8')), 'hex'),
    true,
    checked_at,
    NOW()
  FROM receipt_source
  RETURNING id, report_id
)
INSERT INTO verification_run_items (
  id, run_id, report_id, kind, subject_id, item_id, file_name, status, result,
  content_hash, created_at
)
SELECT
  gen_random_uuid(),
  r.id,
  s.report_id,
  'payment_receipt',
  s.id,
  NULL,
  s.file_name,
  CASE WHEN s.verification_status = 'pending' THEN 'unverified' ELSE s.verification_status END,
  s.verification_result,
  encode(sha256(convert_to(s.verification_result::text, 'UTF8')), 'hex'),
  NOW()
FROM receipt_source s
JOIN receipt_runs r ON r.report_id = s.report_id;
```

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm --filter @sse/db test -- migration-024`
Expected: PASS，5 tests passed。

- [ ] **Step 5: 提交**

```bash
git add packages/db/src/migrations/024_verification_history.sql packages/db/src/__tests__/migration-024.test.ts
git commit -m "feat(db): add verification history migration"
```

---

## Task 4: 发票/回单仓储的事务客户端支持

**Files:**
- Modify: `packages/db/src/repositories/pg-invoice-repo.ts`
- Modify: `packages/db/src/repositories/pg-payment-receipt-repo.ts`
- Create: `packages/db/src/__tests__/pg-invoice-repo-transaction.test.ts`
- Create: `packages/db/src/__tests__/pg-payment-receipt-repo-transaction.test.ts`

- [ ] **Step 1: 写失败测试（发票）**

创建 `packages/db/src/__tests__/pg-invoice-repo-transaction.test.ts`：

```ts
const mockQuery = jest.fn();

jest.mock('../connection', () => ({
  pool: { query: jest.fn() },
}));

import { PgInvoiceRepo } from '../repositories/pg-invoice-repo';

beforeEach(() => {
  mockQuery.mockReset();
});

it('uses the provided transaction client for verification writes', async () => {
  mockQuery.mockResolvedValue({ rows: [] });
  const client = { query: mockQuery };

  await new PgInvoiceRepo().updateVerification('inv-1', 'pass', { ok: true }, client as any);

  expect(mockQuery).toHaveBeenCalledTimes(1);
  const [sql, params] = mockQuery.mock.calls[0];
  expect(sql).toContain('UPDATE invoices');
  expect(params[0]).toBe('pass');
  expect(params[2]).toBe('inv-1');
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @sse/db test -- pg-invoice-repo-transaction`
Expected: FAIL，`updateVerification` 忽略第 4 个参数或 TS 报参数过多（视 jest 配置）。

- [ ] **Step 3: 写失败测试（回单）**

创建 `packages/db/src/__tests__/pg-payment-receipt-repo-transaction.test.ts`：

```ts
const mockQuery = jest.fn();

jest.mock('../connection', () => ({
  pool: { query: jest.fn() },
}));

import { PgPaymentReceiptRepo } from '../repositories/pg-payment-receipt-repo';

beforeEach(() => {
  mockQuery.mockReset();
});

it('uses the provided transaction client for receipt verification writes', async () => {
  mockQuery.mockResolvedValue({ rows: [] });
  const client = { query: mockQuery };

  await new PgPaymentReceiptRepo().updateVerification(
    'receipt-1',
    'pass',
    { status: 'pass' } as any,
    { ocr: true },
    client as any
  );

  expect(mockQuery).toHaveBeenCalledTimes(1);
  const [sql, params] = mockQuery.mock.calls[0];
  expect(sql).toContain('UPDATE payment_receipts');
  expect(params[0]).toBe('pass');
  expect(params[3]).toBe('receipt-1');
});
```

- [ ] **Step 4: 运行确认失败**

Run: `pnpm --filter @sse/db test -- pg-payment-receipt-repo-transaction`
Expected: FAIL。

- [ ] **Step 5: 修改发票仓储**

将 `packages/db/src/repositories/pg-invoice-repo.ts` 改为：

```ts
import type { DuplicateInvoiceRef, Invoice, VerificationStatus } from '@sse/shared';
import type { IInvoiceRepo, SqlExecutor } from '@sse/core';
import { pool } from '../connection';

function mapInvoice(row: any): Invoice {
  return {
    id: row.id,
    itemId: row.item_id,
    fileName: row.file_name,
    fileFormat: row.file_format,
    fileSize: row.file_size,
    storageKey: row.storage_key,
    storageBucket: row.storage_bucket,
    checksum: row.checksum,
    invoiceNo: row.invoice_no ?? undefined,
    ocrResult: row.ocr_result ?? undefined,
    verificationStatus: row.verification_status ?? 'pending',
    verificationResult: row.verification_result ?? undefined,
    verifiedAt: row.verified_at ?? undefined,
    uploadedAt: row.uploaded_at,
  };
}

export class PgInvoiceRepo implements IInvoiceRepo {
  async findById(id: string, db: SqlExecutor = pool): Promise<Invoice | null> {
    const { rows } = await db.query('SELECT * FROM invoices WHERE id = $1', [id]);
    return rows.length === 0 ? null : mapInvoice(rows[0]);
  }

  async findByItemId(itemId: string, db: SqlExecutor = pool): Promise<Invoice | null> {
    const { rows } = await db.query('SELECT * FROM invoices WHERE item_id = $1', [itemId]);
    return rows.length === 0 ? null : mapInvoice(rows[0]);
  }

  async create(
    invoice: Omit<Invoice, 'id' | 'uploadedAt'>,
    db: SqlExecutor = pool
  ): Promise<Invoice> {
    const { rows } = await db.query(
      `INSERT INTO invoices (item_id, file_name, file_format, file_size, storage_key, storage_bucket, checksum, ocr_result)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [
        invoice.itemId,
        invoice.fileName,
        invoice.fileFormat,
        invoice.fileSize,
        invoice.storageKey,
        invoice.storageBucket,
        invoice.checksum,
        invoice.ocrResult ? JSON.stringify(invoice.ocrResult) : null,
      ]
    );
    return mapInvoice(rows[0]);
  }

  async updateOcrResult(
    id: string,
    ocrResult: any,
    invoiceNo?: string,
    db: SqlExecutor = pool
  ): Promise<void> {
    await db.query(
      `UPDATE invoices
          SET ocr_result = $1, invoice_no = COALESCE($2, invoice_no)
        WHERE id = $3`,
      [JSON.stringify(ocrResult), invoiceNo ?? null, id]
    );
  }

  async updateVerification(
    id: string,
    status: VerificationStatus,
    result: unknown,
    db: SqlExecutor = pool
  ): Promise<void> {
    await db.query(
      `UPDATE invoices
          SET verification_status = $1, verification_result = $2, verified_at = NOW()
        WHERE id = $3`,
      [status, JSON.stringify(result), id]
    );
  }

  async findDuplicatesByInvoiceNo(
    invoiceNo: string,
    excludeInvoiceId: string,
    db: SqlExecutor = pool
  ): Promise<DuplicateInvoiceRef[]> {
    const { rows } = await db.query(
      `SELECT i.id AS invoice_id, er.id AS report_id, er.serial_no, er.status
         FROM invoices i
         JOIN expense_items ei ON ei.id = i.item_id
         JOIN expense_reports er ON er.id = ei.report_id
        WHERE i.invoice_no = $1
          AND i.id <> $2
        ORDER BY i.uploaded_at DESC
        LIMIT 10`,
      [invoiceNo, excludeInvoiceId]
    );

    return rows.map((row: any) => ({
      invoiceId: row.invoice_id,
      reportId: row.report_id,
      serialNo: row.serial_no,
      status: row.status,
    }));
  }
}
```

- [ ] **Step 6: 修改回单仓储**

在 `packages/db/src/repositories/pg-payment-receipt-repo.ts` 中：

1. 增加导入：

```ts
import type { SqlExecutor } from '@sse/core';
```

2. 将 `findById`、`findByReportId`、`findPending`、`upsert`、`updateVerification` 改为接受可选 `db`：

```ts
async findById(id: string, db: SqlExecutor = pool): Promise<PaymentReceipt | null> {
  const { rows } = await db.query('SELECT * FROM payment_receipts WHERE id = $1', [id]);
  return rows.length === 0 ? null : mapReceipt(rows[0]);
}

async findByReportId(reportId: string, db: SqlExecutor = pool): Promise<PaymentReceipt | null> {
  const { rows } = await db.query('SELECT * FROM payment_receipts WHERE report_id = $1', [reportId]);
  return rows.length === 0 ? null : mapReceipt(rows[0]);
}

async upsert(input: UpsertPaymentReceiptInput, db: SqlExecutor = pool): Promise<PaymentReceipt> {
  const { rows } = await db.query(
    `INSERT INTO payment_receipts
       (report_id, file_name, file_format, file_size, storage_key, storage_bucket, checksum, uploaded_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (report_id) DO UPDATE SET
       file_name = EXCLUDED.file_name,
       file_format = EXCLUDED.file_format,
       file_size = EXCLUDED.file_size,
       storage_key = EXCLUDED.storage_key,
       storage_bucket = EXCLUDED.storage_bucket,
       checksum = EXCLUDED.checksum,
       uploaded_by = EXCLUDED.uploaded_by,
       uploaded_at = NOW(),
       ocr_result = NULL,
       verification_status = 'pending',
       verification_result = NULL,
       verified_at = NULL
     RETURNING *`,
    [
      input.reportId,
      input.fileName,
      input.fileFormat,
      input.fileSize,
      input.storageKey,
      input.storageBucket,
      input.checksum,
      input.uploadedBy ?? null,
    ]
  );
  return mapReceipt(rows[0]);
}

async updateVerification(
  id: string,
  status: PaymentReceiptStatus,
  result: PaymentReceiptVerification,
  ocrResult?: unknown,
  db: SqlExecutor = pool
): Promise<void> {
  await db.query(
    `UPDATE payment_receipts
        SET verification_status = $1,
            verification_result = $2,
            ocr_result = $3,
            verified_at = NOW()
      WHERE id = $4`,
    [status, JSON.stringify(result), ocrResult ? JSON.stringify(ocrResult) : null, id]
  );
}
```

`findPending` 同样改为 `db: SqlExecutor = pool` 并使用 `db.query`。

- [ ] **Step 7: 运行测试**

Run: `pnpm --filter @sse/db test -- pg-invoice-repo-transaction`
Expected: PASS。

Run: `pnpm --filter @sse/db test -- pg-payment-receipt-repo-transaction`
Expected: PASS。

- [ ] **Step 8: 提交**

```bash
git add packages/db/src/repositories/pg-invoice-repo.ts \
  packages/db/src/repositories/pg-payment-receipt-repo.ts \
  packages/db/src/__tests__/pg-invoice-repo-transaction.test.ts \
  packages/db/src/__tests__/pg-payment-receipt-repo-transaction.test.ts
git commit -m "refactor(db): allow verification writes to join transactions"
```

---

## Task 5: PgVerificationHistoryRepo

**Files:**
- Create: `packages/db/src/repositories/pg-verification-history-repo.ts`
- Create: `packages/db/src/__tests__/pg-verification-history-repo.test.ts`
- Modify: `packages/db/src/repositories/index.ts`

- [ ] **Step 1: 写失败测试**

创建 `packages/db/src/__tests__/pg-verification-history-repo.test.ts`：

```ts
const mockQuery = jest.fn();

jest.mock('../connection', () => ({
  pool: { query: (...args: any[]) => mockQuery(...args) },
}));

import { PgVerificationHistoryRepo } from '../repositories/pg-verification-history-repo';

beforeEach(() => {
  mockQuery.mockReset();
});

describe('recordRun', () => {
  it('inserts a run and one item per subject with SQL hashes', async () => {
    mockQuery
      .mockResolvedValueOnce({
        rows: [
          {
            id: 'run-1',
            report_id: 'r1',
            kind: 'invoice',
            event_type: 'verify',
            cause: 'manual',
            reason: null,
            actor_type: 'user',
            actor_id: 'u1',
            actor_role: 'finance',
            status: 'pass',
            summary: { status: 'pass' },
            content_hash: 'hash',
            legacy: false,
            checked_at: new Date('2026-11-21T08:00:00Z'),
            created_at: new Date('2026-11-21T08:00:00Z'),
          },
        ],
      })
      .mockResolvedValueOnce({
        rows: [
          {
            id: 'item-1',
            run_id: 'run-1',
            report_id: 'r1',
            kind: 'invoice',
            subject_id: 'inv-1',
            item_id: 'it-1',
            file_name: 'a.pdf',
            status: 'pass',
            result: { ok: true },
            content_hash: 'item-hash',
            created_at: new Date('2026-11-21T08:00:00Z'),
          },
        ],
      });

    const repo = new PgVerificationHistoryRepo();
    const run = await repo.recordRun({
      reportId: 'r1',
      kind: 'invoice',
      eventType: 'verify',
      cause: 'manual',
      actor: { type: 'user', id: 'u1', role: 'finance' },
      status: 'pass',
      summary: { status: 'pass' },
      items: [
        {
          subjectId: 'inv-1',
          itemId: 'it-1',
          fileName: 'a.pdf',
          status: 'pass',
          result: { ok: true },
        },
      ],
    });

    expect(run.id).toBe('run-1');
    expect(run.items).toHaveLength(1);
    const [runSql, runParams] = mockQuery.mock.calls[0];
    expect(runSql).toContain('INSERT INTO verification_runs');
    expect(runSql).toContain('sha256');
    expect(runParams[1]).toBe('r1');
    expect(runParams[2]).toBe('invoice');
    const [itemSql, itemParams] = mockQuery.mock.calls[1];
    expect(itemSql).toContain('INSERT INTO verification_run_items');
    expect(itemSql).toContain('sha256');
    expect(itemParams[1]).toBe('run-1');
    expect(itemParams[4]).toBe('inv-1');
  });
});

describe('invalidateInvoiceReport', () => {
  it('writes an invalidation run and resets affected invoices', async () => {
    mockQuery
      .mockResolvedValueOnce({
        rows: [
          {
            id: 'inv-1',
            item_id: 'it-1',
            file_name: 'a.pdf',
            verification_status: 'pass',
            verification_result: { ok: true },
            verified_at: new Date('2026-11-21T08:00:00Z'),
            previous_run_id: 'run-prev',
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [{ id: 'run-inv', content_hash: 'h', created_at: new Date(), checked_at: new Date() }] })
      .mockResolvedValueOnce({ rows: [{ id: 'item-inv', content_hash: 'h', created_at: new Date() }] })
      .mockResolvedValueOnce({ rows: [] });

    const result = await new PgVerificationHistoryRepo().invalidateInvoiceReport({
      reportId: 'r1',
      cause: 'items_updated',
      reason: '费用明细修改，原核对结果失效',
      actor: { type: 'user', id: 'u1', role: 'employee' },
    });

    expect(result).toEqual({ runId: 'run-inv', affected: 1 });
    const [selectSql, selectParams] = mockQuery.mock.calls[0];
    expect(selectSql).toContain('FOR UPDATE');
    expect(selectSql).toContain('verification_result IS NOT NULL');
    expect(selectParams).toEqual(['r1']);
    const [, insertRunParams] = mockQuery.mock.calls[1];
    expect(insertRunParams[2]).toBe('invoice');
    expect(insertRunParams[3]).toBe('invalidate');
    const resetSql = mockQuery.mock.calls[3][0];
    expect(resetSql).toContain('verification_status = \'pending\'');
    expect(resetSql).toContain('verification_result = NULL');
  });

  it('returns null when no invoice had a result', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const result = await new PgVerificationHistoryRepo().invalidateInvoiceReport({
      reportId: 'r1',
      cause: 'items_updated',
      actor: { type: 'user', id: 'u1', role: 'employee' },
    });

    expect(result).toBeNull();
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });
});

describe('findRunsByReport', () => {
  it('clamps pagination and groups items under runs', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ count: 1 }] })
      .mockResolvedValueOnce({
        rows: [
          {
            id: 'run-1',
            report_id: 'r1',
            kind: 'invoice',
            event_type: 'verify',
            cause: 'manual',
            reason: null,
            actor_type: 'user',
            actor_id: 'u1',
            actor_role: 'finance',
            status: 'pass',
            summary: { status: 'pass' },
            content_hash: 'hash',
            hash_valid: true,
            legacy: false,
            checked_at: new Date('2026-11-21T08:00:00Z'),
            created_at: new Date('2026-11-21T08:00:00Z'),
          },
        ],
      })
      .mockResolvedValueOnce({
        rows: [
          {
            id: 'item-1',
            run_id: 'run-1',
            report_id: 'r1',
            kind: 'invoice',
            subject_id: 'inv-1',
            item_id: 'it-1',
            file_name: 'a.pdf',
            status: 'pass',
            result: { ok: true },
            content_hash: 'item-hash',
            hash_valid: true,
            created_at: new Date('2026-11-21T08:00:00Z'),
          },
        ],
      });

    const result = await new PgVerificationHistoryRepo().findRunsByReport({
      reportId: 'r1',
      limit: 5000,
      offset: -3,
    });

    expect(result.total).toBe(1);
    expect(result.limit).toBe(100);
    expect(result.offset).toBe(0);
    expect(result.items[0].items).toHaveLength(1);
    expect(result.items[0].hashValid).toBe(true);
    const [, listParams] = mockQuery.mock.calls[1];
    expect(listParams.slice(-2)).toEqual([100, 0]);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @sse/db test -- pg-verification-history-repo`
Expected: FAIL，`Cannot find module '../repositories/pg-verification-history-repo'`。

- [ ] **Step 3: 写仓储实现**

创建 `packages/db/src/repositories/pg-verification-history-repo.ts`：

```ts
import { randomUUID } from 'crypto';
import type {
  VerificationHistoryResponse,
  VerificationRun,
  VerificationRunItem,
} from '@sse/shared';
import type {
  InvalidateInvoiceReportInput,
  InvalidateReceiptInput,
  IVerificationHistoryRepo,
  RecordVerificationRunInput,
  VerificationHistoryQuery,
} from '@sse/core';
import { pool } from '../connection';
import type { Queryable } from '../transaction';

const RUN_COLUMNS = `id, report_id, kind, event_type, cause, reason, actor_type, actor_id,
  actor_role, status, summary, content_hash, legacy, checked_at, created_at`;
const ITEM_COLUMNS = `id, run_id, report_id, kind, subject_id, item_id, file_name,
  status, result, content_hash, created_at`;

function mapRun(row: any): VerificationRun {
  return {
    id: row.id,
    reportId: row.report_id,
    kind: row.kind,
    eventType: row.event_type,
    cause: row.cause,
    reason: row.reason ?? undefined,
    actorType: row.actor_type,
    actorId: row.actor_id ?? undefined,
    actorRole: row.actor_role ?? undefined,
    status: row.status,
    summary: row.summary,
    contentHash: row.content_hash,
    hashValid: row.hash_valid === true,
    legacy: row.legacy === true,
    checkedAt: row.checked_at,
    createdAt: row.created_at,
    items: [],
  };
}

function mapItem(row: any): VerificationRunItem {
  return {
    id: row.id,
    runId: row.run_id,
    reportId: row.report_id,
    kind: row.kind,
    subjectId: row.subject_id,
    itemId: row.item_id ?? undefined,
    fileName: row.file_name ?? undefined,
    status: row.status,
    result: row.result,
    hashValid: row.hash_valid === true,
    createdAt: row.created_at,
  };
}

function clampLimit(limit?: number): number {
  if (!limit || Number.isNaN(limit)) return 20;
  return Math.min(Math.max(Math.trunc(limit), 1), 100);
}

function clampOffset(offset?: number): number {
  if (!offset || Number.isNaN(offset)) return 0;
  return Math.max(Math.trunc(offset), 0);
}

export class PgVerificationHistoryRepo implements IVerificationHistoryRepo {
  async recordRun(
    input: RecordVerificationRunInput,
    db: Queryable = pool
  ): Promise<VerificationRun> {
    const runId = randomUUID();
    const checkedAt = input.checkedAt ?? new Date().toISOString();
    const { rows } = await db.query(
      `INSERT INTO verification_runs (
         id, report_id, kind, event_type, cause, reason, actor_type, actor_id,
         actor_role, status, summary, content_hash, legacy, checked_at, created_at
       ) VALUES (
         $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11,
         encode(sha256(convert_to($11::jsonb::text, 'UTF8')), 'hex'),
         $12, $13, NOW()
       )
       RETURNING ${RUN_COLUMNS}`,
      [
        runId,
        input.reportId,
        input.kind,
        input.eventType,
        input.cause,
        input.reason ?? null,
        input.actor.type,
        input.actor.id ?? null,
        input.actor.role ?? null,
        input.status,
        JSON.stringify(input.summary),
        input.legacy === true,
        checkedAt,
      ]
    );

    const run = mapRun(rows[0]);
    for (const item of input.items) {
      const { rows: itemRows } = await db.query(
        `INSERT INTO verification_run_items (
           id, run_id, report_id, kind, subject_id, item_id, file_name, status,
           result, content_hash, created_at
         ) VALUES (
           $1, $2, $3, $4, $5, $6, $7, $8, $9,
           encode(sha256(convert_to($9::jsonb::text, 'UTF8')), 'hex'),
           NOW()
         )
         RETURNING ${ITEM_COLUMNS}`,
        [
          randomUUID(),
          runId,
          input.reportId,
          input.kind,
          item.subjectId,
          item.itemId ?? null,
          item.fileName ?? null,
          item.status,
          JSON.stringify(item.result),
        ]
      );
      run.items.push(mapItem(itemRows[0]));
    }

    return run;
  }

  async invalidateInvoiceReport(
    input: InvalidateInvoiceReportInput,
    db: Queryable = pool
  ): Promise<{ runId: string; affected: number } | null> {
    const { rows } = await db.query(
      `SELECT
         i.id,
         i.item_id,
         i.file_name,
         i.verification_status,
         i.verification_result,
         i.verified_at,
         prev.run_id AS previous_run_id
       FROM invoices i
       JOIN expense_items ei ON ei.id = i.item_id
       LEFT JOIN LATERAL (
         SELECT vri.run_id
           FROM verification_run_items vri
           JOIN verification_runs vr ON vr.id = vri.run_id
          WHERE vri.subject_id = i.id
            AND vr.event_type = 'verify'
          ORDER BY vri.created_at DESC, vri.id DESC
          LIMIT 1
       ) prev ON true
      WHERE ei.report_id = $1
        AND (i.verification_result IS NOT NULL OR i.verification_status <> 'pending')
      FOR UPDATE OF i`,
      [input.reportId]
    );

    if (rows.length === 0) return null;

    const run = await this.recordRun(
      {
        reportId: input.reportId,
        kind: 'invoice',
        eventType: 'invalidate',
        cause: input.cause,
        reason: input.reason ?? null,
        actor: input.actor,
        status: 'invalidated',
        summary: {
          status: 'invalidated',
          affected: rows.length,
          note: input.reason ?? undefined,
        },
        items: rows.map((row: any) => ({
          subjectId: row.id,
          itemId: row.item_id,
          fileName: row.file_name,
          status: 'invalidated',
          result: {
            event: 'invalidated',
            previousStatus: row.verification_status,
            previousVerifiedAt: row.verified_at,
            previousRunId: row.previous_run_id ?? null,
          },
        })),
      },
      db
    );

    await db.query(
      `UPDATE invoices
          SET verification_status = 'pending',
              verification_result = NULL,
              verified_at = NULL
        WHERE id = ANY($1)`,
      [rows.map((row: any) => row.id)]
    );

    return { runId: run.id, affected: rows.length };
  }

  async invalidateReceipt(
    input: InvalidateReceiptInput,
    db: Queryable = pool
  ): Promise<{ runId: string; affected: number } | null> {
    const { rows } = await db.query(
      `SELECT
         pr.id,
         pr.report_id,
         pr.file_name,
         pr.verification_status,
         pr.verification_result,
         pr.verified_at,
         prev.run_id AS previous_run_id
       FROM payment_receipts pr
       LEFT JOIN LATERAL (
         SELECT vri.run_id
           FROM verification_run_items vri
           JOIN verification_runs vr ON vr.id = vri.run_id
          WHERE vri.subject_id = pr.id
            AND vr.event_type = 'verify'
          ORDER BY vri.created_at DESC, vri.id DESC
          LIMIT 1
       ) prev ON true
      WHERE pr.id = $1
        AND pr.report_id = $2
        AND (pr.verification_result IS NOT NULL OR pr.verification_status <> 'pending')
      FOR UPDATE OF pr`,
      [input.receiptId, input.reportId]
    );

    if (rows.length === 0) return null;

    const row = rows[0];
    const run = await this.recordRun(
      {
        reportId: input.reportId,
        kind: 'payment_receipt',
        eventType: 'invalidate',
        cause: input.cause,
        reason: input.reason ?? null,
        actor: input.actor,
        status: 'invalidated',
        summary: {
          status: 'invalidated',
          affected: 1,
          note: input.reason ?? undefined,
        },
        items: [
          {
            subjectId: row.id,
            itemId: null,
            fileName: row.file_name,
            status: 'invalidated',
            result: {
              event: 'invalidated',
              previousStatus: row.verification_status,
              previousVerifiedAt: row.verified_at,
              previousRunId: row.previous_run_id ?? null,
            },
          },
        ],
      },
      db
    );

    await db.query(
      `UPDATE payment_receipts
          SET verification_status = 'pending',
              verification_result = NULL,
              verified_at = NULL
        WHERE id = $1`,
      [row.id]
    );

    return { runId: run.id, affected: 1 };
  }

  async findRunsByReport(
    query: VerificationHistoryQuery,
    db: Queryable = pool
  ): Promise<VerificationHistoryResponse> {
    const limit = clampLimit(query.limit);
    const offset = clampOffset(query.offset);
    const values: any[] = [query.reportId];
    let where = 'WHERE report_id = $1';
    if (query.kind) {
      values.push(query.kind);
      where += ` AND kind = $${values.length}`;
    }

    const countResult = await db.query(
      `SELECT COUNT(*)::int AS count FROM verification_runs ${where}`,
      values
    );
    const total = Number(countResult.rows[0]?.count ?? 0);

    const listValues = [...values, limit, offset];
    const { rows } = await db.query(
      `SELECT ${RUN_COLUMNS},
              (content_hash = encode(sha256(convert_to(summary::text, 'UTF8')), 'hex')) AS hash_valid
         FROM verification_runs
         ${where}
        ORDER BY checked_at DESC, id DESC
        LIMIT $${listValues.length - 1}
       OFFSET $${listValues.length}`,
      listValues
    );

    const runs = rows.map(mapRun);
    if (runs.length > 0) {
      const { rows: itemRows } = await db.query(
        `SELECT ${ITEM_COLUMNS},
                (content_hash = encode(sha256(convert_to(result::text, 'UTF8')), 'hex')) AS hash_valid
           FROM verification_run_items
          WHERE run_id = ANY($1)
          ORDER BY created_at ASC, id ASC`,
        [runs.map((run) => run.id)]
      );
      const byRun = new Map<string, VerificationRunItem[]>();
      for (const row of itemRows) {
        const item = mapItem(row);
        const list = byRun.get(item.runId) ?? [];
        list.push(item);
        byRun.set(item.runId, list);
      }
      for (const run of runs) {
        run.items = byRun.get(run.id) ?? [];
      }
    }

    return { items: runs, total, limit, offset };
  }

  async findLatestVerifyRunId(
    subjectId: string,
    db: Queryable = pool
  ): Promise<string | null> {
    const { rows } = await db.query(
      `SELECT vri.run_id
         FROM verification_run_items vri
         JOIN verification_runs vr ON vr.id = vri.run_id
        WHERE vri.subject_id = $1
          AND vr.event_type = 'verify'
        ORDER BY vri.created_at DESC, vri.id DESC
        LIMIT 1`,
      [subjectId]
    );
    return rows[0]?.run_id ?? null;
  }
}
```

- [ ] **Step 4: 导出仓储**

在 `packages/db/src/repositories/index.ts` 追加：

```ts
export { PgVerificationHistoryRepo } from './pg-verification-history-repo';
```

- [ ] **Step 5: 运行测试**

Run: `pnpm --filter @sse/db test -- pg-verification-history-repo`
Expected: PASS，4 tests passed。

Run: `pnpm --filter @sse/db build`
Expected: 构建成功。

- [ ] **Step 6: 提交**

```bash
git add packages/db/src/repositories/pg-verification-history-repo.ts \
  packages/db/src/repositories/index.ts \
  packages/db/src/__tests__/pg-verification-history-repo.test.ts
git commit -m "feat(db): persist append-only verification history"
```

---

## Task 6: API 发票核对写入与历史读取

**Files:**
- Modify: `packages/api/src/routes/expenses.ts`
- Create: `packages/api/src/__tests__/expenses-verification-history.test.ts`
- Create: `packages/api/src/__tests__/expenses-verification-capture.test.ts`

- [ ] **Step 1: 写失败测试（历史读取）**

创建 `packages/api/src/__tests__/expenses-verification-history.test.ts`：

```ts
const mockQuery = jest.fn();
const mockFindById = jest.fn();
const mockFindRunsByReport = jest.fn();

jest.mock('@sse/ai', () => ({ MINERU_PARSER_VERSION: 1 }));
jest.mock('../services/ai-engines', () => ({ createOCREngine: jest.fn() }));
jest.mock('../services/notifications', () => ({ sendNotificationSafe: jest.fn() }));
jest.mock('../services/audit', () => ({ auditFromRequest: jest.fn() }));
jest.mock('../services/payment-receipt-verifier', () => ({
  queuePaymentReceiptVerification: jest.fn(),
  runPaymentReceiptVerification: jest.fn(),
}));
jest.mock('../storage/minio-storage', () => ({
  MinioStorage: jest.fn().mockImplementation(() => ({ calculateChecksum: jest.fn() })),
}));

jest.mock('@sse/db', () => ({
  pool: { query: (...args: any[]) => mockQuery(...args) },
  withTransaction: jest.fn(async (_pool: any, fn: any) =>
    fn({ query: (...args: any[]) => mockQuery(...args) })
  ),
  PgExpenseRepo: jest.fn().mockImplementation(() => ({ findById: mockFindById })),
  PgReportSnapshotRepo: jest.fn().mockImplementation(() => ({})),
  PgVerificationHistoryRepo: jest.fn().mockImplementation(() => ({
    findRunsByReport: mockFindRunsByReport,
  })),
  PgInvoiceRepo: jest.fn().mockImplementation(() => ({})),
  PgApprovalRuleRepo: jest.fn().mockImplementation(() => ({ findActive: jest.fn(async () => []) })),
  PgApprovalRecordRepo: jest.fn().mockImplementation(() => ({ findByReportId: jest.fn(async () => []) })),
  PgUserRepo: jest.fn().mockImplementation(() => ({ findById: jest.fn() })),
  PgPaymentReceiptRepo: jest.fn().mockImplementation(() => ({})),
  PgPaymentAuditRepo: jest.fn().mockImplementation(() => ({})),
}));

import express from 'express';
import type { AddressInfo } from 'net';
import type { Server } from 'http';
import { signToken } from '@sse/auth';
import { expenseRoutes } from '../routes/expenses';
import { errorHandler } from '../middleware/error';

let url: string;
let server: Server;

function listen(app: express.Express): Promise<{ url: string; server: Server }> {
  return new Promise((resolve) => {
    const instance = app.listen(0, '127.0.0.1', () => {
      const { port } = instance.address() as AddressInfo;
      resolve({ url: `http://127.0.0.1:${port}`, server: instance });
    });
  });
}

beforeAll(async () => {
  jest.spyOn(console, 'error').mockImplementation(() => {});
  const app = express();
  app.use(express.json());
  app.use('/expenses', expenseRoutes);
  app.use(errorHandler);
  ({ url, server } = await listen(app));
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  (console.error as jest.Mock).mockRestore();
});

beforeEach(() => {
  jest.clearAllMocks();
  mockQuery.mockResolvedValue({ rows: [] });
});

const report = {
  id: 'r1',
  serialNo: 'RE-1',
  userId: 'owner-1',
  title: '差旅',
  totalAmount: 100,
  status: 'approved',
  currentStep: 1,
  createdAt: new Date(),
  updatedAt: new Date(),
};

function runFixture(kind: 'invoice' | 'payment_receipt') {
  return {
    id: `run-${kind}`,
    reportId: 'r1',
    kind,
    eventType: 'verify',
    cause: 'manual',
    actorType: 'user',
    actorId: 'u1',
    actorRole: 'employee',
    status: 'pass',
    summary: { status: 'pass', summary: '通过' },
    contentHash: 'h',
    hashValid: true,
    legacy: false,
    checkedAt: '2026-11-21T08:00:00Z',
    createdAt: '2026-11-21T08:00:00Z',
    items: [
      {
        id: `item-${kind}`,
        runId: `run-${kind}`,
        reportId: 'r1',
        kind,
        subjectId: kind === 'invoice' ? 'inv-1' : 'receipt-1',
        itemId: kind === 'invoice' ? 'it-1' : null,
        fileName: kind === 'invoice' ? 'a.pdf' : 'receipt.pdf',
        status: 'pass',
        result:
          kind === 'invoice'
            ? { duplicates: [{ invoiceId: 'inv-2', serialNo: 'RE-2' }], ocr: { invoiceNo: 'NO-1' } }
            : { duplicateReceipts: [{ receiptId: 'receipt-2', serialNo: 'RE-3' }] },
        hashValid: true,
        createdAt: '2026-11-21T08:00:00Z',
      },
    ],
  };
}

describe('GET /expenses/:id/verification-history', () => {
  it('returns invoice history and masks duplicates for employees', async () => {
    mockFindById.mockResolvedValue(report);
    mockQuery.mockResolvedValue({ rows: [{ department: '技术部' }] });
    mockFindRunsByReport.mockResolvedValue({
      items: [runFixture('invoice')],
      total: 1,
      limit: 20,
      offset: 0,
    });
    const token = signToken({ userId: 'owner-1', role: 'employee', department: '技术部' });

    const response = await fetch(`${url}/expenses/r1/verification-history`, {
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.status).toBe(200);
    const body = (await response.json()) as any;
    expect(body.items[0].items[0].result.duplicates).toEqual([{ restricted: true }]);
    expect(mockFindRunsByReport).toHaveBeenCalledWith(
      expect.objectContaining({ reportId: 'r1', kind: 'invoice' })
    );
  });

  it('keeps receipt history for finance and full duplicates', async () => {
    mockFindById.mockResolvedValue(report);
    mockFindRunsByReport.mockResolvedValue({
      items: [runFixture('invoice'), runFixture('payment_receipt')],
      total: 2,
      limit: 20,
      offset: 0,
    });
    const token = signToken({ userId: 'fin-1', role: 'finance', department: '财务部' });

    const response = await fetch(`${url}/expenses/r1/verification-history?kind=all`, {
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.status).toBe(200);
    const body = (await response.json()) as any;
    expect(body.items).toHaveLength(2);
    expect(body.items[0].items[0].result.duplicates[0].serialNo).toBe('RE-2');
    expect(mockFindRunsByReport).toHaveBeenCalledWith(
      expect.objectContaining({ reportId: 'r1', kind: undefined })
    );
  });

  it('blocks receipt history for non-finance roles', async () => {
    mockFindById.mockResolvedValue(report);
    mockQuery.mockResolvedValue({ rows: [{ department: '技术部' }] });
    const token = signToken({ userId: 'owner-1', role: 'employee', department: '技术部' });

    const response = await fetch(
      `${url}/expenses/r1/verification-history?kind=payment_receipt`,
      { headers: { authorization: `Bearer ${token}` } }
    );

    expect(response.status).toBe(403);
    expect(mockFindRunsByReport).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: 写失败测试（核对写入）**

创建 `packages/api/src/__tests__/expenses-verification-capture.test.ts`：

```ts
const mockQuery = jest.fn();
const mockFindById = jest.fn();
const mockRecordRun = jest.fn();
const mockInvalidateInvoiceReport = jest.fn();

jest.mock('@sse/ai', () => ({ MINERU_PARSER_VERSION: 1 }));
jest.mock('../services/ai-engines', () => ({ createOCREngine: jest.fn() }));
jest.mock('../services/notifications', () => ({ sendNotificationSafe: jest.fn() }));
jest.mock('../services/audit', () => ({ auditFromRequest: jest.fn() }));
jest.mock('../services/payment-receipt-verifier', () => ({
  queuePaymentReceiptVerification: jest.fn(),
  runPaymentReceiptVerification: jest.fn(),
}));
jest.mock('../storage/minio-storage', () => ({
  MinioStorage: jest.fn().mockImplementation(() => ({ calculateChecksum: jest.fn() })),
}));

jest.mock('@sse/db', () => ({
  pool: { query: (...args: any[]) => mockQuery(...args) },
  withTransaction: jest.fn(async (_pool: any, fn: any) =>
    fn({ query: (...args: any[]) => mockQuery(...args) })
  ),
  PgExpenseRepo: jest.fn().mockImplementation(() => ({ findById: mockFindById })),
  PgReportSnapshotRepo: jest.fn().mockImplementation(() => ({})),
  PgVerificationHistoryRepo: jest.fn().mockImplementation(() => ({
    recordRun: mockRecordRun,
    invalidateInvoiceReport: mockInvalidateInvoiceReport,
  })),
  PgInvoiceRepo: jest.fn().mockImplementation(() => ({
    updateOcrResult: jest.fn(),
    updateVerification: jest.fn(),
    findDuplicatesByInvoiceNo: jest.fn(async () => []),
  })),
  PgApprovalRuleRepo: jest.fn().mockImplementation(() => ({ findActive: jest.fn(async () => []) })),
  PgApprovalRecordRepo: jest.fn().mockImplementation(() => ({ findByReportId: jest.fn(async () => []) })),
  PgUserRepo: jest.fn().mockImplementation(() => ({ findById: jest.fn() })),
  PgPaymentReceiptRepo: jest.fn().mockImplementation(() => ({})),
  PgPaymentAuditRepo: jest.fn().mockImplementation(() => ({})),
}));

import express from 'express';
import type { AddressInfo } from 'net';
import type { Server } from 'http';
import { signToken } from '@sse/auth';
import { expenseRoutes } from '../routes/expenses';
import { errorHandler } from '../middleware/error';

let url: string;
let server: Server;

function listen(app: express.Express): Promise<{ url: string; server: Server }> {
  return new Promise((resolve) => {
    const instance = app.listen(0, '127.0.0.1', () => {
      const { port } = instance.address() as AddressInfo;
      resolve({ url: `http://127.0.0.1:${port}`, server: instance });
    });
  });
}

beforeAll(async () => {
  jest.spyOn(console, 'error').mockImplementation(() => {});
  const app = express();
  app.use(express.json());
  app.use('/expenses', expenseRoutes);
  app.use(errorHandler);
  ({ url, server } = await listen(app));
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  (console.error as jest.Mock).mockRestore();
});

beforeEach(() => {
  jest.clearAllMocks();
  mockQuery.mockResolvedValue({ rows: [] });
});

const report = {
  id: 'r1',
  serialNo: 'RE-1',
  userId: 'owner-1',
  title: '差旅',
  totalAmount: 100,
  status: 'draft',
  currentStep: 0,
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe('POST /expenses/:id/verify history capture', () => {
  it('records a no_invoices run when the report has no invoices', async () => {
    mockFindById.mockResolvedValue(report);
    mockQuery
      .mockResolvedValueOnce({ rows: [{ department: '技术部' }] }) // assertReportAccess
      .mockResolvedValueOnce({ rows: [] }) // initial invoice preload
      .mockResolvedValueOnce({ rows: [{ total_amount: '100' }] }) // report lock
      .mockResolvedValueOnce({ rows: [] }) // items inside transaction
      .mockResolvedValueOnce({ rows: [] }); // invoices inside transaction
    mockRecordRun.mockResolvedValue({ id: 'run-1' });
    const token = signToken({ userId: 'owner-1', role: 'employee', department: '技术部' });

    const response = await fetch(`${url}/expenses/r1/verify`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({}),
    });

    expect(response.status).toBe(200);
    expect(mockRecordRun).toHaveBeenCalledTimes(1);
    const input = mockRecordRun.mock.calls[0][0];
    expect(input).toMatchObject({
      reportId: 'r1',
      kind: 'invoice',
      eventType: 'verify',
      cause: 'manual',
      status: 'no_invoices',
    });
    expect(input.items).toEqual([]);
    expect(mockRecordRun.mock.calls[0][1]).toBeTruthy();
  });
});
```

- [ ] **Step 3: 运行确认失败**

Run: `pnpm --filter @sse/api test -- expenses-verification`
Expected: FAIL：`GET .../verification-history` 404；`recordRun` 未调用。

- [ ] **Step 4: 更新 expenses.ts 导入与实例**

在 `packages/api/src/routes/expenses.ts` 顶部：

1. 从 `@sse/db` 导入 `PgVerificationHistoryRepo`。
2. 从 `@sse/core` 导入 `redactVerificationHistory`。
3. 创建实例：

```ts
const historyRepo = new PgVerificationHistoryRepo();
```

- [ ] **Step 5: 重写发票核对路由**

将 `router.post('/:id/verify', ...)` 整体替换为：

```ts
router.post(
  '/:id/verify',
  asyncWrap(async (req, res) => {
    const force = req.body?.force === true;
    const report = await expenseRepo.findById(req.params.id);
    if (!report) throw new AppError(404, 'NOT_FOUND', '报销单不存在');

    await assertReportAccess(report, req.user!);
    if (force && !canWriteReport(req.user!.role as UserRole, req.user!.userId, report.userId)) {
      throw new AppError(403, 'UNAUTHORIZED', '仅单据本人或财务/管理员可强制重新识别');
    }

    const { rows: invoiceRows } = await pool.query(
      `SELECT i.*
         FROM invoices i
         JOIN expense_items ei ON ei.id = i.item_id
        WHERE ei.report_id = $1`,
      [report.id]
    );

    const needsOcr = invoiceRows.some((row: any) =>
      shouldReOcr(row.ocr_result, force, MINERU_PARSER_VERSION)
    );
    const engine = needsOcr ? createOCREngine() : null;
    const ocrByInvoiceId = new Map<string, any>();
    const ocrErrorByInvoiceId = new Map<string, string>();

    for (const row of invoiceRows) {
      const invoice = mapInvoiceRow(row);
      if (!shouldReOcr(invoice.ocrResult, force, MINERU_PARSER_VERSION)) {
        if (invoice.ocrResult) ocrByInvoiceId.set(invoice.id, invoice.ocrResult);
        continue;
      }
      if (!engine) {
        ocrErrorByInvoiceId.set(invoice.id, '发票 OCR 引擎未启用');
        continue;
      }
      try {
        const buffer = await minio.getObject(invoice.storageKey, invoice.storageBucket);
        const ocr = await engine.parseInvoice(buffer, invoice.fileName);
        ocrByInvoiceId.set(invoice.id, ocr);
      } catch (error: any) {
        ocrErrorByInvoiceId.set(invoice.id, error?.message || '发票识别失败');
      }
    }

    const canSeeDuplicateDetails =
      req.user!.role === UserRole.ADMIN ||
      req.user!.role === UserRole.FINANCE ||
      req.user!.role === UserRole.DEPT_APPROVER;

    const summary = await withTransaction(pool, async (client) => {
      const { rows: lockedReportRows } = await client.query(
        'SELECT total_amount FROM expense_reports WHERE id = $1 FOR UPDATE',
        [report.id]
      );
      const reportTotal = Number(lockedReportRows[0]?.total_amount ?? report.totalAmount);

      const { rows: itemRows } = await client.query(
        'SELECT * FROM expense_items WHERE report_id = $1 ORDER BY expense_date',
        [report.id]
      );
      const items = itemRows.map(mapItemRow);
      const itemIds = items.map((item: any) => item.id);

      const { rows: freshInvoiceRows } = itemIds.length > 0
        ? await client.query('SELECT * FROM invoices WHERE item_id = ANY($1)', [itemIds])
        : { rows: [] as any[] };

      const sources: VerificationSourceInvoice[] = [];
      for (const row of freshInvoiceRows) {
        const invoice = mapInvoiceRow(row);
        const reOcrNeeded = shouldReOcr(
          invoice.ocrResult,
          force,
          MINERU_PARSER_VERSION
        );
        const ocr = reOcrNeeded
          ? (ocrByInvoiceId.get(invoice.id) ?? null)
          : (invoice.ocrResult ?? null);
        if (ocr && (!invoice.ocrResult || (ocr.invoiceNo && !invoice.invoiceNo))) {
          await invoiceRepo.updateOcrResult(invoice.id, ocr, ocr.invoiceNo, client);
        }
        const duplicates = ocr?.invoiceNo
          ? (
              await invoiceRepo.findDuplicatesByInvoiceNo(
                ocr.invoiceNo,
                invoice.id,
                client
              )
            ).map((duplicate) =>
              canSeeDuplicateDetails
                ? duplicate
                : { invoiceId: duplicate.invoiceId, restricted: true }
            )
          : [];
        sources.push({
          id: invoice.id,
          itemId: invoice.itemId,
          fileName: invoice.fileName,
          ocrResult: ocr,
          ocrError: reOcrNeeded ? ocrErrorByInvoiceId.get(invoice.id) : undefined,
          duplicates,
        });
      }

      const freshSummary = verifyInvoices({
        reportTotal,
        items: items.map((item: any) => ({
          id: item.id,
          amount: item.amount,
          expenseDate: item.expenseDate,
        })),
        invoices: sources,
      });

      const sourcesById = new Map(sources.map((source) => [source.id, source]));
      const historyStatus =
        freshSummary.status === 'pending' ? 'unverified' : freshSummary.status;
      const historyItems: any[] = [];
      for (const view of freshSummary.invoices) {
        const source = sourcesById.get(view.invoiceId);
        const itemStatus = view.status === 'pending' ? 'unverified' : view.status;
        const result = {
          status: itemStatus,
          checks: view.checks,
          summary: view.message || '',
          checkedAt: freshSummary.checkedAt,
          ocr: source?.ocrResult ?? undefined,
          duplicates: view.duplicates,
        };
        await invoiceRepo.updateVerification(view.invoiceId, view.status, result, client);
        historyItems.push({
          subjectId: view.invoiceId,
          itemId: view.itemId,
          fileName: view.fileName,
          status: itemStatus,
          result,
        });
      }

      await historyRepo.recordRun(
        {
          reportId: report.id,
          kind: 'invoice',
          eventType: 'verify',
          cause: force ? 'force_ocr' : 'manual',
          actor: { type: 'user', id: req.user!.userId, role: req.user!.role },
          status: historyStatus,
          summary: {
            status: historyStatus,
            checkedAt: freshSummary.checkedAt,
            summary: freshSummary.summary,
            counts: freshSummary.counts,
            checks: freshSummary.checks,
          },
          checkedAt: freshSummary.checkedAt,
          items: historyItems,
        },
        client
      );

      return freshSummary;
    });

    res.json(summary);
  })
);
```

- [ ] **Step 6: 新增历史读取路由**

在 snapshots 路由之后添加：

```ts
router.get(
  '/:id/verification-history',
  asyncWrap(async (req, res) => {
    const report = await expenseRepo.findById(req.params.id);
    if (!report) throw new AppError(404, 'NOT_FOUND', '报销单不存在');
    await assertReportAccess(report, req.user!);

    const role = req.user!.role;
    const canSeeReceipts = role === UserRole.FINANCE || role === UserRole.ADMIN;
    const requestedKind = req.query.kind as string | undefined;

    let kind: 'invoice' | 'payment_receipt' | undefined;
    if (requestedKind === 'invoice') {
      kind = 'invoice';
    } else if (requestedKind === 'payment_receipt') {
      if (!canSeeReceipts) {
        throw new AppError(403, 'UNAUTHORIZED', '仅财务或管理员可查看回单核对历史');
      }
      kind = 'payment_receipt';
    } else {
      kind = canSeeReceipts ? undefined : 'invoice';
    }

    const result = await historyRepo.findRunsByReport({
      reportId: report.id,
      kind,
      limit: req.query.limit ? Number(req.query.limit) : undefined,
      offset: req.query.offset ? Number(req.query.offset) : undefined,
    });

    const canSeeDuplicates =
      canSeeReceipts || role === UserRole.DEPT_APPROVER;
    const items = result.items
      .map((run) =>
        redactVerificationHistory(run, { canSeeDuplicates, canSeeReceipts })
      )
      .filter((run): run is NonNullable<typeof run> => run !== null);

    res.json({ ...result, items });
  })
);
```

- [ ] **Step 7: 运行测试**

Run: `pnpm --filter @sse/api test -- expenses-verification`
Expected: PASS。

- [ ] **Step 8: 提交**

```bash
git add packages/api/src/routes/expenses.ts \
  packages/api/src/__tests__/expenses-verification-history.test.ts \
  packages/api/src/__tests__/expenses-verification-capture.test.ts
git commit -m "feat(api): record invoice verification history"
```

---

## Task 7: API 明细修改/发票上传失效历史

**Files:**
- Modify: `packages/api/src/routes/expenses.ts`
- Modify: `packages/api/src/__tests__/expenses-verification-capture.test.ts`

- [ ] **Step 1: 扩展 capture 测试的 mock 与用例**

在 `packages/api/src/__tests__/expenses-verification-capture.test.ts` 顶部 mock 区做三处修改。

1. 增加发票仓储与上传中间件 mock：

```ts
const mockInvoiceCreate = jest.fn();

jest.mock('../middleware/upload', () => ({
  uploadInvoice: {
    single: () => (req: any, _res: any, next: any) => {
      req.file = {
        originalname: 'a.pdf',
        buffer: Buffer.from('%PDF-1.4'),
        size: 8,
        mimetype: 'application/pdf',
      };
      next();
    },
  },
  uploadPaymentReceipt: {
    single: () => (req: any, _res: any, next: any) => {
      req.file = {
        originalname: 'receipt.pdf',
        buffer: Buffer.from('%PDF-1.4'),
        size: 8,
        mimetype: 'application/pdf',
      };
      next();
    },
  },
  validateUploadSignature: () => 'pdf',
}));
```

2. Minio mock 增加 `upload`：

```ts
jest.mock('../storage/minio-storage', () => ({
  MinioStorage: jest.fn().mockImplementation(() => ({
    calculateChecksum: jest.fn(() => 'checksum'),
    upload: jest.fn(),
    getObject: jest.fn(),
  })),
}));
```

3. `pool` 增加 `connect`，`PgInvoiceRepo` 增加 `create`：

```ts
jest.mock('@sse/db', () => ({
  pool: {
    query: (...args: any[]) => mockQuery(...args),
    connect: jest.fn(async () => ({
      query: (...args: any[]) => mockQuery(...args),
      release: jest.fn(),
    })),
  },
  withTransaction: jest.fn(async (_pool: any, fn: any) =>
    fn({ query: (...args: any[]) => mockQuery(...args) })
  ),
  PgExpenseRepo: jest.fn().mockImplementation(() => ({ findById: mockFindById })),
  PgReportSnapshotRepo: jest.fn().mockImplementation(() => ({})),
  PgVerificationHistoryRepo: jest.fn().mockImplementation(() => ({
    recordRun: mockRecordRun,
    invalidateInvoiceReport: mockInvalidateInvoiceReport,
  })),
  PgInvoiceRepo: jest.fn().mockImplementation(() => ({
    create: (...args: any[]) => mockInvoiceCreate(...args),
    updateOcrResult: jest.fn(),
    updateVerification: jest.fn(),
    findDuplicatesByInvoiceNo: jest.fn(async () => []),
  })),
  PgApprovalRuleRepo: jest.fn().mockImplementation(() => ({ findActive: jest.fn(async () => []) })),
  PgApprovalRecordRepo: jest.fn().mockImplementation(() => ({ findByReportId: jest.fn(async () => []) })),
  PgUserRepo: jest.fn().mockImplementation(() => ({ findById: jest.fn() })),
  PgPaymentReceiptRepo: jest.fn().mockImplementation(() => ({})),
  PgPaymentAuditRepo: jest.fn().mockImplementation(() => ({})),
}));
```

4. 在文件末尾追加两个用例：

```ts
describe('PUT /expenses/:id verification invalidation', () => {
  it('records an items_updated invalidation in the edit transaction', async () => {
    mockFindById.mockResolvedValue(report);
    mockQuery
      .mockResolvedValueOnce({ rows: [] }) // BEGIN
      .mockResolvedValueOnce({ rows: [] }) // report lock
      .mockResolvedValueOnce({ rows: [{ id: 'it-1' }] }) // existing item ids
      .mockResolvedValueOnce({ rows: [] }) // update item
      .mockResolvedValueOnce({ rows: [] }) // update report total
      .mockResolvedValueOnce({ rows: [] }); // COMMIT
    mockInvalidateInvoiceReport.mockResolvedValue({ runId: 'run-inv', affected: 1 });
    const token = signToken({ userId: 'owner-1', role: 'employee', department: '技术部' });

    const response = await fetch(`${url}/expenses/r1`, {
      method: 'PUT',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        items: [
          {
            id: 'it-1',
            categoryId: 'c1',
            amount: 100,
            expenseDate: '2026-11-21',
            description: 'x',
          },
        ],
      }),
    });

    expect(response.status).toBe(200);
    expect(mockInvalidateInvoiceReport).toHaveBeenCalledWith(
      expect.objectContaining({ reportId: 'r1', cause: 'items_updated' }),
      expect.anything()
    );
  });
});

describe('POST /expenses/:id/items/:itemId/invoice invalidation', () => {
  it('records an invoice_uploaded invalidation', async () => {
    mockFindById.mockResolvedValue(report);
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 'it-1' }] }) // item check
      .mockResolvedValueOnce({ rows: [] }); // report lock inside transaction
    mockInvoiceCreate.mockResolvedValue({
      id: 'inv-1',
      itemId: 'it-1',
      fileName: 'a.pdf',
    });
    mockInvalidateInvoiceReport.mockResolvedValue({ runId: 'run-inv', affected: 1 });
    const token = signToken({ userId: 'owner-1', role: 'employee', department: '技术部' });

    const response = await fetch(`${url}/expenses/r1/items/it-1/invoice`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.status).toBe(201);
    expect(mockInvalidateInvoiceReport).toHaveBeenCalledWith(
      expect.objectContaining({ reportId: 'r1', cause: 'invoice_uploaded' }),
      expect.anything()
    );
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @sse/api test -- expenses-verification-capture`
Expected: FAIL，`invalidateInvoiceReport` 未调用。

- [ ] **Step 3: 修改 PUT 路由**

在 `PUT /:id` 的事务开始处（`BEGIN` 之后）加锁：

```ts
await client.query('SELECT id FROM expense_reports WHERE id = $1 FOR UPDATE', [id]);
```

在 `const plan = planItemSync(...)` 之后、执行任何 `UPDATE/INSERT/DELETE expense_items` 之前，调用失效（这样即将被删除的明细所挂发票也会进入失效事件）：

```ts
await historyRepo.invalidateInvoiceReport(
  {
    reportId: id,
    cause: 'items_updated',
    reason: '费用明细修改，原核对结果失效',
    actor: { type: 'user', id: req.user!.userId, role: req.user!.role },
  },
  client
);
```

然后删除块尾原有的重置 SQL：

```ts
await client.query(
  `UPDATE invoices
      SET verification_status = 'pending', verification_result = NULL, verified_at = NULL
    WHERE item_id IN (SELECT id FROM expense_items WHERE report_id = $1)`,
  [id]
);
```

`invalidateInvoiceReport` 已负责重置当前列，无需再执行这段 SQL。

- [ ] **Step 4: 修改发票上传路由**

将 `POST /:id/items/:itemId/invoice` 中从 `const invoice = await invoiceRepo.create(...)` 到重置 SQL 结束的部分替换为：

```ts
const invoice = await withTransaction(pool, async (client) => {
  await client.query('SELECT id FROM expense_reports WHERE id = $1 FOR UPDATE', [req.params.id]);

  const created = await invoiceRepo.create(
    {
      itemId,
      fileName: req.file!.originalname,
      fileFormat: ext,
      fileSize: req.file!.size,
      storageKey,
      storageBucket: 'invoices',
      checksum,
    },
    client
  );

  await historyRepo.invalidateInvoiceReport(
    {
      reportId: req.params.id,
      cause: 'invoice_uploaded',
      reason: '发票上传/替换，原核对结果失效',
      actor: { type: 'user', id: req.user!.userId, role: req.user!.role },
    },
    client
  );

  return created;
});

res.status(201).json(invoice);
```

- [ ] **Step 5: 运行测试与构建**

Run: `pnpm --filter @sse/api test -- expenses-verification`
Expected: PASS。

Run: `pnpm --filter @sse/api build`
Expected: 构建成功。

- [ ] **Step 6: 提交**

```bash
git add packages/api/src/routes/expenses.ts packages/api/src/__tests__/expenses-verification-capture.test.ts
git commit -m "feat(api): record verification invalidation on edits and invoice uploads"
```

---

## Task 8: API 回单核对历史与上传失效

**Files:**
- Modify: `packages/api/src/services/payment-receipt-verifier.ts`
- Modify: `packages/api/src/routes/expenses.ts`
- Create: `packages/api/src/__tests__/payment-receipt-history.test.ts`

- [ ] **Step 1: 写失败测试（路由传递 actor）**

创建 `packages/api/src/__tests__/payment-receipt-history.test.ts`：

```ts
const mockQuery = jest.fn();
const mockRunVerification = jest.fn();
const mockFindById = jest.fn();
const mockReceiptFindById = jest.fn();
const mockReceiptFindByReportId = jest.fn();
const mockReceiptUpsert = jest.fn();
const mockInvalidateReceipt = jest.fn();

jest.mock('@sse/ai', () => ({ MINERU_PARSER_VERSION: 1 }));
jest.mock('../services/ai-engines', () => ({ createOCREngine: jest.fn() }));
jest.mock('../services/notifications', () => ({ sendNotificationSafe: jest.fn() }));
jest.mock('../services/audit', () => ({ auditFromRequest: jest.fn() }));
jest.mock('../services/payment-receipt-verifier', () => ({
  queuePaymentReceiptVerification: jest.fn(),
  runPaymentReceiptVerification: (...args: any[]) => mockRunVerification(...args),
}));
jest.mock('../middleware/upload', () => ({
  uploadInvoice: { single: () => (_req: any, _res: any, next: any) => next() },
  uploadPaymentReceipt: {
    single: () => (req: any, _res: any, next: any) => {
      req.file = {
        originalname: 'receipt.pdf',
        buffer: Buffer.from('%PDF-1.4'),
        size: 8,
        mimetype: 'application/pdf',
      };
      next();
    },
  },
  validateUploadSignature: () => 'pdf',
}));
jest.mock('../storage/minio-storage', () => ({
  MinioStorage: jest.fn().mockImplementation(() => ({
    calculateChecksum: jest.fn(() => 'checksum'),
    upload: jest.fn(),
    getObject: jest.fn(),
  })),
}));

jest.mock('@sse/db', () => ({
  pool: {
    query: (...args: any[]) => mockQuery(...args),
    connect: jest.fn(async () => ({
      query: (...args: any[]) => mockQuery(...args),
      release: jest.fn(),
    })),
  },
  withTransaction: jest.fn(async (_pool: any, fn: any) =>
    fn({ query: (...args: any[]) => mockQuery(...args) })
  ),
  PgExpenseRepo: jest.fn().mockImplementation(() => ({ findById: mockFindById })),
  PgReportSnapshotRepo: jest.fn().mockImplementation(() => ({})),
  PgVerificationHistoryRepo: jest.fn().mockImplementation(() => ({
    invalidateReceipt: mockInvalidateReceipt,
  })),
  PgInvoiceRepo: jest.fn().mockImplementation(() => ({})),
  PgApprovalRuleRepo: jest.fn().mockImplementation(() => ({ findActive: jest.fn(async () => []) })),
  PgApprovalRecordRepo: jest.fn().mockImplementation(() => ({})),
  PgUserRepo: jest.fn().mockImplementation(() => ({})),
  PgPaymentReceiptRepo: jest.fn().mockImplementation(() => ({
    findById: mockReceiptFindById,
    findByReportId: mockReceiptFindByReportId,
    upsert: (...args: any[]) => mockReceiptUpsert(...args),
  })),
  PgPaymentAuditRepo: jest.fn().mockImplementation(() => ({})),
}));

import express from 'express';
import type { AddressInfo } from 'net';
import type { Server } from 'http';
import { signToken } from '@sse/auth';
import { expenseRoutes } from '../routes/expenses';
import { errorHandler } from '../middleware/error';

let url: string;
let server: Server;

beforeAll(async () => {
  jest.spyOn(console, 'error').mockImplementation(() => {});
  const app = express();
  app.use(express.json());
  app.use('/expenses', expenseRoutes);
  app.use(errorHandler);
  await new Promise<void>((resolve) => {
    server = app.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      url = `http://127.0.0.1:${port}`;
      resolve();
    });
  });
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  (console.error as jest.Mock).mockRestore();
});

beforeEach(() => {
  jest.clearAllMocks();
});

it('passes the finance actor into receipt verification history', async () => {
  mockFindById.mockResolvedValue({ id: 'r1', status: 'paid', totalAmount: 100 });
  mockReceiptFindById.mockResolvedValue({ id: 'receipt-1', reportId: 'r1' });
  mockRunVerification.mockResolvedValue({ status: 'pass' });
  const token = signToken({ userId: 'fin-1', role: 'finance', department: '财务部' });

  const response = await fetch(`${url}/expenses/r1/payment-receipts/receipt-1/verify`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ force: true }),
  });

  expect(response.status).toBe(200);
  expect(mockRunVerification).toHaveBeenCalledWith('receipt-1', true, {
    actor: { type: 'user', id: 'fin-1', role: 'finance' },
    cause: 'force_ocr',
  });
});

it('records a receipt_replaced invalidation when uploading a new receipt', async () => {
  mockFindById.mockResolvedValue({ id: 'r1', status: 'approved', totalAmount: 100 });
  mockQuery.mockResolvedValueOnce({ rows: [] }); // report/receipt lock
  mockReceiptFindByReportId.mockResolvedValue({
    id: 'receipt-1',
    reportId: 'r1',
    verificationStatus: 'pass',
  });
  mockInvalidateReceipt.mockResolvedValue({ runId: 'run-inv', affected: 1 });
  mockReceiptUpsert.mockResolvedValue({
    id: 'receipt-1',
    reportId: 'r1',
    fileName: 'receipt.pdf',
  });
  const token = signToken({ userId: 'fin-1', role: 'finance', department: '财务部' });

  const response = await fetch(`${url}/expenses/r1/payment-receipts`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
  });

  expect(response.status).toBe(201);
  expect(mockInvalidateReceipt).toHaveBeenCalledWith(
    expect.objectContaining({
      reportId: 'r1',
      receiptId: 'receipt-1',
      cause: 'receipt_replaced',
    }),
    expect.anything()
  );
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @sse/api test -- payment-receipt-history`
Expected: FAIL，第三个参数缺失。

- [ ] **Step 3: 修改回单核对服务**

将 `packages/api/src/services/payment-receipt-verifier.ts` 改为：

```ts
import type { PaymentReceiptVerification } from '@sse/shared';
import { shouldReOcr, verifyPaymentReceipt } from '@sse/core';
import { MINERU_PARSER_VERSION } from '@sse/ai';
import {
  PgExpenseRepo,
  PgPaymentReceiptRepo,
  PgVerificationHistoryRepo,
  pool,
  withTransaction,
} from '@sse/db';
import { createOCREngine } from './ai-engines';
import { MinioStorage } from '../storage/minio-storage';

const receiptRepo = new PgPaymentReceiptRepo();
const expenseRepo = new PgExpenseRepo();
const historyRepo = new PgVerificationHistoryRepo();
const minio = new MinioStorage();

export type ReceiptVerificationContext = {
  actor?: { type: 'user' | 'system'; id?: string | null; role?: string | null };
  cause?: 'manual' | 'force_ocr' | 'system';
};

export function queuePaymentReceiptVerification(receiptId: string): void {
  setImmediate(() => {
    runPaymentReceiptVerification(receiptId, false, {
      actor: { type: 'system' },
      cause: 'system',
    }).catch((err) => {
      console.error(`[PaymentReceipt] 异步核对失败 ${receiptId}:`, err);
    });
  });
}

export async function runPaymentReceiptVerification(
  receiptId: string,
  forceOcr = false,
  context: ReceiptVerificationContext = {}
): Promise<PaymentReceiptVerification | null> {
  const receipt = await receiptRepo.findById(receiptId);
  if (!receipt) return null;

  const report = await expenseRepo.findById(receipt.reportId);
  if (!report) throw new Error('报销单不存在');

  let ocr = receipt.ocrResult ?? null;
  let ocrError: string | undefined;

  if (shouldReOcr(ocr, forceOcr, MINERU_PARSER_VERSION)) {
    const engine = createOCREngine();
    if (!engine) {
      ocr = null;
      ocrError = '发票 OCR 引擎未启用';
    } else {
      try {
        const buffer = await minio.getObject(receipt.storageKey, receipt.storageBucket);
        ocr = await engine.parseInvoice(buffer, receipt.fileName);
      } catch (err: any) {
        ocr = null;
        ocrError = err?.message || '回单识别失败';
      }
    }
  }

  return withTransaction(pool, async (client) => {
    const { rows: locked } = await client.query(
      'SELECT * FROM payment_receipts WHERE id = $1 FOR UPDATE',
      [receiptId]
    );
    if (locked.length === 0) return null;
    const lockedReceipt = locked[0];

    // 若回单在 OCR 期间被替换，丢弃旧文件 OCR，按当前回单重新得出“未核对”。
    const effectiveOcr =
      lockedReceipt.checksum === receipt.checksum ? ocr : (lockedReceipt.ocr_result ?? null);
    const duplicates = await receiptRepo.findByChecksum(
      lockedReceipt.checksum,
      lockedReceipt.id
    );
    const result = verifyPaymentReceipt({
      reportTotal: report.totalAmount,
      paidAt: report.paidAt ?? null,
      ocrResult: effectiveOcr,
      ocrError: lockedReceipt.checksum === receipt.checksum ? ocrError : undefined,
      duplicateReceipts: duplicates,
    });

    await receiptRepo.updateVerification(
      lockedReceipt.id,
      result.status,
      result,
      effectiveOcr,
      client
    );

    const historyStatus = result.status === 'pending' ? 'unverified' : result.status;
    await historyRepo.recordRun(
      {
        reportId: receipt.reportId,
        kind: 'payment_receipt',
        eventType: 'verify',
        cause: context.cause ?? (forceOcr ? 'force_ocr' : 'manual'),
        actor: context.actor ?? { type: 'system' },
        status: historyStatus,
        summary: {
          status: historyStatus,
          checkedAt: result.checkedAt,
          summary: result.summary,
          checks: result.checks,
        },
        checkedAt: result.checkedAt,
        items: [
          {
            subjectId: lockedReceipt.id,
            itemId: null,
            fileName: lockedReceipt.file_name,
            status: historyStatus,
            result,
          },
        ],
      },
      client
    );

    return result;
  });
}

export async function processPendingPaymentReceipts(limit = 5): Promise<void> {
  const pending = await receiptRepo.findPending(limit);
  for (const receipt of pending) {
    try {
      await runPaymentReceiptVerification(receipt.id, false, {
        actor: { type: 'system' },
        cause: 'system',
      });
    } catch (err) {
      console.error(`[PaymentReceipt] 处理待核对回单失败 ${receipt.id}:`, err);
    }
  }
}
```

- [ ] **Step 4: 修改回单核对路由**

将 `POST /:id/payment-receipts/:receiptId/verify` 中的调用改为：

```ts
const result = await runPaymentReceiptVerification(
  receipt.id,
  req.body?.force === true,
  {
    actor: {
      type: 'user',
      id: req.user!.userId,
      role: req.user!.role,
    },
    cause: req.body?.force === true ? 'force_ocr' : 'manual',
  }
);
```

- [ ] **Step 5: 修改回单上传路由**

将 `POST /:id/payment-receipts` 中的 upsert 包进事务并写失效：

```ts
const receipt = await withTransaction(pool, async (client) => {
  await client.query(
    'SELECT id FROM payment_receipts WHERE report_id = $1 FOR UPDATE',
    [id]
  );

  const existing = await paymentReceiptRepo.findByReportId(id, client);
  if (existing) {
    await historyRepo.invalidateReceipt(
      {
        reportId: id,
        receiptId: existing.id,
        cause: 'receipt_replaced',
        reason: '打款回单被替换，原核对结果失效',
        actor: { type: 'user', id: userId, role },
      },
      client
    );
  }

  return paymentReceiptRepo.upsert(
    {
      reportId: id,
      fileName: req.file!.originalname,
      fileFormat: ext,
      fileSize: req.file!.size,
      storageKey,
      storageBucket: 'payment-receipts',
      checksum,
      uploadedBy: userId,
    },
    client
  );
});
```

- [ ] **Step 6: 运行测试与构建**

Run: `pnpm --filter @sse/api test -- payment-receipt-history`
Expected: PASS。

Run: `pnpm --filter @sse/api test`
Expected: 全部 API 测试通过。

Run: `pnpm --filter @sse/api build`
Expected: 构建成功。

- [ ] **Step 7: 提交**

```bash
git add packages/api/src/services/payment-receipt-verifier.ts \
  packages/api/src/routes/expenses.ts \
  packages/api/src/__tests__/payment-receipt-history.test.ts
git commit -m "feat(api): record payment receipt verification history"
```

---

## Task 9: 详情页重复发票脱敏

**Files:**
- Modify: `packages/api/src/routes/expenses.ts`
- Create: `packages/api/src/__tests__/expenses-detail-redaction.test.ts`

- [ ] **Step 1: 写失败测试**

创建 `packages/api/src/__tests__/expenses-detail-redaction.test.ts`：

```ts
const mockQuery = jest.fn();
const mockFindById = jest.fn();

jest.mock('@sse/ai', () => ({ MINERU_PARSER_VERSION: 1 }));
jest.mock('../services/ai-engines', () => ({ createOCREngine: jest.fn() }));
jest.mock('../services/notifications', () => ({ sendNotificationSafe: jest.fn() }));
jest.mock('../services/audit', () => ({ auditFromRequest: jest.fn() }));
jest.mock('../services/payment-receipt-verifier', () => ({
  queuePaymentReceiptVerification: jest.fn(),
  runPaymentReceiptVerification: jest.fn(),
}));
jest.mock('../storage/minio-storage', () => ({
  MinioStorage: jest.fn().mockImplementation(() => ({ calculateChecksum: jest.fn() })),
}));

jest.mock('@sse/db', () => ({
  pool: { query: (...args: any[]) => mockQuery(...args) },
  withTransaction: jest.fn(),
  PgExpenseRepo: jest.fn().mockImplementation(() => ({ findById: mockFindById })),
  PgReportSnapshotRepo: jest.fn().mockImplementation(() => ({})),
  PgVerificationHistoryRepo: jest.fn().mockImplementation(() => ({})),
  PgInvoiceRepo: jest.fn().mockImplementation(() => ({})),
  PgApprovalRuleRepo: jest.fn().mockImplementation(() => ({ findActive: jest.fn(async () => []) })),
  PgApprovalRecordRepo: jest.fn().mockImplementation(() => ({ findByReportId: jest.fn(async () => []) })),
  PgUserRepo: jest.fn().mockImplementation(() => ({ findById: jest.fn() })),
  PgPaymentReceiptRepo: jest.fn().mockImplementation(() => ({ findByReportId: jest.fn(async () => null) })),
  PgPaymentAuditRepo: jest.fn().mockImplementation(() => ({ findByReportId: jest.fn(async () => []) })),
}));

import express from 'express';
import type { AddressInfo } from 'net';
import type { Server } from 'http';
import { signToken } from '@sse/auth';
import { expenseRoutes } from '../routes/expenses';
import { errorHandler } from '../middleware/error';

let url: string;
let server: Server;

beforeAll(async () => {
  jest.spyOn(console, 'error').mockImplementation(() => {});
  const app = express();
  app.use(express.json());
  app.use('/expenses', expenseRoutes);
  app.use(errorHandler);
  await new Promise<void>((resolve) => {
    server = app.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      url = `http://127.0.0.1:${port}`;
      resolve();
    });
  });
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  (console.error as jest.Mock).mockRestore();
});

const report = {
  id: 'r1',
  serialNo: 'RE-1',
  userId: 'owner-1',
  title: '差旅',
  totalAmount: 100,
  status: 'pending',
  currentStep: 1,
  createdAt: new Date(),
  updatedAt: new Date(),
};

beforeEach(() => {
  jest.clearAllMocks();
  mockFindById.mockResolvedValue(report);
});

it('masks duplicate invoice details for the report owner', async () => {
  mockQuery
    .mockResolvedValueOnce({ rows: [{ department: '技术部' }] }) // assertReportAccess
    .mockResolvedValueOnce({ rows: [{ id: 'it-1', report_id: 'r1', category_id: 'c1', amount: '100', expense_date: '2026-11-21', description: 'x' }] }) // items
    .mockResolvedValueOnce({ rows: [{ category_id: 'c1' }] }) // category ids
    .mockResolvedValueOnce({ rows: [{ id: 'inv-1', item_id: 'it-1', file_name: 'a.pdf', verification_status: 'warning', verification_result: { duplicates: [{ invoiceId: 'inv-2', serialNo: 'RE-2' }], ocr: { invoiceNo: 'NO-1' } } }] }); // invoices

  const token = signToken({ userId: 'owner-1', role: 'employee', department: '技术部' });
  const response = await fetch(`${url}/expenses/r1`, {
    headers: { authorization: `Bearer ${token}` },
  });

  expect(response.status).toBe(200);
  const body = (await response.json()) as any;
  expect(body.invoices[0].verificationResult.duplicates).toEqual([{ restricted: true }]);
  expect(body.invoices[0].verificationResult.ocr).toEqual({ invoiceNo: 'NO-1' });
});

it('keeps duplicate invoice details for finance', async () => {
  mockQuery
    .mockResolvedValueOnce({ rows: [{ department: '财务部' }] }) // assertReportAccess
    .mockResolvedValueOnce({ rows: [{ id: 'it-1', report_id: 'r1', category_id: 'c1', amount: '100', expense_date: '2026-11-21', description: 'x' }] }) // items
    .mockResolvedValueOnce({ rows: [{ category_id: 'c1' }] }) // category ids
    .mockResolvedValueOnce({ rows: [{ id: 'inv-1', item_id: 'it-1', file_name: 'a.pdf', verification_status: 'warning', verification_result: { duplicates: [{ invoiceId: 'inv-2', serialNo: 'RE-2' }] } }] }); // invoices

  const token = signToken({ userId: 'fin-1', role: 'finance', department: '财务部' });
  const response = await fetch(`${url}/expenses/r1`, {
    headers: { authorization: `Bearer ${token}` },
  });

  expect(response.status).toBe(200);
  const body = (await response.json()) as any;
  expect(body.invoices[0].verificationResult.duplicates[0].serialNo).toBe('RE-2');
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @sse/api test -- expenses-detail-redaction`
Expected: FAIL，员工仍能看到 `serialNo`。

- [ ] **Step 3: 添加脱敏辅助并应用**

在 `packages/api/src/routes/expenses.ts` 顶部工具区添加：

```ts
function redactInvoiceDuplicateDetails(invoice: any) {
  const duplicates = invoice?.verificationResult?.duplicates;
  if (!Array.isArray(duplicates) || duplicates.length === 0) return invoice;
  return {
    ...invoice,
    verificationResult: {
      ...invoice.verificationResult,
      duplicates: [{ restricted: true }],
    },
  };
}
```

在 `GET /:id` 中，`invoices = invRows.map(mapInvoiceRow);` 之后追加：

```ts
const canSeeDuplicateDetails =
  role === UserRole.ADMIN ||
  role === UserRole.FINANCE ||
  role === UserRole.DEPT_APPROVER;
if (!canSeeDuplicateDetails) {
  invoices = invoices.map(redactInvoiceDuplicateDetails);
}
```

- [ ] **Step 4: 运行测试**

Run: `pnpm --filter @sse/api test -- expenses-detail-redaction`
Expected: PASS，2 tests passed。

- [ ] **Step 5: 提交**

```bash
git add packages/api/src/routes/expenses.ts packages/api/src/__tests__/expenses-detail-redaction.test.ts
git commit -m "fix(api): redact duplicate invoice details from report viewers"
```

---

## Task 10: Web 历史展示工具

**Files:**
- Create: `packages/web/src/utils/verification-history.ts`
- Create: `packages/web/src/utils/__tests__/verification-history.test.ts`

- [ ] **Step 1: 写失败测试**

创建 `packages/web/src/utils/__tests__/verification-history.test.ts`：

```ts
import { describe, expect, it } from 'vitest';
import {
  formatHistoryTime,
  historyActorLabel,
  historyCauseLabel,
  historyEventLabel,
  historyStatusLabel,
  historySummary,
  itemPreviousStatus,
} from '../verification-history';

describe('verification history labels', () => {
  it('maps event types', () => {
    expect(historyEventLabel('verify')).toBe('核对');
    expect(historyEventLabel('invalidate')).toBe('失效');
    expect(historyEventLabel('backfill')).toBe('历史回填');
    expect(historyEventLabel('custom')).toBe('custom');
    expect(historyEventLabel(null)).toBe('-');
  });

  it('maps causes', () => {
    expect(historyCauseLabel('manual')).toBe('手动核对');
    expect(historyCauseLabel('force_ocr')).toBe('重新识别');
    expect(historyCauseLabel('items_updated')).toBe('明细修改');
    expect(historyCauseLabel('invoice_uploaded')).toBe('换发票');
    expect(historyCauseLabel('receipt_replaced')).toBe('换回单');
    expect(historyCauseLabel('system')).toBe('系统自动');
    expect(historyCauseLabel('backfill')).toBe('历史回填');
  });

  it('maps statuses', () => {
    expect(historyStatusLabel('pass')).toBe('通过');
    expect(historyStatusLabel('warning')).toBe('存在差异');
    expect(historyStatusLabel('unverified')).toBe('未核对');
    expect(historyStatusLabel('error')).toBe('核对失败');
    expect(historyStatusLabel('no_invoices')).toBe('无发票');
    expect(historyStatusLabel('invalidated')).toBe('已失效');
    expect(historyStatusLabel('custom')).toBe('custom');
    expect(historyStatusLabel(null)).toBe('-');
  });
});

describe('historySummary', () => {
  it('prefers the run summary text', () => {
    expect(historySummary({ summary: { summary: '全部通过' } })).toBe('全部通过');
  });

  it('describes invalidation runs', () => {
    expect(
      historySummary({ eventType: 'invalidate', summary: { affected: 2 } })
    ).toBe('2 项旧结果已失效');
  });

  it('falls back to a dash', () => {
    expect(historySummary({ summary: {} })).toBe('-');
  });
});

describe('historyActorLabel', () => {
  it('labels system actors', () => {
    expect(historyActorLabel({ actorType: 'system' })).toBe('系统');
  });

  it('prefers role then id', () => {
    expect(historyActorLabel({ actorType: 'user', actorRole: 'finance' })).toBe('finance');
    expect(historyActorLabel({ actorType: 'user', actorId: 'u1' })).toBe('u1');
    expect(historyActorLabel({})).toBe('-');
  });
});

describe('formatHistoryTime', () => {
  it('formats valid timestamps and preserves invalid values', () => {
    expect(formatHistoryTime('2026-11-21T08:05:00Z')).toMatch(
      /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/
    );
    expect(formatHistoryTime('not-a-date')).toBe('not-a-date');
    expect(formatHistoryTime(null)).toBe('-');
  });
});

describe('itemPreviousStatus', () => {
  it('reads the previous status from invalidation results', () => {
    expect(itemPreviousStatus({ result: { previousStatus: 'pass' } })).toBe('pass');
    expect(itemPreviousStatus({ result: {} })).toBe('-');
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @sse/web test -- verification-history`
Expected: FAIL，`Failed to resolve import "../verification-history"`。

- [ ] **Step 3: 写工具函数**

创建 `packages/web/src/utils/verification-history.ts`：

```ts
const EVENT_TYPE_LABELS: Record<string, string> = {
  verify: '核对',
  invalidate: '失效',
  backfill: '历史回填',
};

const CAUSE_LABELS: Record<string, string> = {
  manual: '手动核对',
  force_ocr: '重新识别',
  items_updated: '明细修改',
  invoice_uploaded: '换发票',
  receipt_replaced: '换回单',
  system: '系统自动',
  backfill: '历史回填',
};

const STATUS_LABELS: Record<string, string> = {
  pass: '通过',
  warning: '存在差异',
  unverified: '未核对',
  error: '核对失败',
  no_invoices: '无发票',
  invalidated: '已失效',
};

export function historyEventLabel(value?: string | null): string {
  if (!value) return '-';
  return EVENT_TYPE_LABELS[value] || value;
}

export function historyCauseLabel(value?: string | null): string {
  if (!value) return '-';
  return CAUSE_LABELS[value] || value;
}

export function historyStatusLabel(value?: string | null): string {
  if (!value) return '-';
  return STATUS_LABELS[value] || value;
}

export function historySummary(run: any): string {
  if (run?.summary?.summary) return run.summary.summary;
  if (run?.eventType === 'invalidate') {
    const affected = Number(run?.summary?.affected || 0);
    return `${affected} 项旧结果已失效`;
  }
  return '-';
}

export function historyActorLabel(run: any): string {
  if (run?.actorType === 'system') return '系统';
  return run?.actorRole || run?.actorId || '-';
}

export function formatHistoryTime(value?: string | null): string {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(
    date.getHours()
  )}:${pad(date.getMinutes())}`;
}

export function itemPreviousStatus(item: any): string {
  return item?.result?.previousStatus || '-';
}
```

- [ ] **Step 4: 运行测试**

Run: `pnpm --filter @sse/web test -- verification-history`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add packages/web/src/utils/verification-history.ts packages/web/src/utils/__tests__/verification-history.test.ts
git commit -m "feat(web): add verification history display helpers"
```

---

## Task 11: Web 历史卡片与详情页接入

**Files:**
- Create: `packages/web/src/components/VerificationHistory.vue`
- Modify: `packages/web/src/pages/ExpenseDetail.vue`

- [ ] **Step 1: 写组件**

创建 `packages/web/src/components/VerificationHistory.vue`：

```vue
<template>
  <div class="card verification-history">
    <div class="history-header">
      <h3 class="card-section-title font-heading">核对历史</h3>
      <button class="btn-secondary btn-sm" :disabled="loading" @click="load">
        {{ loading ? '加载中...' : '刷新' }}
      </button>
    </div>

    <div v-if="loading && runs.length === 0" class="history-empty">加载中...</div>
    <div v-else-if="runs.length === 0" class="history-empty">暂无核对历史</div>

    <div v-else class="history-list">
      <div v-for="run in runs" :key="run.id" class="history-run">
        <div class="run-head" @click="toggle(run.id)">
          <div class="run-main">
            <span class="run-event" :class="`event-${run.eventType}`">{{ historyEventLabel(run.eventType) }}</span>
            <span class="run-time">{{ formatHistoryTime(run.checkedAt) }}</span>
            <span class="run-badge" :class="`status-${run.status}`">{{ historyStatusLabel(run.status) }}</span>
            <span v-if="run.legacy" class="run-legacy">历史回填</span>
            <span v-if="!run.hashValid" class="run-tamper">哈希校验失败</span>
          </div>
          <div class="run-actor">{{ historyActorLabel(run) }} · {{ historyCauseLabel(run.cause) }}</div>
        </div>

        <p class="run-summary">{{ historySummary(run) }}</p>
        <p v-if="run.reason" class="run-reason">{{ run.reason }}</p>

        <div v-if="expanded[run.id]" class="run-items">
          <div v-if="run.items.length === 0" class="history-empty">本次核对无发票/回单</div>
          <div v-for="item in run.items" :key="item.id" class="run-item">
            <div class="item-head">
              <span class="item-file">📎 {{ item.fileName || item.subjectId }}</span>
              <span class="run-badge" :class="`status-${item.status}`">{{ historyStatusLabel(item.status) }}</span>
            </div>
            <div v-if="item.result?.event === 'invalidated'" class="item-meta">
              原状态：{{ historyStatusLabel(itemPreviousStatus(item)) }}
              <span v-if="item.result?.previousVerifiedAt"> · {{ formatHistoryTime(item.result.previousVerifiedAt) }}</span>
            </div>
            <ul v-else-if="item.result?.checks?.length" class="item-checks">
              <li v-for="check in item.result.checks" :key="check.key" :class="{ fail: !check.ok }">
                {{ check.ok ? '✓' : '✗' }} {{ check.label }}<template v-if="check.message">：{{ check.message }}</template>
              </li>
            </ul>
            <p v-else-if="item.result?.summary" class="item-meta">{{ item.result.summary }}</p>
            <div v-if="item.result?.ocr?.invoiceNo" class="item-meta">
              发票号：{{ item.result.ocr.invoiceNo }}
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import api from '../api/index'
import { useAuthStore } from '../stores/auth'
import {
  formatHistoryTime,
  historyActorLabel,
  historyCauseLabel,
  historyEventLabel,
  historyStatusLabel,
  historySummary,
  itemPreviousStatus,
} from '../utils/verification-history'

const props = defineProps<{ reportId: string }>()

const auth = useAuthStore()
const runs = ref<any[]>([])
const loading = ref(false)
const expanded = reactive<Record<string, boolean>>({})

function canSeeReceipts() {
  return auth.user?.role === 'finance' || auth.user?.role === 'admin'
}

async function load() {
  loading.value = true
  try {
    const { data } = await api.get(`/expenses/${props.reportId}/verification-history`, {
      params: { kind: canSeeReceipts() ? 'all' : 'invoice', limit: 50 },
    })
    runs.value = data.items || []
  } catch {
    runs.value = []
  } finally {
    loading.value = false
  }
}

function toggle(id: string) {
  expanded[id] = !expanded[id]
}

onMounted(load)
</script>

<style scoped>
.verification-history { display: flex; flex-direction: column; gap: 12px; }
.history-header { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.history-header .card-section-title { margin: 0; padding: 0; border: none; }
.history-empty { color: var(--text-muted); font-size: 0.82rem; }
.history-list { display: flex; flex-direction: column; gap: 10px; }
.history-run { border: 1px solid var(--border-light); border-radius: var(--radius-sm); padding: 10px 12px; }
.run-head { cursor: pointer; display: flex; flex-wrap: wrap; justify-content: space-between; gap: 6px; }
.run-main { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.run-event { font-weight: 600; font-size: 0.85rem; }
.run-event.event-invalidate { color: var(--accent-coral); }
.run-time { font-size: 0.78rem; color: var(--text-muted); }
.run-badge { font-size: 0.78rem; }
.run-badge.status-pass { color: #2b7a3d; }
.run-badge.status-warning,
.run-badge.status-error,
.run-badge.status-invalidated { color: var(--accent-coral); }
.run-badge.status-unverified,
.run-badge.status-no_invoices { color: var(--text-muted); }
.run-legacy,
.run-tamper { font-size: 0.72rem; padding: 1px 6px; border-radius: 999px; background: var(--bg-warm); color: var(--text-secondary); }
.run-tamper { color: var(--accent-coral); }
.run-actor { font-size: 0.76rem; color: var(--text-muted); }
.run-summary { margin: 6px 0 0; font-size: 0.82rem; color: var(--text-secondary); }
.run-reason { margin: 4px 0 0; font-size: 0.78rem; color: var(--text-muted); }
.run-items { margin-top: 10px; display: flex; flex-direction: column; gap: 8px; }
.run-item { border-top: 1px dashed var(--border-light); padding-top: 8px; }
.item-head { display: flex; justify-content: space-between; gap: 8px; }
.item-file { font-size: 0.82rem; color: var(--text-primary); }
.item-meta { margin-top: 4px; font-size: 0.78rem; color: var(--text-muted); }
.item-checks { margin: 6px 0 0; padding-left: 18px; font-size: 0.78rem; color: var(--text-secondary); }
.item-checks li.fail { color: var(--accent-coral); }
</style>
```

- [ ] **Step 2: 接入详情页**

在 `packages/web/src/pages/ExpenseDetail.vue`：

1. import：

```ts
import VerificationHistory from '../components/VerificationHistory.vue'
```

2. 在 `<ReportSnapshots ... />` 之后添加：

```vue
<VerificationHistory v-if="report" :report-id="report.id" />
```

- [ ] **Step 3: 构建与测试**

Run: `pnpm --filter @sse/web test`
Expected: 全部通过。

Run: `pnpm --filter @sse/web build`
Expected: 构建成功，包含 `VerificationHistory` chunk。

- [ ] **Step 4: 提交**

```bash
git add packages/web/src/components/VerificationHistory.vue packages/web/src/pages/ExpenseDetail.vue
git commit -m "feat(web): show verification history in expense detail"
```

---

## Task 12: 全量验证与文档

**Files:**
- Modify: `docs/2026-11-21-sse-process.md`
- Create: `docs/testing/invoice-verification-history.tdd.md`

- [ ] **Step 1: 运行全量测试**

Run: `pnpm -r test`
Expected: 全部包通过，记录实际各包数量。

- [ ] **Step 2: 运行全量构建**

Run: `pnpm -r build`
Expected: 11 个包全部完成。

- [ ] **Step 3: 写 TDD 证据**

创建 `docs/testing/invoice-verification-history.tdd.md`，至少包含：

```markdown
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
| Transaction clients | method ignores db | `pnpm --filter @sse/db test -- pg-invoice-repo-transaction` 与 `... -- pg-payment-receipt-repo-transaction` |
| History repo | module not found | `pnpm --filter @sse/db test -- pg-verification-history-repo` |
| API capture/history | 404 / not called | `pnpm --filter @sse/api test -- expenses-verification` |
| Receipt history | third arg missing | `pnpm --filter @sse/api test -- payment-receipt-history` |
| Detail redaction | serialNo leaked | `pnpm --filter @sse/api test -- expenses-detail-redaction` |
| Web helpers | import failed | `pnpm --filter @sse/web test -- verification-history` |
| Web build | component missing | `pnpm --filter @sse/web build` |

## 4. Known gaps

- 迁移未在本机真实 PostgreSQL 执行（若 Docker 不可用）；部署前在测试机执行并复测。
- 上传路由通过 mock 上传中间件覆盖，未做真实 multipart 文件流测试；文件签名校验沿用现有上传单测与中间件测试。
```

- [ ] **Step 4: 更新过程记录**

在 `docs/2026-11-21-sse-process.md` 末尾追加：

````markdown
---

## 八、P1-6：发票与回单核对历史版本

> 设计：`docs/superpowers/specs/2026-11-21-invoice-verification-history-design.md`
> 计划：`docs/superpowers/plans/2026-11-21-invoice-verification-history.md`
> TDD 证据：`docs/testing/invoice-verification-history.tdd.md`

### 落地内容

- 迁移 `024_verification_history.sql`：`verification_runs` + `verification_run_items` append-only、SHA-256、无外键、失效事件、历史回填。
- core：`IVerificationHistoryRepo`、`redactVerificationHistory`。
- db：`PgVerificationHistoryRepo`；发票/回单仓储支持事务客户端。
- api：发票核对、明细修改、发票上传、回单上传、回单核对写入历史；新增 `GET /expenses/:id/verification-history`；详情重复发票脱敏。
- web：报销详情“核对历史”卡片。

### 验证

将 `pnpm -r test` 与 `pnpm -r build` 的真实输出粘贴到本节，格式参照 P1-5 过程记录；必须包含合计 passed 数与构建包数。若任一命令失败，停止文档步骤并先修复，不得写“通过”。

### 部署与复测

```bash
pnpm --filter @sse/db migrate

docker compose exec -T postgres psql -U sse -d sse \
  -c "SELECT kind, event_type, legacy, COUNT(*) FROM verification_runs GROUP BY 1,2,3 ORDER BY 1,2,3;"
```

复测要点：

1. 核对一次 → 新增 run 与逐张 items；
2. 重复核对 → 旧 run 保留；
3. 改明细/换发票 → 当前变 pending，出现失效事件；
4. 回单上传/核对 → 同理；
5. 回填数据 `legacy=true`；
6. `UPDATE/DELETE` 两张历史表被拒绝；
7. 员工看不到重复发票明细。

### P1 清单进度

| 优先级 | 项 | 状态 |
|---|---|---|
| P1-6 | 发票核对历史版本，不覆盖旧结果 | ✅ 已完成 |
| P1-7 | 导出补齐明细/审批链/付款/发票字段；增加 XLSX 与导出审计 | 待处理 |
````

- [ ] **Step 5: 提交**

```bash
git add docs/testing/invoice-verification-history.tdd.md docs/2026-11-21-sse-process.md
git commit -m "docs: record verification history implementation and TDD evidence"
```

---

## 完成标准

- `pnpm -r test` 全绿，`pnpm -r build` 全部成功。
- 发票与回单核对均生成 append-only 历史；旧结果不被覆盖。
- 明细修改/换发票/换回单产生失效事件，当前状态仍为 `pending`。
- 历史接口按角色过滤与脱敏；员工看不到重复发票/回单明细。
- 详情页可查看历史、逐张结果、失效原因与哈希校验状态。
- 迁移与回填在测试机完成真实库验证。
