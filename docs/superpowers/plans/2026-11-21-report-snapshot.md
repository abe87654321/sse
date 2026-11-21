# Report Snapshot (P1-5) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Capture immutable JSON snapshots of an expense report at submit, each approval/rejection, and payment, then expose them through authorized APIs and Web views.

**Architecture:** New append-only `report_snapshots` table (no foreign keys, SHA-256 content hash). A pure builder in `@sse/core` composes the payload; `PgReportSnapshotRepo` loads the report and inserts the snapshot. Business writes are wrapped in `withTransaction` and capture the snapshot with the same `PoolClient`, so a missing snapshot rolls the action back.

**Tech Stack:** TypeScript, Express, PostgreSQL 16, Jest/ts-jest, Vue 3 + Vite/Vitest.

**Spec:** `docs/superpowers/specs/2026-11-21-report-snapshot-design.md`

---

## File Map

**Create**
- `packages/shared/src/types/report-snapshot.ts`
- `packages/core/src/ports/sql-executor.ts`
- `packages/core/src/ports/ireport-snapshot-repo.ts`
- `packages/core/src/services/report-snapshot.ts`
- `packages/core/src/services/__tests__/report-snapshot.test.ts`
- `packages/db/src/migrations/023_report_snapshots.sql`
- `packages/db/src/repositories/pg-report-snapshot-repo.ts`
- `packages/db/src/__tests__/migration-023.test.ts`
- `packages/db/src/__tests__/pg-report-snapshot-repo.test.ts`
- `packages/api/src/routes/admin-snapshots.ts`
- `packages/api/src/__tests__/expenses-snapshots.test.ts`
- `packages/api/src/__tests__/admin-snapshots.test.ts`
- `packages/web/src/utils/snapshot.ts`
- `packages/web/src/utils/__tests__/snapshot.test.ts`
- `packages/web/src/components/SnapshotViewer.vue`
- `packages/web/src/components/ReportSnapshots.vue`
- `packages/web/src/pages/AdminSnapshots.vue`
- `docs/2026-11-21-sse-process.md`

**Modify**
- `packages/shared/src/types/index.ts`
- `packages/core/src/ports/index.ts`
- `packages/core/src/ports/iexpense-repo.ts`
- `packages/core/src/ports/iapproval-record-repo.ts`
- `packages/core/src/services/approval-engine.ts`
- `packages/core/src/services/index.ts`
- `packages/db/src/repositories/index.ts`
- `packages/db/src/repositories/pg-expense-repo.ts`
- `packages/db/src/repositories/pg-approval-record-repo.ts`
- `packages/db/jest.config.js`
- `packages/api/src/routes/expenses.ts`
- `packages/api/src/routes/approvals.ts`
- `packages/api/src/index.ts`
- `packages/web/src/pages/ExpenseDetail.vue`
- `packages/web/src/router/index.ts`
- `packages/web/src/layouts/DefaultLayout.vue`

---

## Task 1: Shared types and core ports

**Files:**
- Create: `packages/shared/src/types/report-snapshot.ts`
- Modify: `packages/shared/src/types/index.ts`
- Create: `packages/core/src/ports/sql-executor.ts`
- Create: `packages/core/src/ports/ireport-snapshot-repo.ts`
- Modify: `packages/core/src/ports/index.ts`

- [ ] **Step 1: Create shared snapshot types**

Create `packages/shared/src/types/report-snapshot.ts`:

```ts
export type SnapshotType = 'submit' | 'approve' | 'reject' | 'pay' | 'backfill';

export type SnapshotActorType = 'user' | 'system';

export type SnapshotVerificationStatus =
  | 'no_invoices'
  | 'pending'
  | 'unverified'
  | 'warning'
  | 'error'
  | 'pass';

export type ReportSnapshot = {
  id: string;
  reportId: string;
  snapshotType: SnapshotType;
  schemaVersion: number;
  approvalRecordId?: string;
  step?: number;
  actorType: SnapshotActorType;
  actorId?: string;
  actorRole?: string;
  contentHash: string;
  legacy: boolean;
  createdAt: Date;
};

export type ReportSnapshotRule = {
  id: string;
  name: string;
  minAmount: number;
  maxAmount: number;
  priority: number;
  chain: Array<{
    step: number;
    role: string | null;
    assigneeId: string | null;
    label: string;
  }>;
};

export type ReportSnapshotApprovalRecord = {
  id: string;
  step: number;
  approverId: string;
  approverName: string | null;
  result: string;
  comment: string | null;
  stepStartedAt: string | null;
  approvedAt: string | null;
  verificationAcknowledged: boolean;
};

export type ReportSnapshotAction = {
  recordId: string;
  step: number;
  result: string;
  comment: string | null;
};

export type ReportSnapshotInvoice = {
  id: string;
  fileName: string;
  fileFormat: string;
  fileSize: number;
  checksum: string;
  invoiceNo: string | null;
  verificationStatus: string;
  verificationResult: unknown | null;
  verifiedAt: string | null;
  uploadedAt: string | null;
};

export type ReportSnapshotItem = {
  id: string;
  categoryId: string;
  categoryName: string | null;
  amount: number;
  expenseDate: string;
  description: string;
  invoices: ReportSnapshotInvoice[];
};

export type ReportSnapshotPayment = {
  paidAt: string | null;
  paidBy: string | null;
  paidByName: string | null;
  paymentRef: string | null;
  paymentComment: string | null;
  receipt: {
    id: string;
    fileName: string;
    fileFormat: string;
    checksum: string;
    verificationStatus: string;
    verificationResult: unknown | null;
    verifiedAt: string | null;
  } | null;
};

export type ReportSnapshotPayload = {
  schemaVersion: number;
  snapshotType: SnapshotType;
  capturedAt: string;
  legacy: boolean;
  report: {
    id: string;
    serialNo: string;
    title: string;
    description: string | null;
    status: string;
    currentStep: number;
    totalAmount: number;
    userId: string;
    applicantName: string | null;
    applicantDepartment: string | null;
    submittedAt: string | null;
    completedAt: string | null;
    paidAt: string | null;
    paidBy: string | null;
    paymentRef: string | null;
    paymentComment: string | null;
    paymentUpdatedAt: string | null;
    paymentUpdatedBy: string | null;
    createdAt: string;
    updatedAt: string;
  };
  items: ReportSnapshotItem[];
  verification: {
    aggregateStatus: SnapshotVerificationStatus;
    acknowledged: boolean;
  };
  approval: {
    rule: ReportSnapshotRule | null;
    records: ReportSnapshotApprovalRecord[];
    action: ReportSnapshotAction | null;
  };
  payment: ReportSnapshotPayment | null;
};

export type ReportSnapshotDetail = ReportSnapshot & {
  payload: ReportSnapshotPayload;
  hashValid: boolean;
};
```

- [ ] **Step 2: Export the new types**

Append to `packages/shared/src/types/index.ts`:

```ts
export type {
  SnapshotType,
  SnapshotActorType,
  SnapshotVerificationStatus,
  ReportSnapshot,
  ReportSnapshotDetail,
  ReportSnapshotPayload,
  ReportSnapshotItem,
  ReportSnapshotInvoice,
  ReportSnapshotRule,
  ReportSnapshotApprovalRecord,
  ReportSnapshotAction,
  ReportSnapshotPayment,
} from './report-snapshot';
```

- [ ] **Step 3: Create the core SQL executor port**

Create `packages/core/src/ports/sql-executor.ts`:

```ts
export interface SqlExecutor {
  query(text: string, values?: any[]): Promise<{ rows: any[] }>;
}
```

- [ ] **Step 4: Create the snapshot repo port**

Create `packages/core/src/ports/ireport-snapshot-repo.ts`:

```ts
import type { ApprovalRule, ReportSnapshot, ReportSnapshotDetail } from '@sse/shared';
import type { SqlExecutor } from './sql-executor';

export type SnapshotCaptureInput = {
  reportId: string;
  snapshotType: 'submit' | 'approve' | 'reject' | 'pay';
  actor: { type: 'user' | 'system'; id?: string; role?: string };
  rule?: ApprovalRule | null;
  action?: {
    recordId: string;
    step: number;
    result: string;
    comment?: string | null;
  } | null;
};

export type SnapshotQuery = {
  reportId?: string;
  snapshotType?: string;
  legacy?: boolean;
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
};

export interface IReportSnapshotRepo {
  capture(input: SnapshotCaptureInput, db?: SqlExecutor): Promise<ReportSnapshot>;
  findByReportId(reportId: string, db?: SqlExecutor): Promise<ReportSnapshot[]>;
  findDetailById(id: string, db?: SqlExecutor): Promise<ReportSnapshotDetail | null>;
  findDetailByReport(
    reportId: string,
    snapshotId: string,
    db?: SqlExecutor
  ): Promise<ReportSnapshotDetail | null>;
  query(
    filter: SnapshotQuery,
    db?: SqlExecutor
  ): Promise<{ items: ReportSnapshot[]; total: number }>;
}
```

- [ ] **Step 5: Export the new ports**

Append to `packages/core/src/ports/index.ts`:

```ts
export type { SqlExecutor } from './sql-executor';
export type {
  IReportSnapshotRepo,
  SnapshotCaptureInput,
  SnapshotQuery,
} from './ireport-snapshot-repo';
```

- [ ] **Step 6: Build shared and core**

Run: `pnpm --filter @sse/shared build; if ($?) { pnpm --filter @sse/core build }`
Expected: both builds succeed.

- [ ] **Step 7: Commit**

```bash
git add packages/shared/src/types/report-snapshot.ts packages/shared/src/types/index.ts packages/core/src/ports
git commit -m "feat(shared): add report snapshot types and ports"
```

---

## Task 2: Core snapshot payload builder

**Files:**
- Create: `packages/core/src/services/report-snapshot.ts`
- Create: `packages/core/src/services/__tests__/report-snapshot.test.ts`
- Modify: `packages/core/src/services/index.ts`

- [ ] **Step 1: Write the failing builder test**

Create `packages/core/src/services/__tests__/report-snapshot.test.ts`:

```ts
import { buildReportSnapshotPayload } from '../report-snapshot';
import type { ApprovalRule, ExpenseReport, Invoice } from '@sse/shared';

const report: ExpenseReport = {
  id: 'r1',
  serialNo: 'RE-001',
  userId: 'u1',
  applicantName: '张三',
  title: '差旅报销',
  totalAmount: 300,
  description: '上海出差',
  status: 'pending',
  currentStep: 1,
  createdAt: new Date('2026-11-01T08:00:00Z'),
  updatedAt: new Date('2026-11-02T08:00:00Z'),
};

const rule: ApprovalRule = {
  id: 'rule-1',
  name: '默认审批规则',
  minAmount: 0,
  maxAmount: 10000,
  categoryIds: [],
  priority: 1,
  isActive: true,
  approvalChain: [
    { step: 1, role: 'dept_approver', label: '部门审批' },
    { step: 2, role: 'finance', label: '财务审批' },
  ],
};

function invoice(overrides: Partial<Invoice> = {}): Invoice {
  return {
    id: 'i1',
    itemId: 'it1',
    fileName: 'invoice.pdf',
    fileFormat: 'pdf',
    fileSize: 1024,
    storageKey: 'invoices/r1/i1.pdf',
    storageBucket: 'invoices',
    checksum: 'abc123',
    verificationStatus: 'pass',
    verificationResult: { ok: true },
    verifiedAt: new Date('2026-11-02T09:00:00Z'),
    uploadedAt: new Date('2026-11-02T08:30:00Z'),
    ...overrides,
  };
}

describe('buildReportSnapshotPayload', () => {
  it('builds a full payload with report, items, invoices, verification, rule and action', () => {
    const payload = buildReportSnapshotPayload({
      snapshotType: 'approve',
      capturedAt: '2026-11-02T10:00:00.000Z',
      report,
      applicantDepartment: '技术部',
      items: [
        {
          item: {
            id: 'it1',
            reportId: 'r1',
            categoryId: 'c1',
            amount: 300,
            expenseDate: '2026-11-01',
            description: '高铁票',
          },
          categoryName: '交通费',
          invoices: [invoice()],
        },
      ],
      approvalRecords: [
        {
          id: 'ar1',
          step: 1,
          approverId: 'd1',
          approverName: '李四',
          result: 'approved',
          comment: '同意',
          stepStartedAt: new Date('2026-11-02T09:30:00Z'),
          approvedAt: new Date('2026-11-02T10:00:00Z'),
          verificationAcknowledged: true,
        },
      ],
      rule,
      action: { recordId: 'ar1', step: 1, result: 'approved', comment: '同意' },
    });

    expect(payload.schemaVersion).toBe(1);
    expect(payload.report.totalAmount).toBe(300);
    expect(payload.report.applicantDepartment).toBe('技术部');
    expect(payload.items[0].categoryName).toBe('交通费');
    expect(payload.items[0].invoices[0].fileName).toBe('invoice.pdf');
    expect(payload.items[0].invoices[0]).not.toHaveProperty('storageKey');
    expect(payload.verification.aggregateStatus).toBe('pass');
    expect(payload.verification.acknowledged).toBe(true);
    expect(payload.approval.rule?.chain).toHaveLength(2);
    expect(payload.approval.action).toEqual({
      recordId: 'ar1',
      step: 1,
      result: 'approved',
      comment: '同意',
    });
    expect(payload.payment).toBeNull();
  });

  it('reports no_invoices when the report has no invoices', () => {
    const payload = buildReportSnapshotPayload({
      snapshotType: 'submit',
      report,
      items: [
        {
          item: {
            id: 'it1',
            reportId: 'r1',
            categoryId: 'c1',
            amount: 300,
            expenseDate: '2026-11-01',
            description: '高铁票',
          },
          invoices: [],
        },
      ],
      approvalRecords: [],
      rule: null,
      action: null,
    });

    expect(payload.verification.aggregateStatus).toBe('no_invoices');
    expect(payload.approval.rule).toBeNull();
    expect(payload.approval.action).toBeNull();
    expect(payload.payment).toBeNull();
  });

  it('groups multiple invoices per item and builds the payment section for pay snapshots', () => {
    const payload = buildReportSnapshotPayload({
      snapshotType: 'pay',
      report: {
        ...report,
        status: 'paid',
        paidAt: new Date('2026-11-03T08:00:00Z'),
        paidBy: 'fin-1',
        paymentRef: 'BANK-1',
        paymentComment: '已转账',
      },
      items: [
        {
          item: {
            id: 'it1',
            reportId: 'r1',
            categoryId: 'c1',
            amount: 300,
            expenseDate: '2026-11-01',
            description: '高铁票',
          },
          categoryName: '交通费',
          invoices: [
            invoice({ id: 'i1', verificationStatus: 'pass' }),
            invoice({ id: 'i2', verificationStatus: 'warning' }),
          ],
        },
      ],
      approvalRecords: [],
      rule: null,
      action: null,
      paidByName: '王五',
      paymentReceipt: {
        id: 'pr1',
        reportId: 'r1',
        fileName: 'receipt.pdf',
        fileFormat: 'pdf',
        fileSize: 2048,
        storageKey: 'payment-receipts/r1/receipt.pdf',
        storageBucket: 'payment-receipts',
        checksum: 'def456',
        uploadedAt: new Date('2026-11-03T07:00:00Z'),
        verificationStatus: 'pass',
        verificationResult: { ok: true },
        verifiedAt: new Date('2026-11-03T07:30:00Z'),
      },
    });

    expect(payload.items[0].invoices).toHaveLength(2);
    expect(payload.verification.aggregateStatus).toBe('warning');
    expect(payload.payment).toEqual(
      expect.objectContaining({
        paidBy: 'fin-1',
        paidByName: '王五',
        paymentRef: 'BANK-1',
        paymentComment: '已转账',
        receipt: expect.objectContaining({ id: 'pr1', fileName: 'receipt.pdf' }),
      })
    );
  });

  it('keeps the rule null for legacy input', () => {
    const payload = buildReportSnapshotPayload({
      snapshotType: 'approve',
      legacy: true,
      report,
      items: [],
      approvalRecords: [],
      rule: null,
      action: null,
    });

    expect(payload.legacy).toBe(true);
    expect(payload.approval.rule).toBeNull();
    expect(payload.payment).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @sse/core test -- report-snapshot`
Expected: FAIL because `../report-snapshot` does not exist.

- [ ] **Step 3: Implement the builder**

Create `packages/core/src/services/report-snapshot.ts`:

```ts
import type {
  ApprovalRule,
  ExpenseReport,
  PaymentReceipt,
  ReportSnapshotApprovalRecord,
  ReportSnapshotInvoice,
  ReportSnapshotItem,
  ReportSnapshotPayload,
  ReportSnapshotRule,
  SnapshotType,
} from '@sse/shared';
import { aggregateVerificationStatus } from './invoice-verifier';

export type SnapshotInvoiceInput = {
  id: string;
  fileName: string;
  fileFormat: string;
  fileSize: number;
  checksum: string;
  invoiceNo?: string | null;
  verificationStatus?: string | null;
  verificationResult?: unknown;
  verifiedAt?: Date | string | null;
  uploadedAt?: Date | string | null;
};

export type SnapshotItemInput = {
  id: string;
  reportId?: string;
  categoryId: string;
  amount: number;
  expenseDate: Date | string;
  description?: string | null;
};

export type SnapshotDataItem = {
  item: SnapshotItemInput;
  categoryName?: string | null;
  invoices: SnapshotInvoiceInput[];
};

export type SnapshotRecordInput = {
  id: string;
  step: number;
  approverId: string;
  approverName?: string | null;
  result: string;
  comment?: string | null;
  stepStartedAt: Date | string;
  approvedAt?: Date | string | null;
  verificationAcknowledged?: boolean;
};

export type BuildReportSnapshotInput = {
  snapshotType: Exclude<SnapshotType, 'backfill'>;
  capturedAt?: string;
  legacy?: boolean;
  report: ExpenseReport;
  applicantDepartment?: string | null;
  items: SnapshotDataItem[];
  approvalRecords: SnapshotRecordInput[];
  rule?: ApprovalRule | null;
  action?: {
    recordId: string;
    step: number;
    result: string;
    comment?: string | null;
  } | null;
  paymentReceipt?: PaymentReceipt | null;
  paidByName?: string | null;
};

function iso(value: Date | string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toISOString();
}

function dateOnly(value: Date | string): string {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

function mapInvoice(invoice: SnapshotInvoiceInput): ReportSnapshotInvoice {
  return {
    id: invoice.id,
    fileName: invoice.fileName,
    fileFormat: invoice.fileFormat,
    fileSize: Number(invoice.fileSize),
    checksum: invoice.checksum,
    invoiceNo: invoice.invoiceNo ?? null,
    verificationStatus: invoice.verificationStatus ?? 'pending',
    verificationResult: invoice.verificationResult ?? null,
    verifiedAt: iso(invoice.verifiedAt),
    uploadedAt: iso(invoice.uploadedAt),
  };
}

function mapItem(entry: SnapshotDataItem): ReportSnapshotItem {
  return {
    id: entry.item.id,
    categoryId: entry.item.categoryId,
    categoryName: entry.categoryName ?? null,
    amount: Number(entry.item.amount),
    expenseDate: dateOnly(entry.item.expenseDate),
    description: entry.item.description ?? '',
    invoices: entry.invoices.map(mapInvoice),
  };
}

function mapRule(rule: ApprovalRule): ReportSnapshotRule {
  return {
    id: rule.id,
    name: rule.name,
    minAmount: Number(rule.minAmount),
    maxAmount: Number(rule.maxAmount),
    priority: rule.priority,
    chain: rule.approvalChain.map((step) => ({
      step: step.step,
      role: step.role ?? null,
      assigneeId: step.assigneeId ?? null,
      label: step.label,
    })),
  };
}

function mapRecord(record: SnapshotRecordInput): ReportSnapshotApprovalRecord {
  return {
    id: record.id,
    step: record.step,
    approverId: record.approverId,
    approverName: record.approverName ?? null,
    result: record.result,
    comment: record.comment ?? null,
    stepStartedAt: iso(record.stepStartedAt),
    approvedAt: iso(record.approvedAt),
    verificationAcknowledged: record.verificationAcknowledged ?? false,
  };
}

export function buildReportSnapshotPayload(
  input: BuildReportSnapshotInput
): ReportSnapshotPayload {
  const items = input.items.map(mapItem);
  const invoices = items.flatMap((item) => item.invoices);
  const actionRecord = input.action
    ? input.approvalRecords.find((record) => record.id === input.action!.recordId)
    : undefined;
  const receipt = input.paymentReceipt;

  return {
    schemaVersion: 1,
    snapshotType: input.snapshotType,
    capturedAt: input.capturedAt ?? new Date().toISOString(),
    legacy: input.legacy ?? false,
    report: {
      id: input.report.id,
      serialNo: input.report.serialNo,
      title: input.report.title,
      description: input.report.description ?? null,
      status: input.report.status,
      currentStep: input.report.currentStep,
      totalAmount: Number(input.report.totalAmount),
      userId: input.report.userId,
      applicantName: input.report.applicantName ?? null,
      applicantDepartment: input.applicantDepartment ?? null,
      submittedAt: iso(input.report.submittedAt),
      completedAt: iso(input.report.completedAt),
      paidAt: iso(input.report.paidAt),
      paidBy: input.report.paidBy ?? null,
      paymentRef: input.report.paymentRef ?? null,
      paymentComment: input.report.paymentComment ?? null,
      paymentUpdatedAt: iso(input.report.paymentUpdatedAt),
      paymentUpdatedBy: input.report.paymentUpdatedBy ?? null,
      createdAt: iso(input.report.createdAt) ?? '',
      updatedAt: iso(input.report.updatedAt) ?? '',
    },
    items,
    verification: {
      aggregateStatus: aggregateVerificationStatus(
        invoices.map((invoice) => invoice.verificationStatus)
      ),
      acknowledged: actionRecord?.verificationAcknowledged ?? false,
    },
    approval: {
      rule: input.rule ? mapRule(input.rule) : null,
      records: input.approvalRecords.map(mapRecord),
      action: input.action
        ? {
            recordId: input.action.recordId,
            step: input.action.step,
            result: input.action.result,
            comment: input.action.comment ?? null,
          }
        : null,
    },
    payment:
      input.snapshotType === 'pay'
        ? {
            paidAt: iso(input.report.paidAt),
            paidBy: input.report.paidBy ?? null,
            paidByName: input.paidByName ?? null,
            paymentRef: input.report.paymentRef ?? null,
            paymentComment: input.report.paymentComment ?? null,
            receipt: receipt
              ? {
                  id: receipt.id,
                  fileName: receipt.fileName,
                  fileFormat: receipt.fileFormat,
                  checksum: receipt.checksum,
                  verificationStatus: receipt.verificationStatus,
                  verificationResult: receipt.verificationResult ?? null,
                  verifiedAt: iso(receipt.verifiedAt),
                }
              : null,
          }
        : null,
  };
}
```

- [ ] **Step 4: Export the builder**

Append to `packages/core/src/services/index.ts`:

```ts
export { buildReportSnapshotPayload } from './report-snapshot';
export type {
  BuildReportSnapshotInput,
  SnapshotDataItem,
  SnapshotInvoiceInput,
  SnapshotItemInput,
  SnapshotRecordInput,
} from './report-snapshot';
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm --filter @sse/core test -- report-snapshot`
Expected: PASS (4 tests).

- [ ] **Step 6: Build core**

Run: `pnpm --filter @sse/core build`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/services/report-snapshot.ts packages/core/src/services/__tests__/report-snapshot.test.ts packages/core/src/services/index.ts
git commit -m "feat(core): build immutable report snapshot payloads"
```

---

## Task 3: Migration 023 with append-only table and backfill

**Files:**
- Create: `packages/db/src/migrations/023_report_snapshots.sql`
- Create: `packages/db/src/__tests__/migration-023.test.ts`

- [ ] **Step 1: Write the failing migration test**

Create `packages/db/src/__tests__/migration-023.test.ts`:

```ts
import { readFileSync } from 'fs';
import { join } from 'path';

const sql = readFileSync(
  join(__dirname, '..', 'migrations', '023_report_snapshots.sql'),
  'utf-8'
);

describe('023_report_snapshots', () => {
  it('creates the snapshot table with the expected columns and type check', () => {
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS report_snapshots/i);
    expect(sql).toMatch(/snapshot_type TEXT NOT NULL/i);
    expect(sql).toMatch(/payload JSONB NOT NULL/i);
    expect(sql).toMatch(/content_hash TEXT NOT NULL/i);
    expect(sql).toMatch(/legacy BOOLEAN NOT NULL DEFAULT false/i);
    expect(sql).toMatch(/CHECK \(snapshot_type IN \('submit', 'approve', 'reject', 'pay', 'backfill'\)\)/i);
  });

  it('does not bind snapshots to users or reports with foreign keys', () => {
    expect(sql).not.toMatch(/REFERENCES users/i);
    expect(sql).not.toMatch(/REFERENCES expense_reports/i);
  });

  it('blocks updates and deletes with an append-only trigger', () => {
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION sse_report_snapshots_append_only/i);
    expect(sql).toMatch(/BEFORE UPDATE OR DELETE ON report_snapshots/i);
    expect(sql).toMatch(/RAISE EXCEPTION/i);
  });

  it('computes the content hash with sha256 over the canonical JSONB text', () => {
    expect(sql).toMatch(/encode\(sha256\(convert_to\(p\.payload::text, 'UTF8'\)\), 'hex'\)/i);
  });

  it('backfills one legacy snapshot per non-draft report', () => {
    expect(sql).toMatch(/INSERT INTO report_snapshots/i);
    expect(sql).toMatch(/'backfill'/i);
    expect(sql).toMatch(/WHERE r\.status <> 'draft'/i);
    expect(sql).toMatch(/'legacy', true/i);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @sse/db test -- migration-023`
Expected: FAIL because the migration file does not exist.

- [ ] **Step 3: Create migration 023**

Create `packages/db/src/migrations/023_report_snapshots.sql`:

```sql
CREATE TABLE IF NOT EXISTS report_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id UUID NOT NULL,
  snapshot_type TEXT NOT NULL
    CHECK (snapshot_type IN ('submit', 'approve', 'reject', 'pay', 'backfill')),
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

CREATE OR REPLACE FUNCTION sse_report_snapshots_append_only()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'report_snapshots is append-only (%); insert a new snapshot instead', TG_OP
    USING ERRCODE = '55000';
END;
$$;

DROP TRIGGER IF EXISTS trg_report_snapshots_append_only ON report_snapshots;
CREATE TRIGGER trg_report_snapshots_append_only
  BEFORE UPDATE OR DELETE ON report_snapshots
  FOR EACH ROW
  EXECUTE FUNCTION sse_report_snapshots_append_only();

INSERT INTO report_snapshots (
  report_id,
  snapshot_type,
  schema_version,
  actor_type,
  payload,
  content_hash,
  legacy,
  created_at
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
FROM (
  SELECT
    r.id AS report_id,
    jsonb_build_object(
      'schemaVersion', 1,
      'snapshotType', 'backfill',
      'capturedAt', to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'legacy', true,
      'report', jsonb_build_object(
        'id', r.id,
        'serialNo', r.serial_no,
        'title', r.title,
        'description', r.description,
        'status', r.status,
        'currentStep', r.current_step,
        'totalAmount', r.total_amount,
        'userId', r.user_id,
        'applicantName', u.name,
        'applicantDepartment', u.department,
        'submittedAt', r.submitted_at,
        'completedAt', r.completed_at,
        'paidAt', r.paid_at,
        'paidBy', r.paid_by,
        'paymentRef', r.payment_ref,
        'paymentComment', r.payment_comment,
        'paymentUpdatedAt', r.payment_updated_at,
        'paymentUpdatedBy', r.payment_updated_by,
        'createdAt', r.created_at,
        'updatedAt', r.updated_at
      ),
      'items', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'id', ei.id,
          'categoryId', ei.category_id,
          'categoryName', ec.name,
          'amount', ei.amount,
          'expenseDate', ei.expense_date,
          'description', ei.description,
          'invoices', COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
              'id', i.id,
              'fileName', i.file_name,
              'fileFormat', i.file_format,
              'fileSize', i.file_size,
              'checksum', i.checksum,
              'invoiceNo', i.invoice_no,
              'verificationStatus', i.verification_status,
              'verificationResult', i.verification_result,
              'verifiedAt', i.verified_at,
              'uploadedAt', i.uploaded_at
            ) ORDER BY i.uploaded_at)
            FROM invoices i
            WHERE i.item_id = ei.id
          ), '[]'::jsonb)
        ) ORDER BY ei.expense_date, ei.id)
        FROM expense_items ei
        JOIN expense_categories ec ON ec.id = ei.category_id
        WHERE ei.report_id = r.id
      ), '[]'::jsonb),
      'verification', jsonb_build_object(
        'aggregateStatus', (
          SELECT CASE
            WHEN COUNT(*) = 0 THEN 'no_invoices'
            WHEN bool_or(i.verification_status = 'warning') THEN 'warning'
            WHEN bool_or(i.verification_status = 'error') THEN 'error'
            WHEN bool_or(i.verification_status IN ('unverified', 'pending')) THEN 'unverified'
            ELSE 'pass'
          END
          FROM invoices i
          JOIN expense_items ei ON ei.id = i.item_id
          WHERE ei.report_id = r.id
        ),
        'acknowledged', false
      ),
      'approval', jsonb_build_object(
        'rule', NULL,
        'records', COALESCE((
          SELECT jsonb_agg(jsonb_build_object(
            'id', ar.id,
            'step', ar.step,
            'approverId', ar.approver_id,
            'approverName', au.name,
            'result', ar.result,
            'comment', ar.comment,
            'stepStartedAt', ar.step_started_at,
            'approvedAt', ar.approved_at,
            'verificationAcknowledged', COALESCE(ar.verification_acknowledged, false)
          ) ORDER BY ar.step, ar.step_started_at)
          FROM approval_records ar
          LEFT JOIN users au ON au.id = ar.approver_id
          WHERE ar.report_id = r.id
        ), '[]'::jsonb),
        'action', NULL
      ),
      'payment', CASE WHEN r.status = 'paid' THEN jsonb_build_object(
        'paidAt', r.paid_at,
        'paidBy', r.paid_by,
        'paidByName', pu.name,
        'paymentRef', r.payment_ref,
        'paymentComment', r.payment_comment,
        'receipt', (
          SELECT jsonb_build_object(
            'id', pr.id,
            'fileName', pr.file_name,
            'fileFormat', pr.file_format,
            'checksum', pr.checksum,
            'verificationStatus', pr.verification_status,
            'verificationResult', pr.verification_result,
            'verifiedAt', pr.verified_at
          )
          FROM payment_receipts pr
          WHERE pr.report_id = r.id
        )
      ) ELSE NULL END
    ) AS payload
  FROM expense_reports r
  JOIN users u ON u.id = r.user_id
  LEFT JOIN users pu ON pu.id = r.paid_by
  WHERE r.status <> 'draft'
) p;
```

- [ ] **Step 4: Run the migration test to verify it passes**

Run: `pnpm --filter @sse/db test -- migration-023`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/db/src/migrations/023_report_snapshots.sql packages/db/src/__tests__/migration-023.test.ts
git commit -m "feat(db): add append-only report snapshots migration"
```

---

## Task 4: PgReportSnapshotRepo

**Files:**
- Create: `packages/db/src/repositories/pg-report-snapshot-repo.ts`
- Create: `packages/db/src/__tests__/pg-report-snapshot-repo.test.ts`
- Modify: `packages/db/src/repositories/index.ts`
- Modify: `packages/db/jest.config.js`

- [ ] **Step 1: Map workspace packages in db tests**

Modify `packages/db/jest.config.js` to:

```js
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: ['**/__tests__/**/*.test.ts'],
  moduleNameMapper: {
    '^@sse/(.*)$': '<rootDir>/../$1/src',
  },
};
```

- [ ] **Step 2: Write the failing repo test**

Create `packages/db/src/__tests__/pg-report-snapshot-repo.test.ts`:

```ts
const mockQuery = jest.fn();

jest.mock('../connection', () => ({
  pool: { query: (...args: any[]) => mockQuery(...args) },
}));

import { PgReportSnapshotRepo } from '../repositories/pg-report-snapshot-repo';

beforeEach(() => {
  mockQuery.mockReset();
});

describe('PgReportSnapshotRepo.capture', () => {
  it('loads the report, items, records and receipt, then inserts a hashed snapshot', async () => {
    mockQuery
      .mockResolvedValueOnce({
        rows: [
          {
            id: 'r1',
            serial_no: 'RE-001',
            user_id: 'u1',
            title: '差旅',
            description: null,
            total_amount: '300',
            status: 'pending',
            current_step: 1,
            submitted_at: new Date('2026-11-02T08:00:00Z'),
            completed_at: null,
            paid_at: null,
            paid_by: null,
            payment_ref: null,
            payment_comment: null,
            payment_updated_at: null,
            payment_updated_by: null,
            created_at: new Date('2026-11-01T08:00:00Z'),
            updated_at: new Date('2026-11-02T08:00:00Z'),
            applicant_name: '张三',
            applicant_department: '技术部',
          },
        ],
      })
      .mockResolvedValueOnce({
        rows: [
          {
            id: 'it1',
            report_id: 'r1',
            category_id: 'c1',
            amount: '300',
            expense_date: '2026-11-01',
            description: '高铁票',
            category_name: '交通费',
            invoice_id: 'i1',
            file_name: 'invoice.pdf',
            file_format: 'pdf',
            file_size: 1024,
            checksum: 'abc',
            invoice_no: 'NO-1',
            verification_status: 'pass',
            verification_result: { ok: true },
            verified_at: new Date('2026-11-02T09:00:00Z'),
            uploaded_at: new Date('2026-11-02T08:30:00Z'),
          },
        ],
      })
      .mockResolvedValueOnce({
        rows: [
          {
            id: 'ar1',
            report_id: 'r1',
            step: 1,
            approver_id: 'd1',
            approver_name: '李四',
            step_started_at: new Date('2026-11-02T09:30:00Z'),
            result: 'approved',
            comment: '同意',
            approved_at: new Date('2026-11-02T10:00:00Z'),
            verification_acknowledged: true,
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [
          {
            id: 's1',
            report_id: 'r1',
            snapshot_type: 'approve',
            schema_version: 1,
            approval_record_id: 'ar1',
            step: 1,
            actor_type: 'user',
            actor_id: 'd1',
            actor_role: 'dept_approver',
            content_hash: 'hash',
            legacy: false,
            created_at: new Date('2026-11-02T10:00:00Z'),
          },
        ],
      });

    const result = await new PgReportSnapshotRepo().capture({
      reportId: 'r1',
      snapshotType: 'approve',
      actor: { type: 'user', id: 'd1', role: 'dept_approver' },
      action: { recordId: 'ar1', step: 1, result: 'approved', comment: '同意' },
    });

    expect(result.id).toBe('s1');
    expect(result.snapshotType).toBe('approve');
    const insertCall = mockQuery.mock.calls[4];
    const [insertSql, insertParams] = insertCall;
    expect(insertSql).toContain('INSERT INTO report_snapshots');
    expect(insertSql).toContain('sha256');
    expect(insertParams[1]).toBe('approve');
    expect(insertParams[3]).toBe('ar1');
    const payload = JSON.parse(insertParams[8]);
    expect(payload.report.applicantDepartment).toBe('技术部');
    expect(payload.items[0].invoices[0].invoiceNo).toBe('NO-1');
    expect(payload.verification.acknowledged).toBe(true);
    expect(payload.approval.action).toEqual(
      expect.objectContaining({ recordId: 'ar1', result: 'approved' })
    );
  });
});

describe('PgReportSnapshotRepo reads', () => {
  it('maps snapshot metadata ordered by created_at and id', async () => {
    mockQuery.mockResolvedValue({
      rows: [
        {
          id: 's1',
          report_id: 'r1',
          snapshot_type: 'submit',
          schema_version: 1,
          approval_record_id: null,
          step: null,
          actor_type: 'user',
          actor_id: 'u1',
          actor_role: 'employee',
          content_hash: 'hash',
          legacy: false,
          created_at: new Date('2026-11-02T08:00:00Z'),
        },
      ],
    });

    const items = await new PgReportSnapshotRepo().findByReportId('r1');

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ id: 's1', reportId: 'r1', snapshotType: 'submit' });
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain('ORDER BY created_at DESC, id DESC');
    expect(params).toEqual(['r1']);
  });

  it('returns hashValid from the detail query', async () => {
    mockQuery.mockResolvedValue({
      rows: [
        {
          id: 's1',
          report_id: 'r1',
          snapshot_type: 'pay',
          schema_version: 1,
          actor_type: 'user',
          content_hash: 'hash',
          legacy: false,
          created_at: new Date(),
          payload: { schemaVersion: 1 },
          hash_valid: true,
        },
      ],
    });

    const detail = await new PgReportSnapshotRepo().findDetailById('s1');

    expect(detail?.hashValid).toBe(true);
    expect(detail?.payload).toEqual({ schemaVersion: 1 });
    expect(mockQuery.mock.calls[0][0]).toContain('AS hash_valid');
  });

  it('clamps admin query pagination and returns total', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ count: 3 }] })
      .mockResolvedValueOnce({ rows: [] });

    const result = await new PgReportSnapshotRepo().query({ limit: 5000, offset: -2 });

    expect(result.total).toBe(3);
    const [countSql] = mockQuery.mock.calls[0];
    expect(countSql).toContain('SELECT COUNT(*)::int AS count FROM report_snapshots');
    const [, listParams] = mockQuery.mock.calls[1];
    expect(listParams.slice(-2)).toEqual([200, 0]);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `pnpm --filter @sse/db test -- pg-report-snapshot-repo`
Expected: FAIL because the repository does not exist.

- [ ] **Step 4: Implement the repository**

Create `packages/db/src/repositories/pg-report-snapshot-repo.ts`:

```ts
import type {
  ExpenseReport,
  PaymentReceipt,
  ReportSnapshot,
  ReportSnapshotDetail,
} from '@sse/shared';
import type {
  IReportSnapshotRepo,
  SnapshotCaptureInput,
  SnapshotDataItem,
  SnapshotInvoiceInput,
  SnapshotItemInput,
  SnapshotQuery,
} from '@sse/core';
import { buildReportSnapshotPayload } from '@sse/core';
import { pool } from '../connection';
import type { Queryable } from '../transaction';

const SNAPSHOT_COLUMNS = `id, report_id, snapshot_type, schema_version, approval_record_id,
  step, actor_type, actor_id, actor_role, content_hash, legacy, created_at`;

function mapSnapshot(row: any): ReportSnapshot {
  return {
    id: row.id,
    reportId: row.report_id,
    snapshotType: row.snapshot_type,
    schemaVersion: Number(row.schema_version),
    approvalRecordId: row.approval_record_id ?? undefined,
    step: row.step ?? undefined,
    actorType: row.actor_type,
    actorId: row.actor_id ?? undefined,
    actorRole: row.actor_role ?? undefined,
    contentHash: row.content_hash,
    legacy: row.legacy === true,
    createdAt: row.created_at,
  };
}

function mapDetail(row: any): ReportSnapshotDetail {
  return {
    ...mapSnapshot(row),
    payload: row.payload,
    hashValid: row.hash_valid === true,
  };
}

function mapReport(row: any): ExpenseReport {
  return {
    id: row.id,
    serialNo: row.serial_no,
    userId: row.user_id,
    applicantName: row.applicant_name ?? undefined,
    title: row.title,
    totalAmount: Number(row.total_amount),
    status: row.status,
    currentStep: row.current_step,
    submittedAt: row.submitted_at ?? undefined,
    completedAt: row.completed_at ?? undefined,
    description: row.description ?? undefined,
    paidAt: row.paid_at ?? undefined,
    paidBy: row.paid_by ?? undefined,
    paymentRef: row.payment_ref ?? undefined,
    paymentComment: row.payment_comment ?? undefined,
    paymentUpdatedAt: row.payment_updated_at ?? undefined,
    paymentUpdatedBy: row.payment_updated_by ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapItem(row: any): SnapshotItemInput {
  return {
    id: row.id,
    reportId: row.report_id,
    categoryId: row.category_id,
    amount: Number(row.amount),
    expenseDate: row.expense_date,
    description: row.description ?? '',
  };
}

function mapInvoice(row: any): SnapshotInvoiceInput {
  return {
    id: row.invoice_id,
    fileName: row.file_name,
    fileFormat: row.file_format,
    fileSize: Number(row.file_size),
    checksum: row.checksum,
    invoiceNo: row.invoice_no ?? null,
    verificationStatus: row.verification_status ?? 'pending',
    verificationResult: row.verification_result ?? null,
    verifiedAt: row.verified_at ?? null,
    uploadedAt: row.uploaded_at ?? null,
  };
}

function mapReceipt(row: any): PaymentReceipt {
  return {
    id: row.id,
    reportId: row.report_id,
    fileName: row.file_name,
    fileFormat: row.file_format,
    fileSize: Number(row.file_size),
    storageKey: row.storage_key,
    storageBucket: row.storage_bucket,
    checksum: row.checksum,
    uploadedBy: row.uploaded_by ?? undefined,
    uploadedAt: row.uploaded_at,
    ocrResult: row.ocr_result ?? undefined,
    verificationStatus: row.verification_status ?? 'pending',
    verificationResult: row.verification_result ?? undefined,
    verifiedAt: row.verified_at ?? undefined,
  };
}

export class PgReportSnapshotRepo implements IReportSnapshotRepo {
  async capture(
    input: SnapshotCaptureInput,
    db: Queryable = pool
  ): Promise<ReportSnapshot> {
    const reportRes = await db.query(
      `SELECT er.*, u.name AS applicant_name, u.department AS applicant_department
         FROM expense_reports er
         JOIN users u ON u.id = er.user_id
        WHERE er.id = $1`,
      [input.reportId]
    );
    const reportRow = reportRes.rows[0];
    if (!reportRow) {
      throw new Error(`report not found for snapshot: ${input.reportId}`);
    }

    const itemRes = await db.query(
      `SELECT ei.*, ec.name AS category_name,
              i.id AS invoice_id, i.file_name, i.file_format, i.file_size, i.checksum,
              i.invoice_no, i.verification_status, i.verification_result,
              i.verified_at, i.uploaded_at
         FROM expense_items ei
         JOIN expense_categories ec ON ec.id = ei.category_id
         LEFT JOIN invoices i ON i.item_id = ei.id
        WHERE ei.report_id = $1
        ORDER BY ei.expense_date, ei.id, i.uploaded_at`,
      [input.reportId]
    );

    const recordRes = await db.query(
      `SELECT ar.*, au.name AS approver_name
         FROM approval_records ar
         LEFT JOIN users au ON au.id = ar.approver_id
        WHERE ar.report_id = $1
        ORDER BY ar.step ASC, ar.step_started_at ASC`,
      [input.reportId]
    );

    const receiptRes = await db.query(
      'SELECT * FROM payment_receipts WHERE report_id = $1',
      [input.reportId]
    );

    let paidByName: string | null = null;
    if (reportRow.paid_by) {
      const paidByRes = await db.query('SELECT name FROM users WHERE id = $1', [
        reportRow.paid_by,
      ]);
      paidByName = paidByRes.rows[0]?.name ?? null;
    }

    const itemMap = new Map<string, SnapshotDataItem>();
    for (const row of itemRes.rows) {
      let entry = itemMap.get(row.id);
      if (!entry) {
        entry = {
          item: mapItem(row),
          categoryName: row.category_name ?? null,
          invoices: [],
        };
        itemMap.set(row.id, entry);
      }
      if (row.invoice_id) {
        entry.invoices.push(mapInvoice(row));
      }
    }

    const payload = buildReportSnapshotPayload({
      snapshotType: input.snapshotType,
      report: mapReport(reportRow),
      applicantDepartment: reportRow.applicant_department ?? null,
      items: [...itemMap.values()],
      approvalRecords: recordRes.rows.map((row: any) => ({
        id: row.id,
        step: row.step,
        approverId: row.approver_id,
        approverName: row.approver_name ?? null,
        result: row.result,
        comment: row.comment ?? null,
        stepStartedAt: row.step_started_at,
        approvedAt: row.approved_at,
        verificationAcknowledged: row.verification_acknowledged === true,
      })),
      rule: input.rule ?? null,
      action: input.action ?? null,
      paymentReceipt: receiptRes.rows[0] ? mapReceipt(receiptRes.rows[0]) : null,
      paidByName,
    });

    const { rows } = await db.query(
      `INSERT INTO report_snapshots
         (report_id, snapshot_type, schema_version, approval_record_id, step,
          actor_type, actor_id, actor_role, payload, content_hash, legacy)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb,
               encode(sha256(convert_to(($9::jsonb)::text, 'UTF8')), 'hex'), $10)
       RETURNING ${SNAPSHOT_COLUMNS}`,
      [
        input.reportId,
        input.snapshotType,
        1,
        input.action?.recordId ?? null,
        input.action?.step ?? null,
        input.actor.type,
        input.actor.id ?? null,
        input.actor.role ?? null,
        JSON.stringify(payload),
        false,
      ]
    );

    return mapSnapshot(rows[0]);
  }

  async findByReportId(
    reportId: string,
    db: Queryable = pool
  ): Promise<ReportSnapshot[]> {
    const { rows } = await db.query(
      `SELECT ${SNAPSHOT_COLUMNS}
         FROM report_snapshots
        WHERE report_id = $1
        ORDER BY created_at DESC, id DESC`,
      [reportId]
    );
    return rows.map(mapSnapshot);
  }

  async findDetailById(
    id: string,
    db: Queryable = pool
  ): Promise<ReportSnapshotDetail | null> {
    const { rows } = await db.query(
      `SELECT *, (content_hash = encode(sha256(convert_to(payload::text, 'UTF8')), 'hex')) AS hash_valid
         FROM report_snapshots
        WHERE id = $1`,
      [id]
    );
    return rows.length === 0 ? null : mapDetail(rows[0]);
  }

  async findDetailByReport(
    reportId: string,
    snapshotId: string,
    db: Queryable = pool
  ): Promise<ReportSnapshotDetail | null> {
    const { rows } = await db.query(
      `SELECT *, (content_hash = encode(sha256(convert_to(payload::text, 'UTF8')), 'hex')) AS hash_valid
         FROM report_snapshots
        WHERE id = $1 AND report_id = $2`,
      [snapshotId, reportId]
    );
    return rows.length === 0 ? null : mapDetail(rows[0]);
  }

  async query(
    filter: SnapshotQuery,
    db: Queryable = pool
  ): Promise<{ items: ReportSnapshot[]; total: number }> {
    const conditions: string[] = [];
    const values: any[] = [];
    let idx = 1;

    if (filter.reportId) {
      conditions.push(`report_id = $${idx++}`);
      values.push(filter.reportId);
    }
    if (filter.snapshotType) {
      conditions.push(`snapshot_type = $${idx++}`);
      values.push(filter.snapshotType);
    }
    if (filter.legacy !== undefined) {
      conditions.push(`legacy = $${idx++}`);
      values.push(filter.legacy);
    }
    if (filter.from) {
      conditions.push(`created_at >= $${idx++}`);
      values.push(filter.from);
    }
    if (filter.to) {
      conditions.push(`created_at <= $${idx++}`);
      values.push(filter.to);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const limit = Math.min(Math.max(filter.limit ?? 50, 1), 200);
    const offset = Math.max(filter.offset ?? 0, 0);

    const [countRes, listRes] = await Promise.all([
      db.query(`SELECT COUNT(*)::int AS count FROM report_snapshots ${where}`, values),
      db.query(
        `SELECT ${SNAPSHOT_COLUMNS}
           FROM report_snapshots
          ${where}
          ORDER BY created_at DESC, id DESC
          LIMIT $${idx++} OFFSET $${idx++}`,
        [...values, limit, offset]
      ),
    ]);

    return {
      items: listRes.rows.map(mapSnapshot),
      total: Number(countRes.rows[0]?.count ?? 0),
    };
  }
}
```

- [ ] **Step 5: Export the repository**

Append to `packages/db/src/repositories/index.ts`:

```ts
export { PgReportSnapshotRepo } from './pg-report-snapshot-repo';
```

- [ ] **Step 6: Run the repo test to verify it passes**

Run: `pnpm --filter @sse/db test -- pg-report-snapshot-repo`
Expected: PASS (4 tests).

- [ ] **Step 7: Run all db tests**

Run: `pnpm --filter @sse/db test`
Expected: PASS. If the new `moduleNameMapper` surfaces unrelated failures, fix the imports in the affected test rather than reverting the mapper.

- [ ] **Step 8: Build db**

Run: `pnpm --filter @sse/db build`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add packages/db/src/repositories/pg-report-snapshot-repo.ts packages/db/src/repositories/index.ts packages/db/src/__tests__/pg-report-snapshot-repo.test.ts packages/db/jest.config.js
git commit -m "feat(db): persist report snapshots with hash verification"
```

---

## Task 5: Thread transaction clients through approval writes

**Files:**
- Modify: `packages/core/src/ports/iexpense-repo.ts`
- Modify: `packages/core/src/ports/iapproval-record-repo.ts`
- Modify: `packages/core/src/services/approval-engine.ts`
- Modify: `packages/core/src/services/__tests__/approval-engine.test.ts`
- Modify: `packages/db/src/repositories/pg-expense-repo.ts`
- Modify: `packages/db/src/repositories/pg-approval-record-repo.ts`

- [ ] **Step 1: Write the failing engine test**

Append to `packages/core/src/services/__tests__/approval-engine.test.ts`:

```ts
describe('ApprovalEngine transaction client forwarding', () => {
  const rule: ApprovalRule = {
    id: 'r1',
    name: 'Two step',
    minAmount: 0,
    maxAmount: 10000,
    categoryIds: [],
    approvalChain: [
      { step: 1, role: 'dept_approver', label: '部门审批' },
      { step: 2, role: 'finance', label: '财务审批' },
    ],
    priority: 1,
    isActive: true,
  };

  const ruleRepo = {
    findActive: async () => [rule],
    findById: async () => rule,
    findAll: async () => [rule],
    create: async () => ({}) as any,
    update: async () => {},
    delete: async () => {},
  };

  it('forwards the transaction client to record creation', async () => {
    const db = { query: jest.fn() };
    const create = jest.fn(async (record: any) => ({ ...record, id: 'ar-1' }));
    const recordRepo = {
      findByReportId: async () => [],
      findPendingOverdue: async () => [],
      create,
      updateResult: jest.fn(),
      markReminderSent: async () => {},
      markEscalated: async () => {},
    };
    const userRepo = {
      findById: async () => null,
      findByRole: async (role: string) =>
        role === 'dept_approver' ? [{ id: 'dept-1' } as any] : [],
    };
    const engine = new ApprovalEngine(ruleRepo, recordRepo);

    await engine.startApproval('report-1', rule, userRepo as any, 'tech', db as any);

    expect(create).toHaveBeenCalledWith(expect.objectContaining({ reportId: 'report-1' }), db);
  });

  it('forwards the transaction client to record updates', async () => {
    const db = { query: jest.fn() };
    const updateResult = jest.fn(async () => {});
    const recordRepo = {
      findByReportId: async () => [
        { id: 'ar-1', step: 1, result: 'pending', reportId: 'report-1', approverId: 'd1' },
      ],
      findPendingOverdue: async () => [],
      create: jest.fn(),
      updateResult,
      markReminderSent: async () => {},
      markEscalated: async () => {},
    };
    const engine = new ApprovalEngine(ruleRepo, recordRepo);

    await engine.approveStep('report-1', 1, 'approved', '同意', db as any);

    expect(updateResult).toHaveBeenCalledWith('ar-1', 'approved', '同意', db);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @sse/core test -- approval-engine`
Expected: FAIL — `recordRepo.create`/`updateResult` are not called with the `db` argument.

- [ ] **Step 3: Add the optional `db` parameter to core ports**

Modify `packages/core/src/ports/iexpense-repo.ts`:

```ts
import type { ExpenseReport, CreateReportDto } from '@sse/shared';
import type { SqlExecutor } from './sql-executor';

export interface ExpenseQuery {
  dateFrom?: string;
  dateTo?: string;
  applicantId?: string;
  status?: string;
  categoryId?: string;
  amountMin?: number;
  amountMax?: number;
  keyword?: string;
  page?: number;
  pageSize?: number;
}

export interface IExpenseRepo {
  findById(id: string): Promise<ExpenseReport | null>;
  findMany(query: ExpenseQuery): Promise<{ results: ExpenseReport[]; total: number }>;
  findManyByApprover(approverId: string, page: number, pageSize: number): Promise<{ results: ExpenseReport[]; total: number }>;
  findManyByUser(userId: string, query: ExpenseQuery): Promise<{ results: ExpenseReport[]; total: number }>;
  create(dto: CreateReportDto, userId: string, serialNo: string): Promise<ExpenseReport>;
  updateStatus(id: string, status: string, currentStep?: number, db?: SqlExecutor): Promise<void>;
  markPaid(id: string, paidBy: string, paymentRef?: string, paymentComment?: string): Promise<boolean>;
  updatePayment(
    id: string,
    input: { paymentRef?: string | null; paymentComment?: string | null; updatedBy: string }
  ): Promise<boolean>;
  revertPayment(id: string, updatedBy: string): Promise<boolean>;
  getStatistics(dateFrom?: string, dateTo?: string, department?: string): Promise<any>;
  getUserSummary(userId: string, dateFrom?: string, dateTo?: string): Promise<any>;
}
```

Modify `packages/core/src/ports/iapproval-record-repo.ts`:

```ts
import type { ApprovalRecord } from '@sse/shared';
import type { SqlExecutor } from './sql-executor';

export interface IApprovalRecordRepo {
  findByReportId(reportId: string): Promise<ApprovalRecord[]>;
  findPendingOverdue(): Promise<ApprovalRecord[]>;
  create(record: Omit<ApprovalRecord, 'id'>, db?: SqlExecutor): Promise<ApprovalRecord>;
  updateResult(id: string, result: string, comment?: string, db?: SqlExecutor): Promise<void>;
  markReminderSent(id: string): Promise<void>;
  markEscalated(id: string): Promise<void>;
}
```

- [ ] **Step 4: Update ApprovalEngine signatures**

Modify `packages/core/src/services/approval-engine.ts`:

```ts
import type { ApprovalRule, ApprovalRecord } from '@sse/shared';
import { ApprovalResult } from '@sse/shared';
import type { IApprovalRuleRepo } from '../ports/iapproval-rule-repo';
import type { IApprovalRecordRepo } from '../ports/iapproval-record-repo';
import type { IUserRepo } from '../ports/iuser-repo';
import type { SqlExecutor } from '../ports/sql-executor';
```

Change the three write methods:

```ts
  async startApproval(
    reportId: string,
    rule: ApprovalRule,
    userRepo: IUserRepo,
    ownerDepartment: string,
    db?: SqlExecutor,
  ): Promise<ApprovalRecord> {
    // ...existing body...
    return this.recordRepo.create(record, db);
  }

  async approveStep(
    reportId: string,
    step: number,
    result: string,
    comment?: string,
    db?: SqlExecutor,
  ): Promise<void> {
    const records = await this.recordRepo.findByReportId(reportId);
    for (const record of records) {
      if (record.step === step && record.result === ApprovalResult.PENDING) {
        await this.recordRepo.updateResult(record.id, result, comment, db);
      }
    }
  }

  async createNextStep(
    reportId: string,
    rule: ApprovalRule,
    currentStep: number,
    userRepo: IUserRepo,
    ownerDepartment: string,
    db?: SqlExecutor,
  ): Promise<ApprovalRecord | null> {
    // ...existing body...
    return this.recordRepo.create(record, db);
  }
```

- [ ] **Step 5: Run the core tests to verify they pass**

Run: `pnpm --filter @sse/core test`
Expected: PASS (all suites, including the 2 new forwarding tests).

- [ ] **Step 6: Update the Postgres implementations**

Modify `packages/db/src/repositories/pg-expense-repo.ts`:

```ts
  async updateStatus(
    id: string,
    status: string,
    currentStep?: number,
    db: Queryable = pool
  ): Promise<void> {
    if (currentStep !== undefined) {
      await db.query(
        `UPDATE expense_reports SET status = $1, current_step = $2, updated_at = NOW() WHERE id = $3`,
        [status, currentStep, id]
      );
    } else {
      await db.query(
        `UPDATE expense_reports SET status = $1, updated_at = NOW() WHERE id = $2`,
        [status, id]
      );
    }
  }
```

Modify `packages/db/src/repositories/pg-approval-record-repo.ts`:

```ts
  async create(
    record: Omit<ApprovalRecord, 'id'>,
    db: Queryable = pool
  ): Promise<ApprovalRecord> {
    const { rows } = await db.query(
      `INSERT INTO approval_records (report_id, step, approver_id, step_started_at, result, comment)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [
        record.reportId,
        record.step,
        record.approverId,
        record.stepStartedAt,
        record.result,
        record.comment ?? null,
      ]
    );
    return mapRecord(rows[0]);
  }

  async updateResult(
    id: string,
    result: string,
    comment?: string,
    db: Queryable = pool
  ): Promise<void> {
    await db.query(
      `UPDATE approval_records SET result = $1, comment = $2, approved_at = CASE WHEN $1 IN ('approved', 'rejected') THEN NOW() ELSE approved_at END
       WHERE id = $3`,
      [result, comment ?? null, id]
    );
  }
```

Add the import at the top of `pg-approval-record-repo.ts`:

```ts
import type { Queryable } from '../transaction';
```

(`pg-expense-repo.ts` already imports `Queryable`.)

- [ ] **Step 7: Run db tests and build**

Run: `pnpm --filter @sse/db test; if ($?) { pnpm --filter @sse/db build }`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/core/src/ports/iexpense-repo.ts packages/core/src/ports/iapproval-record-repo.ts packages/core/src/services/approval-engine.ts packages/core/src/services/__tests__/approval-engine.test.ts packages/db/src/repositories/pg-expense-repo.ts packages/db/src/repositories/pg-approval-record-repo.ts
git commit -m "refactor: thread transaction client through approval writes"
```

---

## Task 6: Capture snapshots in expense and approval routes

**Files:**
- Modify: `packages/api/src/routes/expenses.ts`
- Modify: `packages/api/src/routes/approvals.ts`
- Create: `packages/api/src/routes/admin-snapshots.ts`
- Modify: `packages/api/src/index.ts`
- Create: `packages/api/src/__tests__/expenses-snapshots.test.ts`
- Create: `packages/api/src/__tests__/admin-snapshots.test.ts`

- [ ] **Step 1: Write the failing expense snapshot route test**

Create `packages/api/src/__tests__/expenses-snapshots.test.ts`:

```ts
const mockQuery = jest.fn();
const mockFindById = jest.fn();
const mockFindByReportId = jest.fn();
const mockFindDetailByReport = jest.fn();
const mockCapture = jest.fn();
const mockUserFindById = jest.fn();

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
  PgReportSnapshotRepo: jest.fn().mockImplementation(() => ({
    capture: mockCapture,
    findByReportId: mockFindByReportId,
    findDetailByReport: mockFindDetailByReport,
  })),
  PgInvoiceRepo: jest.fn().mockImplementation(() => ({})),
  PgApprovalRuleRepo: jest.fn().mockImplementation(() => ({
    findActive: jest.fn(async () => []),
  })),
  PgApprovalRecordRepo: jest.fn().mockImplementation(() => ({})),
  PgUserRepo: jest.fn().mockImplementation(() => ({ findById: mockUserFindById })),
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
  status: 'pending',
  currentStep: 1,
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe('GET /expenses/:id/snapshots', () => {
  it('allows the owner and returns snapshot metadata', async () => {
    mockFindById.mockResolvedValue(report);
    mockQuery.mockResolvedValue({ rows: [{ department: '技术部' }] });
    mockFindByReportId.mockResolvedValue([
      { id: 's1', reportId: 'r1', snapshotType: 'submit' },
    ]);
    const token = signToken({ userId: 'owner-1', role: 'employee', department: '技术部' });

    const response = await fetch(`${url}/expenses/r1/snapshots`, {
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.items).toHaveLength(1);
    expect(mockFindByReportId).toHaveBeenCalledWith('r1');
  });

  it('blocks unrelated employees', async () => {
    mockFindById.mockResolvedValue(report);
    mockQuery.mockResolvedValue({ rows: [{ department: '技术部' }] });
    const token = signToken({ userId: 'other-1', role: 'employee', department: '市场部' });

    const response = await fetch(`${url}/expenses/r1/snapshots`, {
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.status).toBe(403);
    expect(mockFindByReportId).not.toHaveBeenCalled();
  });
});

describe('POST /expenses/:id/submit snapshot capture', () => {
  it('captures a submit snapshot inside the transaction', async () => {
    mockFindById.mockResolvedValue({ ...report, status: 'draft' });
    mockUserFindById.mockResolvedValue({ id: 'owner-1', department: '技术部' });
    mockQuery
      .mockResolvedValueOnce({ rows: [{ category_id: 'c1' }] })
      .mockResolvedValueOnce({ rows: [] });
    mockCapture.mockResolvedValue({ id: 's1' });
    const token = signToken({ userId: 'owner-1', role: 'employee', department: '技术部' });

    const response = await fetch(`${url}/expenses/r1/submit`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.status).toBe(200);
    expect(mockCapture).toHaveBeenCalledTimes(1);
    expect(mockCapture.mock.calls[0][0]).toEqual({
      reportId: 'r1',
      snapshotType: 'submit',
      actor: { type: 'user', id: 'owner-1', role: 'employee' },
      rule: null,
    });
    expect(mockCapture.mock.calls[0][1]).toBeTruthy();
  });
});
```

- [ ] **Step 2: Write the failing admin snapshot route test**

Create `packages/api/src/__tests__/admin-snapshots.test.ts`:

```ts
const mockQuery = jest.fn();
const mockSnapshotQuery = jest.fn();
const mockFindDetailById = jest.fn();

jest.mock('@sse/db', () => ({
  pool: { query: (...args: any[]) => mockQuery(...args) },
  PgReportSnapshotRepo: jest.fn().mockImplementation(() => ({
    query: mockSnapshotQuery,
    findDetailById: mockFindDetailById,
  })),
}));

import express from 'express';
import type { AddressInfo } from 'net';
import type { Server } from 'http';
import { signToken } from '@sse/auth';
import { adminSnapshotRoutes } from '../routes/admin-snapshots';
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
  app.use('/admin/snapshots', adminSnapshotRoutes);
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

describe('GET /admin/snapshots', () => {
  it('rejects non-admin users', async () => {
    const token = signToken({ userId: 'f1', role: 'finance', department: '财务部' });

    const response = await fetch(`${url}/admin/snapshots`, {
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.status).toBe(403);
    expect(mockSnapshotQuery).not.toHaveBeenCalled();
  });

  it('returns filtered snapshots for admins', async () => {
    mockSnapshotQuery.mockResolvedValue({ items: [{ id: 's1' }], total: 1 });
    const token = signToken({ userId: 'a1', role: 'admin', department: '管理部' });

    const response = await fetch(
      `${url}/admin/snapshots?reportId=r1&snapshotType=pay&legacy=false&limit=10&offset=0`,
      { headers: { authorization: `Bearer ${token}` } }
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.total).toBe(1);
    expect(mockSnapshotQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        reportId: 'r1',
        snapshotType: 'pay',
        legacy: false,
        limit: 10,
        offset: 0,
      })
    );
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `pnpm --filter @sse/api test -- snapshots`
Expected: FAIL — `admin-snapshots` route and snapshot endpoints do not exist.

- [ ] **Step 4: Update the expenses route imports and singletons**

At the top of `packages/api/src/routes/expenses.ts`, add `PgReportSnapshotRepo` to the `@sse/db` import, add `ApprovalEngine` to the `@sse/core` import, and instantiate the repo/engine:

```ts
import {
  PgExpenseRepo,
  PgInvoiceRepo,
  PgApprovalRuleRepo,
  PgApprovalRecordRepo,
  PgUserRepo,
  PgPaymentReceiptRepo,
  PgPaymentAuditRepo,
  PgReportSnapshotRepo,
  pool,
  withTransaction,
} from '@sse/db';
import {
  ReportService,
  aggregateVerificationStatus,
  planItemSync,
  shouldReOcr,
  verifyInvoices,
  evaluateReportDeletion,
  NoApproverError,
  ApprovalEngine,
} from '@sse/core';
```

Add after `const paymentAuditRepo = ...`:

```ts
const snapshotRepo = new PgReportSnapshotRepo();
const approvalEngine = new ApprovalEngine(ruleRepo, recordRepo);
```

- [ ] **Step 5: Add snapshot read endpoints**

Insert after the `GET /:id` route (before the `POST /:id/submit` route):

```ts
router.get(
  '/:id/snapshots',
  asyncWrap(async (req, res) => {
    const report = await expenseRepo.findById(req.params.id);
    if (!report) throw new AppError(404, 'NOT_FOUND', '报销单不存在');
    await assertReportAccess(report, req.user!);
    const items = await snapshotRepo.findByReportId(report.id);
    res.json({ items });
  })
);

router.get(
  '/:id/snapshots/:snapshotId',
  asyncWrap(async (req, res) => {
    const report = await expenseRepo.findById(req.params.id);
    if (!report) throw new AppError(404, 'NOT_FOUND', '报销单不存在');
    await assertReportAccess(report, req.user!);
    const detail = await snapshotRepo.findDetailByReport(report.id, req.params.snapshotId);
    if (!detail) throw new AppError(404, 'NOT_FOUND', '快照不存在');
    res.json(detail);
  })
);
```

- [ ] **Step 6: Replace the submit route with a transactional version**

Replace the existing `POST /:id/submit` handler body (lines starting at `router.post('/:id/submit'` through the closing `);`) with:

```ts
router.post(
  '/:id/submit',
  asyncWrap(async (req, res) => {
    const { id } = req.params;
    const { userId, role } = req.user!;

    const report = await expenseRepo.findById(id);
    if (!report) throw new AppError(404, 'NOT_FOUND', '报销单不存在');
    if (report.userId !== userId) throw new AppError(403, 'UNAUTHORIZED', '无权操作');
    if (report.status !== ReportStatus.DRAFT && report.status !== ReportStatus.REJECTED) {
      throw new AppError(400, 'INVALID_PARAMS', '只能提交草稿或已驳回状态的报销单');
    }

    const { rows: items } = await pool.query(
      'SELECT category_id FROM expense_items WHERE report_id = $1',
      [id]
    );
    const categoryIds = items.map((r: any) => r.category_id);

    const matchedRule = await approvalEngine.matchRule(report.totalAmount, categoryIds);
    const userRepo = new PgUserRepo();
    const reporter = await userRepo.findById(report.userId);
    const dept = reporter?.department || '';

    if (matchedRule && matchedRule.approvalChain.length > 1) {
      const { effectiveChain, merged } = await approvalEngine.dedupeApprovalChain(
        matchedRule,
        userRepo,
        dept
      );
      if (merged) {
        matchedRule.approvalChain = effectiveChain;
      }
    }

    await withTransaction(pool, async (client) => {
      let currentStep = 0;
      if (matchedRule && matchedRule.approvalChain.length > 0) {
        const firstStep = matchedRule.approvalChain[0];
        if (firstStep.role || firstStep.assigneeId) {
          try {
            const record = await approvalEngine.startApproval(
              id,
              matchedRule,
              userRepo,
              dept,
              client
            );
            currentStep = record.step;
          } catch (error) {
            if (error instanceof NoApproverError) {
              throw new AppError(
                400,
                'NO_APPROVER',
                '未找到该审批步骤的审批人，请检查部门与角色配置'
              );
            }
            throw error;
          }
        }
      }

      await client.query(
        'UPDATE expense_reports SET status = $1, current_step = $2, submitted_at = NOW(), updated_at = NOW() WHERE id = $3',
        [ReportStatus.PENDING, currentStep, id]
      );

      await snapshotRepo.capture(
        {
          reportId: id,
          snapshotType: 'submit',
          actor: { type: 'user', id: userId, role },
          rule: matchedRule,
        },
        client
      );
    });

    res.json({ message: '提交成功', status: ReportStatus.PENDING });
  })
);
```

- [ ] **Step 7: Capture the payment snapshot**

In `packages/api/src/routes/expenses.ts`, inside the existing `POST /:id/pay` `withTransaction` block, after `paymentAuditRepo.create(...)` and before the block closes, add:

```ts
      await snapshotRepo.capture(
        {
          reportId: id,
          snapshotType: 'pay',
          actor: { type: 'user', id: userId, role },
          rule: null,
        },
        client
      );
```

- [ ] **Step 8: Update the approval route imports**

At the top of `packages/api/src/routes/approvals.ts`, change the `@sse/db` import to:

```ts
import {
  PgApprovalRecordRepo,
  PgExpenseRepo,
  PgApprovalRuleRepo,
  PgUserRepo,
  PgReportSnapshotRepo,
  pool,
  withTransaction,
} from '@sse/db';
```

Add after `const engine = ...`:

```ts
const snapshotRepo = new PgReportSnapshotRepo();
```

Also update the existing `packages/api/src/__tests__/approvals-pending.test.ts` `@sse/db` mock so importing the route still works:

```ts
jest.mock('@sse/db', () => ({
  pool: { query: (...args: any[]) => mockQuery(...args) },
  withTransaction: jest.fn(),
  PgApprovalRecordRepo: jest.fn().mockImplementation(() => ({})),
  PgExpenseRepo: jest.fn().mockImplementation(() => ({})),
  PgApprovalRuleRepo: jest.fn().mockImplementation(() => ({})),
  PgUserRepo: jest.fn().mockImplementation(() => ({})),
  PgReportSnapshotRepo: jest.fn().mockImplementation(() => ({})),
}));
```

- [ ] **Step 9: Replace the approve handler's write section**

In `packages/api/src/routes/approvals.ts`, keep the validation and rule-matching logic up to the `isLast` precheck. First **delete the existing pre-transaction acknowledgement update**:

```ts
    if (acknowledgeVerification === true) {
      await pool.query(
        'UPDATE approval_records SET verification_acknowledged = true WHERE id = $1',
        [pendingRecord.id]
      );
    }
```

It moves inside the transaction below. Then replace the block from `await engine.approveStep(` through the final `res.json(...)` with:

```ts
    const action = {
      recordId: pendingRecord.id,
      step: pendingRecord.step,
      result: ApprovalResult.APPROVED,
      comment,
    };

    let nextStep: number | null = null;
    await withTransaction(pool, async (client) => {
      if (acknowledgeVerification === true) {
        await client.query(
          'UPDATE approval_records SET verification_acknowledged = true WHERE id = $1',
          [pendingRecord.id]
        );
      }

      await engine.approveStep(
        reportId,
        pendingRecord.step,
        ApprovalResult.APPROVED,
        comment,
        client
      );

      if (!matchedRule || isLast) {
        await expenseRepo.updateStatus(reportId, ReportStatus.APPROVED, undefined, client);
      } else {
        const nextRecord = await engine.createNextStep(
          reportId,
          matchedRule,
          pendingRecord.step,
          userRepo,
          ownerDepartment,
          client
        );
        if (!nextRecord) {
          throw new AppError(
            400,
            'NO_APPROVER',
            '未找到下一审批步骤的审批人，请检查部门与角色配置'
          );
        }
        nextStep = nextRecord.step;
        await expenseRepo.updateStatus(reportId, ReportStatus.PENDING, nextRecord.step, client);
      }

      await snapshotRepo.capture(
        {
          reportId,
          snapshotType: 'approve',
          actor: { type: 'user', id: userId, role },
          rule: matchedRule,
          action,
        },
        client
      );
    });

    if (!matchedRule) {
      notifyApproved(report);
      res.json({
        message: '审批成功（无匹配规则，直接通过）',
        result: ApprovalResult.APPROVED,
      });
      return;
    }

    if (isLast) {
      notifyApproved(report);
      res.json({ message: '审批成功，流程结束', result: ApprovalResult.APPROVED });
      return;
    }

    res.json({
      message: '审批成功，已推进至下一审批步骤',
      result: ApprovalResult.APPROVED,
      nextStep,
    });
```

- [ ] **Step 10: Replace the reject handler's write section**

In the reject handler, replace `await engine.approveStep(...)` and `await expenseRepo.updateStatus(...)` with:

```ts
    await withTransaction(pool, async (client) => {
      await engine.approveStep(
        reportId,
        pendingRecord.step,
        ApprovalResult.REJECTED,
        comment,
        client
      );
      await expenseRepo.updateStatus(reportId, ReportStatus.REJECTED, undefined, client);
      await snapshotRepo.capture(
        {
          reportId,
          snapshotType: 'reject',
          actor: { type: 'user', id: userId, role },
          rule: null,
          action: {
            recordId: pendingRecord.id,
            step: pendingRecord.step,
            result: ApprovalResult.REJECTED,
            comment,
          },
        },
        client
      );
    });
```

Keep the existing notification and `res.json` after the transaction.

- [ ] **Step 11: Create the admin snapshot routes**

Create `packages/api/src/routes/admin-snapshots.ts`:

```ts
import { Router, Request, Response, NextFunction } from 'express';
import { PgReportSnapshotRepo } from '@sse/db';
import { authMiddleware } from '@sse/auth';
import { requireRole } from '../middleware/rbac';
import { UserRole } from '@sse/shared';
import { AppError } from '../middleware/error';

const router = Router();
const snapshotRepo = new PgReportSnapshotRepo();

function asyncWrap(fn: (req: Request, res: Response, next: NextFunction) => Promise<void>) {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

function parseDate(value: unknown, label: string): string | undefined {
  if (value === undefined || value === '') return undefined;
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) {
    throw new AppError(400, 'INVALID_PARAMS', `${label} 时间格式无效`);
  }
  return value;
}

function parseBoolean(value: unknown): boolean | undefined {
  if (value === undefined || value === '') return undefined;
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw new AppError(400, 'INVALID_PARAMS', 'legacy 参数无效');
}

router.use(authMiddleware);
router.use(requireRole(UserRole.ADMIN));

router.get(
  '/',
  asyncWrap(async (req, res) => {
    const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200);
    const offset = Math.max(Number(req.query.offset) || 0, 0);
    const stringParam = (value: unknown): string | undefined =>
      typeof value === 'string' && value !== '' ? value : undefined;

    const { items, total } = await snapshotRepo.query({
      reportId: stringParam(req.query.reportId),
      snapshotType: stringParam(req.query.snapshotType),
      legacy: parseBoolean(req.query.legacy),
      from: parseDate(req.query.from, 'from'),
      to: parseDate(req.query.to, 'to'),
      limit,
      offset,
    });

    res.json({ items, total, limit, offset });
  })
);

router.get(
  '/:id',
  asyncWrap(async (req, res) => {
    const detail = await snapshotRepo.findDetailById(req.params.id);
    if (!detail) throw new AppError(404, 'NOT_FOUND', '快照不存在');
    res.json(detail);
  })
);

export { router as adminSnapshotRoutes };
```

- [ ] **Step 12: Mount the admin snapshot router**

In `packages/api/src/index.ts`, add the import:

```ts
import { adminSnapshotRoutes } from './routes/admin-snapshots';
```

Mount it before the generic admin router:

```ts
app.use('/admin/snapshots', adminSnapshotRoutes);
app.use('/admin', adminRoutes);
```

- [ ] **Step 13: Run the new API tests**

Run: `pnpm --filter @sse/api test -- snapshots`
Expected: PASS (4 tests).

- [ ] **Step 14: Run the full API suite**

Run: `pnpm --filter @sse/api test`
Expected: PASS. Fix any tests that assumed the old non-transactional write paths.

- [ ] **Step 15: Build the API**

Run: `pnpm --filter @sse/api build`
Expected: PASS.

- [ ] **Step 16: Commit**

```bash
git add packages/api/src/routes/expenses.ts packages/api/src/routes/approvals.ts packages/api/src/routes/admin-snapshots.ts packages/api/src/index.ts packages/api/src/__tests__/expenses-snapshots.test.ts packages/api/src/__tests__/admin-snapshots.test.ts
git commit -m "feat(api): capture report snapshots in submit, approval and payment"
```

---

## Task 7: Web snapshot viewer and admin page

**Files:**
- Create: `packages/web/src/utils/snapshot.ts`
- Create: `packages/web/src/utils/__tests__/snapshot.test.ts`
- Create: `packages/web/src/components/SnapshotViewer.vue`
- Create: `packages/web/src/components/ReportSnapshots.vue`
- Create: `packages/web/src/pages/AdminSnapshots.vue`
- Modify: `packages/web/src/pages/ExpenseDetail.vue`
- Modify: `packages/web/src/router/index.ts`
- Modify: `packages/web/src/layouts/DefaultLayout.vue`

- [ ] **Step 1: Write the failing utility test**

Create `packages/web/src/utils/__tests__/snapshot.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  formatSnapshotTime,
  shortHash,
  snapshotActorLabel,
  snapshotTypeLabel,
} from '../snapshot';

describe('snapshotTypeLabel', () => {
  it('maps known snapshot types to Chinese labels', () => {
    expect(snapshotTypeLabel('submit')).toBe('提交');
    expect(snapshotTypeLabel('approve')).toBe('审批通过');
    expect(snapshotTypeLabel('reject')).toBe('驳回');
    expect(snapshotTypeLabel('pay')).toBe('付款');
    expect(snapshotTypeLabel('backfill')).toBe('历史回填');
  });

  it('falls back to the raw value', () => {
    expect(snapshotTypeLabel('custom')).toBe('custom');
    expect(snapshotTypeLabel(null)).toBe('-');
  });
});

describe('shortHash', () => {
  it('truncates long hashes and preserves short values', () => {
    expect(shortHash('abcdefghijklmnop', 8)).toBe('abcdefgh…');
    expect(shortHash('abc', 8)).toBe('abc');
    expect(shortHash(null)).toBe('-');
  });
});

describe('formatSnapshotTime', () => {
  it('formats valid timestamps and preserves invalid values', () => {
    expect(formatSnapshotTime('2026-11-21T08:05:00Z')).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
    expect(formatSnapshotTime('not-a-date')).toBe('not-a-date');
    expect(formatSnapshotTime(null)).toBe('-');
  });
});

describe('snapshotActorLabel', () => {
  it('prefers role and handles system actors', () => {
    expect(snapshotActorLabel({ actorType: 'system' })).toBe('系统');
    expect(snapshotActorLabel({ actorType: 'user', actorRole: 'finance' })).toBe('finance');
    expect(snapshotActorLabel({ actorType: 'user', actorId: 'u1' })).toBe('u1');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @sse/web test -- snapshot`
Expected: FAIL because `../snapshot` does not exist.

- [ ] **Step 3: Implement the utility**

Create `packages/web/src/utils/snapshot.ts`:

```ts
export const SNAPSHOT_TYPE_LABELS: Record<string, string> = {
  submit: '提交',
  approve: '审批通过',
  reject: '驳回',
  pay: '付款',
  backfill: '历史回填',
};

export function snapshotTypeLabel(type?: string | null): string {
  if (!type) return '-';
  return SNAPSHOT_TYPE_LABELS[type] || type;
}

export function shortHash(hash?: string | null, length = 12): string {
  if (!hash) return '-';
  return hash.length <= length ? hash : `${hash.slice(0, length)}…`;
}

export function formatSnapshotTime(value?: string | null): string {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(
    date.getHours()
  )}:${pad(date.getMinutes())}`;
}

export function snapshotActorLabel(snapshot: {
  actorType?: string;
  actorRole?: string;
  actorId?: string | null;
}): string {
  if (snapshot.actorType === 'system') return '系统';
  return snapshot.actorRole || snapshot.actorId || '-';
}
```

- [ ] **Step 4: Run the utility test to verify it passes**

Run: `pnpm --filter @sse/web test -- snapshot`
Expected: PASS (4 tests).

- [ ] **Step 5: Create the snapshot viewer component**

Create `packages/web/src/components/SnapshotViewer.vue`:

```vue
<template>
  <div v-if="modelValue" class="snapshot-overlay" @click.self="close">
    <div class="snapshot-dialog">
      <div class="snapshot-header">
        <div>
          <h3 class="font-heading">内容快照 · {{ snapshotTypeLabel(snapshot?.snapshotType) }}</h3>
          <div class="snapshot-meta">
            <span>{{ formatSnapshotTime(snapshot?.createdAt) }}</span>
            <span v-if="snapshot?.legacy" class="badge badge-draft">历史回填</span>
            <span v-if="snapshot" class="badge" :class="snapshot.hashValid ? 'badge-approved' : 'badge-rejected'">
              {{ snapshot.hashValid ? '哈希校验通过' : '哈希校验失败' }}
            </span>
          </div>
        </div>
        <button class="btn-secondary btn-sm" @click="close">关闭</button>
      </div>

      <div v-if="!payload" class="snapshot-loading">加载中…</div>
      <div v-else class="snapshot-body">
        <section>
          <h4>主单</h4>
          <div class="info-grid">
            <div><span class="info-label">单号</span><span class="info-value">{{ payload.report.serialNo }}</span></div>
            <div><span class="info-label">标题</span><span class="info-value">{{ payload.report.title }}</span></div>
            <div><span class="info-label">申请人</span><span class="info-value">{{ payload.report.applicantName || '-' }}</span></div>
            <div><span class="info-label">部门</span><span class="info-value">{{ payload.report.applicantDepartment || '-' }}</span></div>
            <div><span class="info-label">状态</span><span class="info-value">{{ payload.report.status }}</span></div>
            <div><span class="info-label">金额</span><span class="info-value">&yen;{{ Number(payload.report.totalAmount).toLocaleString() }}</span></div>
            <div><span class="info-label">提交时间</span><span class="info-value">{{ formatSnapshotTime(payload.report.submittedAt) }}</span></div>
            <div><span class="info-label">创建时间</span><span class="info-value">{{ formatSnapshotTime(payload.report.createdAt) }}</span></div>
          </div>
        </section>

        <section>
          <h4>费用明细</h4>
          <table class="data-table">
            <thead><tr><th>日期</th><th>类别</th><th>说明</th><th>金额</th><th>发票</th></tr></thead>
            <tbody>
              <tr v-for="item in payload.items" :key="item.id">
                <td>{{ item.expenseDate }}</td>
                <td>{{ item.categoryName || '-' }}</td>
                <td>{{ item.description || '-' }}</td>
                <td>&yen;{{ Number(item.amount).toLocaleString() }}</td>
                <td>
                  <div v-if="item.invoices.length === 0" class="text-secondary">无</div>
                  <div v-for="inv in item.invoices" :key="inv.id" class="invoice-line">
                    {{ inv.fileName }}
                    <span class="badge" :class="inv.verificationStatus === 'pass' ? 'badge-approved' : 'badge-pending'">
                      {{ inv.verificationStatus }}
                    </span>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </section>

        <section>
          <h4>AI 核对</h4>
          <div class="info-grid">
            <div><span class="info-label">汇总状态</span><span class="info-value">{{ payload.verification.aggregateStatus }}</span></div>
            <div><span class="info-label">已确认</span><span class="info-value">{{ payload.verification.acknowledged ? '是' : '否' }}</span></div>
          </div>
        </section>

        <section>
          <h4>审批</h4>
          <div v-if="payload.approval.rule" class="rule-name">
            规则：{{ payload.approval.rule.name }}（{{ payload.approval.rule.chain.map(s => s.label).join(' → ') }}）
          </div>
          <div v-else class="text-secondary">审批规则：未记录</div>
          <table class="data-table">
            <thead><tr><th>步骤</th><th>审批人</th><th>结果</th><th>意见</th><th>时间</th></tr></thead>
            <tbody>
              <tr v-for="record in payload.approval.records" :key="record.id">
                <td>{{ record.step }}</td>
                <td>{{ record.approverName || record.approverId }}</td>
                <td>{{ record.result }}</td>
                <td>{{ record.comment || '-' }}</td>
                <td>{{ formatSnapshotTime(record.approvedAt || record.stepStartedAt) }}</td>
              </tr>
              <tr v-if="payload.approval.records.length === 0"><td colspan="5" class="text-secondary">暂无审批记录</td></tr>
            </tbody>
          </table>
        </section>

        <section v-if="payload.payment">
          <h4>付款</h4>
          <div class="info-grid">
            <div><span class="info-label">付款时间</span><span class="info-value">{{ formatSnapshotTime(payload.payment.paidAt) }}</span></div>
            <div><span class="info-label">付款人</span><span class="info-value">{{ payload.payment.paidByName || payload.payment.paidBy || '-' }}</span></div>
            <div><span class="info-label">凭证号</span><span class="info-value">{{ payload.payment.paymentRef || '-' }}</span></div>
            <div><span class="info-label">备注</span><span class="info-value">{{ payload.payment.paymentComment || '-' }}</span></div>
            <div><span class="info-label">回单</span><span class="info-value">{{ payload.payment.receipt?.fileName || '-' }}</span></div>
          </div>
        </section>

        <section>
          <h4>完整性</h4>
          <p class="hash-line">schema v{{ snapshot?.schemaVersion }} · <code>{{ snapshot?.contentHash }}</code></p>
        </section>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { formatSnapshotTime, snapshotTypeLabel } from '../utils/snapshot'

const props = defineProps<{
  modelValue: boolean
  snapshot: any | null
}>()

const emit = defineEmits<{ 'update:modelValue': [value: boolean] }>()

const payload = computed(() => props.snapshot?.payload || null)

function close() {
  emit('update:modelValue', false)
}
</script>

<style scoped>
.snapshot-overlay {
  position: fixed; inset: 0; background: rgba(0,0,0,0.45);
  display: flex; align-items: center; justify-content: center; z-index: 1000;
}
.snapshot-dialog {
  background: var(--bg-card); border-radius: var(--radius-lg, 12px);
  width: min(960px, 94vw); max-height: 90vh; overflow: auto;
  padding: 20px; box-shadow: 0 20px 60px rgba(0,0,0,0.25);
}
.snapshot-header { display: flex; justify-content: space-between; gap: 12px; align-items: flex-start; }
.snapshot-header h3 { margin: 0 0 6px; }
.snapshot-meta { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; font-size: 0.8rem; color: var(--text-muted); }
.snapshot-body section { margin-top: 20px; }
.snapshot-body h4 { margin: 0 0 10px; font-size: 0.95rem; }
.info-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px 20px; }
.info-label { display: block; font-size: 0.75rem; color: var(--text-muted); }
.info-value { font-size: 0.9rem; color: var(--text-primary); }
.rule-name { font-size: 0.8rem; color: var(--accent-sky); margin-bottom: 8px; }
.invoice-line { display: flex; gap: 6px; align-items: center; font-size: 0.8rem; }
.hash-line { font-size: 0.8rem; color: var(--text-muted); word-break: break-all; }
.snapshot-loading { padding: 40px 0; text-align: center; color: var(--text-muted); }
</style>
```

- [ ] **Step 6: Create the report snapshot card**

Create `packages/web/src/components/ReportSnapshots.vue`:

```vue
<template>
  <div class="card">
    <h3 class="card-section-title font-heading">内容快照</h3>
    <div v-if="loading" class="no-data">加载中…</div>
    <div v-else-if="items.length === 0" class="no-data">暂无快照</div>
    <div v-else class="snapshot-list">
      <div v-for="item in items" :key="item.id" class="snapshot-row">
        <div class="snapshot-row-main">
          <span class="snapshot-type">{{ snapshotTypeLabel(item.snapshotType) }}</span>
          <span class="snapshot-time">{{ formatSnapshotTime(item.createdAt) }}</span>
          <span class="snapshot-actor">{{ snapshotActorLabel(item) }}</span>
          <span v-if="item.legacy" class="badge badge-draft">历史回填</span>
        </div>
        <button class="table-link" :disabled="loadingDetail === item.id" @click="open(item.id)">
          {{ loadingDetail === item.id ? '加载中…' : '查看' }}
        </button>
      </div>
    </div>

    <SnapshotViewer v-model="showViewer" :snapshot="selected" />
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
import api from '../api/index'
import SnapshotViewer from './SnapshotViewer.vue'
import { formatSnapshotTime, snapshotActorLabel, snapshotTypeLabel } from '../utils/snapshot'

const props = defineProps<{ reportId: string }>()

const items = ref<any[]>([])
const loading = ref(true)
const loadingDetail = ref('')
const showViewer = ref(false)
const selected = ref<any>(null)

async function load() {
  loading.value = true
  try {
    const res = await api.get(`/expenses/${props.reportId}/snapshots`)
    items.value = res.data.items || []
  } catch {
    items.value = []
  } finally {
    loading.value = false
  }
}

async function open(id: string) {
  loadingDetail.value = id
  try {
    const res = await api.get(`/expenses/${props.reportId}/snapshots/${id}`)
    selected.value = res.data
    showViewer.value = true
  } catch (e: any) {
    alert(e?.response?.data?.error?.message || '加载快照失败')
  } finally {
    loadingDetail.value = ''
  }
}

onMounted(load)
</script>

<style scoped>
.snapshot-list { display: flex; flex-direction: column; gap: 8px; }
.snapshot-row { display: flex; justify-content: space-between; align-items: center; gap: 12px; padding: 8px 0; border-bottom: 1px solid var(--border-light); }
.snapshot-row:last-child { border-bottom: none; }
.snapshot-row-main { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; }
.snapshot-type { font-size: 0.85rem; font-weight: 600; color: var(--text-primary); }
.snapshot-time, .snapshot-actor { font-size: 0.78rem; color: var(--text-muted); }
.no-data { font-size: 0.85rem; color: var(--text-muted); padding: 20px 0; text-align: center; }
</style>
```

- [ ] **Step 7: Render the card on the expense detail page**

Modify `packages/web/src/pages/ExpenseDetail.vue`:

Add the import next to the other component imports:

```ts
import ReportSnapshots from '../components/ReportSnapshots.vue'
```

Add the card inside `<div class="detail-side">`, after `<ApprovalTimeline ... />`:

```vue
          <ReportSnapshots v-if="report" :report-id="report.id" />
```

- [ ] **Step 8: Create the admin snapshot page**

Create `packages/web/src/pages/AdminSnapshots.vue`:

```vue
<template>
  <div class="page">
    <h2 class="font-heading page-title">内容快照</h2>

    <div class="card filters">
      <input v-model="filters.reportId" class="input" placeholder="报销单 ID" />
      <select v-model="filters.snapshotType" class="input">
        <option value="">全部类型</option>
        <option value="submit">提交</option>
        <option value="approve">审批通过</option>
        <option value="reject">驳回</option>
        <option value="pay">付款</option>
        <option value="backfill">历史回填</option>
      </select>
      <select v-model="filters.legacy" class="input">
        <option value="">全部来源</option>
        <option value="false">运行时</option>
        <option value="true">历史回填</option>
      </select>
      <input v-model="filters.from" class="input" type="date" />
      <input v-model="filters.to" class="input" type="date" />
      <button class="btn-primary btn-sm" @click="search">查询</button>
    </div>

    <div class="card">
      <div v-if="loading" class="no-data">加载中…</div>
      <div v-else-if="items.length === 0" class="no-data">暂无快照</div>
      <table v-else class="data-table">
        <thead>
          <tr><th>类型</th><th>报销单</th><th>操作人</th><th>哈希</th><th>来源</th><th>时间</th><th></th></tr>
        </thead>
        <tbody>
          <tr v-for="item in items" :key="item.id">
            <td>{{ snapshotTypeLabel(item.snapshotType) }}</td>
            <td class="mono">{{ item.reportId }}</td>
            <td>{{ snapshotActorLabel(item) }}</td>
            <td class="mono">{{ shortHash(item.contentHash) }}</td>
            <td><span v-if="item.legacy" class="badge badge-draft">历史回填</span><span v-else>运行时</span></td>
            <td>{{ formatSnapshotTime(item.createdAt) }}</td>
            <td><button class="table-link" @click="open(item.id)">查看</button></td>
          </tr>
        </tbody>
      </table>

      <div class="pager">
        <button class="btn-secondary btn-sm" :disabled="offset === 0" @click="prev">上一页</button>
        <span>共 {{ total }} 条</span>
        <button class="btn-secondary btn-sm" :disabled="offset + limit >= total" @click="next">下一页</button>
      </div>
    </div>

    <SnapshotViewer v-model="showViewer" :snapshot="selected" />
  </div>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import api from '../api/index'
import SnapshotViewer from '../components/SnapshotViewer.vue'
import {
  formatSnapshotTime,
  shortHash,
  snapshotActorLabel,
  snapshotTypeLabel,
} from '../utils/snapshot'

const items = ref<any[]>([])
const total = ref(0)
const limit = 20
const offset = ref(0)
const loading = ref(true)
const showViewer = ref(false)
const selected = ref<any>(null)

const filters = reactive({
  reportId: '',
  snapshotType: '',
  legacy: '',
  from: '',
  to: '',
})

async function load() {
  loading.value = true
  try {
    const params: Record<string, any> = { limit, offset: offset.value }
    if (filters.reportId) params.reportId = filters.reportId
    if (filters.snapshotType) params.snapshotType = filters.snapshotType
    if (filters.legacy) params.legacy = filters.legacy
    if (filters.from) params.from = `${filters.from}T00:00:00`
    if (filters.to) params.to = `${filters.to}T23:59:59.999`
    const res = await api.get('/admin/snapshots', { params })
    items.value = res.data.items || []
    total.value = res.data.total || 0
  } catch {
    items.value = []
    total.value = 0
  } finally {
    loading.value = false
  }
}

function search() {
  offset.value = 0
  load()
}

function prev() {
  offset.value = Math.max(offset.value - limit, 0)
  load()
}

function next() {
  offset.value += limit
  load()
}

async function open(id: string) {
  try {
    const res = await api.get(`/admin/snapshots/${id}`)
    selected.value = res.data
    showViewer.value = true
  } catch (e: any) {
    alert(e?.response?.data?.error?.message || '加载快照失败')
  }
}

onMounted(load)
</script>

<style scoped>
.page-title { font-size: 1.2rem; margin-bottom: 16px; }
.filters { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; margin-bottom: 16px; }
.filters .input { max-width: 180px; }
.no-data { font-size: 0.85rem; color: var(--text-muted); padding: 24px 0; text-align: center; }
.mono { font-family: monospace; font-size: 0.78rem; }
.pager { display: flex; justify-content: flex-end; align-items: center; gap: 12px; margin-top: 12px; font-size: 0.8rem; color: var(--text-muted); }
</style>
```

- [ ] **Step 9: Add the admin route and navigation**

In `packages/web/src/router/index.ts`, add before the `/admin` route:

```ts
      {
        path: 'admin/snapshots',
        name: 'AdminSnapshots',
        component: () => import('@/pages/AdminSnapshots.vue'),
        meta: { title: '内容快照', requiresAdmin: true }
      },
```

In `packages/web/src/layouts/DefaultLayout.vue`, add to the admin `items.push(...)` list (after the reasoning-rules entry):

```ts
      { path: '/admin/snapshots', label: '内容快照', icon: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 4h16v16H4z"/><path d="M8 8h8M8 12h8M8 16h5"/></svg>' },
```

- [ ] **Step 10: Run the web tests**

Run: `pnpm --filter @sse/web test`
Expected: PASS.

- [ ] **Step 11: Build the web app**

Run: `pnpm --filter @sse/web build`
Expected: PASS (vue-tsc + vite build).

- [ ] **Step 12: Commit**

```bash
git add packages/web/src/utils/snapshot.ts packages/web/src/utils/__tests__/snapshot.test.ts packages/web/src/components/SnapshotViewer.vue packages/web/src/components/ReportSnapshots.vue packages/web/src/pages/AdminSnapshots.vue packages/web/src/pages/ExpenseDetail.vue packages/web/src/router/index.ts packages/web/src/layouts/DefaultLayout.vue
git commit -m "feat(web): show report snapshots in detail and admin views"
```

---

## Task 8: Process doc and full verification

**Files:**
- Create: `docs/2026-11-21-sse-process.md`

- [ ] **Step 1: Write the process record**

Create `docs/2026-11-21-sse-process.md`:

```md
# SSE 开发过程记录（2026-11-21）

> 本次会话处理 `docs/2026-11-12-sse-multi-role-analysis.md` P1 第 5 项：
> 报销单内容不可变快照。
> 设计文档：`docs/superpowers/specs/2026-11-21-report-snapshot-design.md`
> 实现计划：`docs/superpowers/plans/2026-11-21-report-snapshot.md`

## 一、落地内容

- 迁移 `023_report_snapshots.sql`：新建 append-only `report_snapshots` 表，无外键，
  SHA-256 内容哈希，`BEFORE UPDATE OR DELETE` 触发器；为所有非草稿单据回填
  `snapshot_type='backfill'`、`legacy=true` 的快照。
- `@sse/shared`：新增快照类型。
- `@sse/core`：新增 `buildReportSnapshotPayload` 纯函数；审批写入接口增加可选事务客户端。
- `@sse/db`：新增 `PgReportSnapshotRepo`；`updateStatus`/`create`/`updateResult` 支持事务客户端。
- `@sse/api`：提交、通过、驳回、付款在事务内捕获快照；新增报销单快照读取接口与管理端快照接口。
- `@sse/web`：报销详情页“内容快照”卡片、快照查看弹窗、管理端“内容快照”页面。

## 二、触发点

| 快照类型 | 触发点 | 事务 |
|---|---|---|
| `submit` | 提交报销单 | 与首步审批记录、状态更新同一事务 |
| `approve` | 每步通过 | 与审批记录、状态推进同一事务 |
| `reject` | 每步驳回 | 与审批记录、状态驳回同一事务 |
| `pay` | 标记打款 | 与 markPaid、付款审计同一事务 |
| `backfill` | 迁移一次性回填 | 迁移事务 |

## 三、验证

```bash
pnpm -r test
pnpm -r build
```

（在此记录实际测试数量与结果。）

## 四、迁移与复测

```bash
pnpm --filter @sse/db migrate
docker compose exec -T postgres psql -U sse -d sse \
  -c "SELECT snapshot_type, legacy, COUNT(*) FROM report_snapshots GROUP BY 1,2 ORDER BY 1;"
docker compose exec -T postgres psql -U sse -d sse \
  -c "UPDATE report_snapshots SET legacy = true WHERE false;"   # 预期被触发器拒绝
```

验证要点：

1. 提交后出现 `submit` 快照；
2. 每步通过/驳回后出现对应快照；
3. 付款后出现 `pay` 快照，含付款与回单；
4. 非草稿历史单据有 `backfill` 且 `legacy=true`；
5. 直接 `UPDATE/DELETE report_snapshots` 被拒绝；
6. 详情页与管理端可查看快照，哈希校验显示通过。
```

- [ ] **Step 2: Run the full test suite**

Run: `pnpm -r test`
Expected: all packages pass. Record the counts in the process doc.

- [ ] **Step 3: Run the full build**

Run: `pnpm -r build`
Expected: all packages build.

- [ ] **Step 4: Optional real database verification**

If Docker is available:

```bash
docker compose up -d postgres
pnpm --filter @sse/db migrate
docker compose exec -T postgres psql -U sse -d sse -c "SELECT snapshot_type, legacy, COUNT(*) FROM report_snapshots GROUP BY 1,2 ORDER BY 1;"
```

Expected: at least one `backfill` row if any non-draft report exists; the migration applies without error.

- [ ] **Step 5: Update the process doc with the actual results**

Replace the placeholder verification block in `docs/2026-11-21-sse-process.md` with the actual test/build output counts.

- [ ] **Step 6: Commit**

```bash
git add docs/2026-11-21-sse-process.md
git commit -m "docs: record report snapshot implementation (P1-5)"
```

---

## Self-Review Notes

- **Spec coverage:** data model (Task 3), payload builder (Task 2), capture/atomicity (Tasks 5–6), API/permissions (Task 6), web display (Task 7), backfill (Task 3), tests (all tasks), process doc (Task 8).
- **Type consistency:** `SnapshotCaptureInput.snapshotType` is `'submit' | 'approve' | 'reject' | 'pay'`; `ReportSnapshot.snapshotType` includes `'backfill'`. `buildReportSnapshotPayload` uses `Exclude<SnapshotType, 'backfill'>`. `updateStatus(id, status, currentStep?, db?)` is used consistently in Tasks 5–6.
- **No placeholders:** the only placeholder block is the verification output in Task 8 Step 5, which explicitly instructs replacing it with the actual command output.
