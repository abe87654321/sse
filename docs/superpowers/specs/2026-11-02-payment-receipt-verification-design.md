# Payment Confirmation / Receipt Verification — Design

> Date: 2026-11-02
> Status: Approved for implementation (P0 + P1 + P2)
> Scope: payment confirmation bug fix, payment correction + audit, payment receipt upload + async OCR suspicion check

## Goal

1. Prevent cancelling/leaving the payment prompt from marking a report as paid.
2. Require a payment reference and/or a payment receipt (at least one).
3. Allow finance/admin to correct or revert a payment, with an audit trail.
4. Store payment receipts in MinIO and verify them asynchronously with the configured OCR engine; surface suspicious receipts to finance/admin.
5. Block deletion of paid reports.

## Confirmed Decisions

| Topic | Decision |
|---|---|
| Payment reference | Required unless a receipt is uploaded (at least one of reference / receipt) |
| Receipt | Optional, but if uploaded must be OCR-verified |
| OCR timing | Asynchronous; manual re-run available to finance/admin |
| Correction | Allowed for finance/admin, with audit log and reason |
| Undo | Allowed for finance/admin, with audit log and reason |
| Paid deletion | Forbidden for everyone, including admin |
| Reference format | No single industry standard; free-form, trimmed, 1–100 chars |
| Scope | P0 + P1 + P2 together |

## Root Cause (P0)

`ExpenseDetail.vue:255-263` and `ApprovalHandle.vue:270-278` use `window.prompt()`
and then always POST:

```ts
const ref = prompt('打款凭证号（可选）：')
await api.post(`/expenses/${id}/pay`, { paymentRef: ref || undefined })
```

`prompt()` returns `null` on cancel/Esc/tab-dismiss and `''` on empty confirm.
Both are collapsed to `undefined`, so cancellation and empty input still mark the
report as paid. The backend (`POST /expenses/:id/pay`) also has no validation and
`payment_ref` is nullable.

## Data Model

Migration `011_payment_receipts_audit.sql`:

```sql
CREATE TABLE payment_receipts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  report_id UUID NOT NULL UNIQUE REFERENCES expense_reports(id) ON DELETE CASCADE,
  file_name TEXT NOT NULL,
  file_format TEXT NOT NULL,
  file_size INT NOT NULL,
  storage_key TEXT NOT NULL,
  storage_bucket TEXT NOT NULL,
  checksum TEXT NOT NULL,
  uploaded_by UUID REFERENCES users(id),
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ocr_result JSONB,
  verification_status TEXT NOT NULL DEFAULT 'pending',
  verification_result JSONB,
  verified_at TIMESTAMPTZ
);

CREATE INDEX idx_payment_receipts_checksum ON payment_receipts(checksum);
CREATE INDEX idx_payment_receipts_status ON payment_receipts(verification_status);

CREATE TABLE payment_audit_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  report_id UUID NOT NULL REFERENCES expense_reports(id) ON DELETE CASCADE,
  action TEXT NOT NULL,
  operator_id UUID REFERENCES users(id),
  reason TEXT,
  before JSONB,
  after JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_payment_audit_logs_report_id ON payment_audit_logs(report_id);

ALTER TABLE expense_reports
  ADD COLUMN payment_comment TEXT,
  ADD COLUMN payment_updated_at TIMESTAMPTZ,
  ADD COLUMN payment_updated_by UUID REFERENCES users(id);
```

- One receipt per report (`report_id UNIQUE`); replacing it keeps the old file in
  MinIO and records the change in the audit log.
- `payment_ref` stays nullable at the DB level for historical rows; validation is
  enforced by the API.
- No historical migration edits.

## Payment Rules

1. A report can be paid only when `status = 'approved'`.
2. At least one of:
   - non-empty `paymentRef` (trimmed, ≤ 100 chars), or
   - an uploaded receipt linked to the report.
3. Paid reports cannot be deleted.
4. Correction (`PUT /expenses/:id/payment`) requires a reason and at least one of
   reference/receipt after the change.
5. Revert (`POST /expenses/:id/payment/revert`) requires a reason and returns the
   report to `approved`; payment fields are cleared, receipt is retained for audit.
6. All payment mutations are recorded in `payment_audit_logs`.

## Receipt Verification

Status model:

- `pending`: queued, not processed yet
- `pass`: OCR succeeded and all checks passed
- `warning`: amount/date mismatch, duplicate checksum, missing amount, or negative keyword
- `unverified`: OCR disabled or failed
- `error`: internal verification error

Checks (core, pure function):

| Check | Rule | Severity |
|---|---|---|
| OCR available | engine enabled and returned a result | unverified if not |
| Amount | OCR `totalAmount ?? amount` vs `report.totalAmount`, tolerance 0.01 | warning |
| Date | OCR date vs `paidAt` (±7 days) | warning |
| Duplicate | same file checksum used by another report | warning |
| Negative text | raw text contains 失败/退回/冲正/撤销/处理中 | warning |

`verification_result` stores `{ status, checks, summary, checkedAt, ocr, duplicateReceipts }`.

Pipeline:

```
POST /expenses/:id/payment-receipts (multipart)
  -> MinIO upload
  -> upsert payment_receipts (status=pending)
  -> queue async verification
  -> 201 receipt

Async worker:
  -> load receipt + report
  -> createOCREngine()
  -> MinIO getObject + parseInvoice()
  -> core verifyPaymentReceipt()
  -> persist ocr_result / status / result / verified_at

Scheduler: every 5 minutes retries pending receipts (server restart safety).
```

## API

### `POST /expenses/:id/payment-receipts`

- finance/admin only; report must be `approved` or `paid`
- multipart `file`: PDF/PNG/JPG/JPEG, max 10 MB
- uploads to MinIO bucket `payment-receipts`
- upserts one receipt per report, resets verification to `pending`
- returns receipt metadata

### `GET /expenses/:id/payment-receipts/:receiptId/download`

- report access rules; returns MinIO signed URL

### `POST /expenses/:id/payment-receipts/:receiptId/verify`

- finance/admin only
- body `{ force?: boolean }`
- runs OCR synchronously and returns the verification result

### `POST /expenses/:id/pay`

- finance/admin only, `status = 'approved'`
- body `{ paymentRef?, paymentComment?, receiptId? }`
- validates at least one of reference/receipt
- atomic `UPDATE ... WHERE status='approved'`
- writes `payment_audit_logs` action `mark_paid`

### `PUT /expenses/:id/payment`

- finance/admin only, `status = 'paid'`
- body `{ paymentRef?, paymentComment?, reason }`
- validates at least one of reference/receipt after the change
- updates `payment_updated_at/by`
- writes audit action `update_payment`

### `POST /expenses/:id/payment/revert`

- finance/admin only, `status = 'paid'`
- body `{ reason }`
- returns report to `approved`, clears payment fields, keeps receipt
- writes audit action `revert_payment`

### `GET /expenses/:id`

Adds:
- report: `paymentComment`, `paymentUpdatedAt`, `paymentUpdatedBy`
- `paymentReceipts: []` (one item; detailed verification only for finance/admin)
- `paymentAuditLogs: []` (finance/admin only)
- `viewerActions.canDelete` excludes `paid`
- `viewerActions.canManagePayment` for finance/admin on paid reports

### `DELETE /expenses/:id`

- rejects `paid` reports for everyone (including admin)

## Frontend

- Shared `PaymentDialog.vue`:
  - reference, comment, receipt file
  - validates at least one of reference/receipt
  - cancel never submits
  - supports `pay` and `edit` modes
- Shared `PaymentReceiptPanel.vue`:
  - payment time, reference, comment
  - receipt download
  - OCR status + suspicion (finance/admin)
  - re-run verification, edit, revert (finance/admin)
  - audit log list (finance/admin)
- `ExpenseDetail.vue`: wire dialog + panel; refactor load into a reusable function.
- `ApprovalHandle.vue`: replace `prompt()` with the same dialog; keep existing payment info display.

## Security

- Payment mutation: finance/admin only.
- Receipt upload/download: report access; detailed OCR checks and audit logs only
  finance/admin.
- MinIO access only via signed URLs; server-side credentials.
- File type/size validated server-side.
- No secrets or raw storage keys returned to the frontend.
- Audit logs immutable from the API (insert-only).

## Existing Bad Data

The already-paid report with `payment_ref IS NULL` can be corrected through
`PUT /expenses/:id/payment` once deployed (finance/admin, reason required).

## Testing

- Core: unit tests for pass, amount mismatch, missing amount, date mismatch,
  duplicate checksum, OCR unavailable, negative keyword.
- Builds: shared, db, core, api, web, mcp.
- Smoke: upload receipt, pay with reference, async verification, manual re-run,
  correction, revert, paid-delete rejection.

## Non-Goals

- Automatic bank/ERP integration.
- Fraud detection beyond OCR/amount/date/duplicate/keyword heuristics.
- Multiple simultaneous receipts per report.
- Changing invoice verification behavior.
