# AI Invoice Verification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:test-driven-development and superpowers:verification-before-completion. Tasks use checkbox syntax.

**Goal:** Add manual AI invoice verification with amount/duplicate checks and an approval acknowledgement gate.

**Architecture:** Synchronous `POST /expenses/:id/verify` reuses cached OCR, persists verification results, and exposes them via `GET /expenses/:id`. Approval re-checks persisted statuses server-side.

**Tech Stack:** TypeScript, Express, PostgreSQL, Vue 3, Jest, MinerU/Paddle/Vision OCR.

---

### Task 1: Core verifier

**Files:**
- Create: `packages/shared/src/types/invoice-verification.ts`
- Modify: `packages/shared/src/types/index.ts`
- Create: `packages/core/src/services/invoice-verifier.ts`
- Create: `packages/core/src/services/__tests__/invoice-verifier.test.ts`
- Modify: `packages/core/src/services/index.ts`

- [x] Write failing tests for: pass, tolerance, mismatch, report total, missing invoice number, duplicates, date warning, unverified, no invoices, multiple invoices per item.
- [x] Run `pnpm --filter @sse/core test -- invoice-verifier` and confirm failure.
- [x] Implement `verifyInvoices()` and `aggregateVerificationStatus()`.
- [x] Run tests until green.

### Task 2: Migration and repositories

**Files:**
- Create: `packages/db/src/migrations/010_invoice_verification.sql`
- Modify: `packages/shared/src/types/invoice.ts`
- Modify: `packages/db/src/repositories/pg-invoice-repo.ts`

- [x] Add columns and index.
- [x] Extend `Invoice` type and repository mapping.
- [x] Add `updateOcr`, `updateVerification`, `findDuplicatesByInvoiceNo`.
- [x] Build `@sse/db`.

### Task 3: Shared AI engine factory

**Files:**
- Create: `packages/api/src/services/ai-engines.ts`
- Modify: `packages/api/src/routes/ai.ts`
- Modify: `packages/api/src/routes/admin.ts`

- [x] Move `loadAiConfig`, `createOCREngine`, `getSmartFillEngine` into a shared service.
- [x] Keep admin `saveAiConfig`/`publicAiConfig`.
- [x] Build `@sse/api`.

### Task 4: Verify endpoint

**Files:**
- Modify: `packages/api/src/routes/expenses.ts`

- [x] Add report access helper.
- [x] Add `POST /:id/verify`.
- [x] Reuse cached OCR unless `force=true`.
- [x] Persist OCR and verification.
- [x] Reset invoice verification in `PUT /:id` when items change.
- [x] Add verification fields and summary to `GET /:id`.

### Task 5: Approval gate

**Files:**
- Modify: `packages/api/src/routes/approvals.ts`

- [x] Aggregate persisted statuses before approving.
- [x] Return `409 VERIFICATION_ACK_REQUIRED` unless acknowledged.
- [x] Persist `verification_acknowledged`.

### Task 6: Frontend

**Files:**
- Create: `packages/web/src/components/InvoiceVerificationPanel.vue`
- Modify: `packages/web/src/pages/ExpenseForm.vue`
- Modify: `packages/web/src/pages/ApprovalHandle.vue`

- [x] Build read-only panel with run button.
- [x] Wire manual verification in edit/create flow.
- [x] Wire approval card and acknowledgement modal.
- [x] Send `acknowledgeVerification`.

### Task 7: Verification

- [x] `pnpm --filter @sse/core test`
- [x] `pnpm --filter @sse/ai test`
- [x] `pnpm --filter @sse/db build`
- [x] `pnpm --filter @sse/api build`
- [x] `pnpm --filter @sse/web build`
- [x] Review diff, run security/code review, commit and push.
