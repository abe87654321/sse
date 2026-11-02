# AI Invoice Verification — Design

> Date: 2026-11-02
> Status: Approved for implementation
> Branch: `fix/ai-engine-test-timeout-mineru-token`

## Goal

After an invoice attachment is uploaded, run the OCR engine configured in System Management and compare extracted invoice fields (invoice number, total amount, date) with the expense form. Show mismatches. Duplicate invoice numbers are detected across expense reports.

## Confirmed Decisions

| Topic | Decision |
|---|---|
| Amount mismatch | Warn, require approver acknowledgement before approval |
| Scope | Per item + report total |
| Trigger | Manual "AI 核对" button (no automatic OCR after upload) |
| Tolerance | ±0.01 |
| Engine unavailable/failure | Mark `unverified`, allow continue; approval requires acknowledgement |
| Duplicate invoice detection | Included in this phase |
| Duplicate handling | Warn, require approver acknowledgement |

## Architecture

Synchronous verification endpoint + persisted results.

```
POST /expenses/:id/verify
  -> load report/items/invoices
  -> reuse invoices.ocr_result when present, otherwise run configured OCR engine
  -> persist ocr_result, invoice_no
  -> core verifyInvoices(): amount per item, report total, invoice no, date, duplicates
  -> persist verification_status/result/verified_at
  -> return summary
```

Approval gating is enforced server-side: `POST /approvals/:reportId/approve` recomputes the aggregate status and rejects with `409 VERIFICATION_ACK_REQUIRED` unless `acknowledgeVerification: true` and the status is warning/unverified/error.

## Status Model

- `pass`: all checks pass
- `warning`: amount mismatch, duplicate invoice, missing invoice number, date warning
- `unverified`: OCR disabled, failed, or timed out
- `no_invoices`: no attachments (neutral)
- `error`: internal verification error

Aggregate precedence: `no_invoices` when empty; otherwise `warning` if any warning, else `unverified`/`error` if any, else `pass`.

## Data Model

Migration `010_invoice_verification.sql`:

```sql
ALTER TABLE invoices
  ADD COLUMN invoice_no TEXT,
  ADD COLUMN verification_status TEXT NOT NULL DEFAULT 'pending',
  ADD COLUMN verification_result JSONB,
  ADD COLUMN verified_at TIMESTAMPTZ;

CREATE INDEX idx_invoices_invoice_no
  ON invoices(invoice_no)
  WHERE invoice_no IS NOT NULL;

ALTER TABLE approval_records
  ADD COLUMN verification_acknowledged BOOLEAN NOT NULL DEFAULT false;
```

All additions are nullable or have defaults. No historical migration edits.

## Verification Rules

| Check | Rule | Result |
|---|---|---|
| Item amount | invoice totalAmount (fallback amount) vs item amount, tolerance 0.01 | warning |
| Report total | sum of invoice amounts vs report.totalAmount, tolerance 0.01 | warning |
| Invoice number | present | warning if missing |
| Duplicate | invoice_no used by another invoice | warning |
| Date | invoice date differs from item date by > 7 days | warning |
| No invoices | none attached | no_invoices |

Multiple invoices attached to one item are summed before comparing with the item amount.

## Verification Invalidation

Reset affected invoices to `pending` and clear verification fields when:
- expense items are updated via `PUT /expenses/:id`
- a new invoice is uploaded
- an invoice is deleted (future)

OCR results remain cached; re-verification reuses them unless `force=true`.

## API

### `POST /expenses/:id/verify`

- Body: `{ force?: boolean }`
- Authorization: same access rules as `GET /expenses/:id`
- Reuses `ocr_result` unless `force=true`
- Mismatch is a successful business result: HTTP 200
- OCR failure is represented as `unverified` in the body, not a 5xx

Response:

```json
{
  "status": "warning",
  "checkedAt": "2026-11-02T12:00:00.000Z",
  "summary": "1 张发票金额与明细不一致",
  "counts": { "total": 2, "pass": 1, "warning": 1, "unverified": 0, "pending": 0 },
  "checks": [],
  "invoices": [
    {
      "invoiceId": "...",
      "itemId": "...",
      "fileName": "invoice.pdf",
      "status": "warning",
      "invoiceNo": "12345678",
      "totalAmount": 600,
      "checks": [],
      "duplicates": []
    }
  ]
}
```

### `GET /expenses/:id`

- `invoices[]` gains `invoiceNo`, `verificationStatus`, `verificationResult`, `verifiedAt`
- adds `verificationSummary`

### `POST /approvals/:reportId/approve`

- Body gains `acknowledgeVerification?: boolean`
- Server recomputes aggregate from `invoices.verification_status`
- `warning` / `unverified` / `error` without acknowledgement -> `409 VERIFICATION_ACK_REQUIRED`
- Acknowledged approval persists `approval_records.verification_acknowledged = true`

## Frontend

- Shared `InvoiceVerificationPanel.vue`
- `ExpenseForm.vue`: manual "AI 核对" button; status panel; disabled until draft has an id and at least one uploaded invoice; clears stale result after save
- `ApprovalHandle.vue`: verification card; manual re-run; approval acknowledgement modal for warning/unverified/error; sends `acknowledgeVerification`
- No blocking of draft save or submit

## Security

- Verify endpoint reuses report access rules
- Duplicate lookup returns full report serial/status only to admin/finance/approver; employees receive a restricted duplicate marker
- OCR/AI credentials stay server-side; existing token masking is preserved

## Testing

- Core: verifier unit tests (pass, tolerance, mismatch, total, missing number, duplicates, date, unverified, no invoices, multiple invoices per item)
- AI: existing provider tests remain green
- API build/typecheck
- Web build
- Manual E2E on the test machine

## Non-Goals

- Automatic OCR after upload
- AI fallback when OCR fails
- Historical verification versioning
- Tax-authority invoice authenticity checks
