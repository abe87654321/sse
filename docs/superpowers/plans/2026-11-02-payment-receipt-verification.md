# Payment Confirmation / Receipt Verification — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:test-driven-development for the core verifier and superpowers:verification-before-completion before claiming completion. Tasks use checkbox syntax.

**Goal:** Fix the empty-payment bug, enforce reference-or-receipt, add correction + audit, and add async OCR suspicion checks for payment receipts.

**Architecture:** New `payment_receipts` and `payment_audit_logs` tables, a pure core verifier, an in-process async worker plus 5-minute retry sweep, and shared Vue dialog/panel components.

---

### Task 1: Shared types

**Files:**
- Create: `packages/shared/src/types/payment.ts`
- Modify: `packages/shared/src/types/expense-report.ts`
- Modify: `packages/shared/src/types/index.ts`

- [ ] Add `PaymentReceipt`, `PaymentReceiptVerification`, `PaymentAuditLog`.
- [ ] Add `paymentComment`, `paymentUpdatedAt`, `paymentUpdatedBy` to `ExpenseReport`.
- [ ] Export new types.
- [ ] Build `@sse/shared`.

### Task 2: Migration + repositories

**Files:**
- Create: `packages/db/src/migrations/011_payment_receipts_audit.sql`
- Create: `packages/db/src/repositories/pg-payment-receipt-repo.ts`
- Create: `packages/db/src/repositories/pg-payment-audit-repo.ts`
- Modify: `packages/db/src/repositories/pg-expense-repo.ts`
- Modify: `packages/db/src/repositories/index.ts`
- Modify: `packages/core/src/ports/iexpense-repo.ts`

- [ ] Create tables/indexes and report payment columns.
- [ ] Implement receipt upsert/find/findByChecksum/findPending/updateVerification.
- [ ] Implement audit insert/find.
- [ ] Extend report mapping with payment comment fields.
- [ ] Add atomic `markPaidIfApproved`, `updatePayment`, `revertPayment`.
- [ ] Build `@sse/db`.

### Task 3: Core verifier + tests

**Files:**
- Create: `packages/core/src/services/payment-receipt-verifier.ts`
- Create: `packages/core/src/services/__tests__/payment-receipt-verifier.test.ts`
- Modify: `packages/core/src/services/index.ts`

- [ ] Write failing tests for pass/mismatch/missing amount/date/duplicate/OCR unavailable/negative keyword.
- [ ] Implement `verifyPaymentReceipt()` and `aggregatePaymentReceiptStatus()`.
- [ ] Run `pnpm --filter @sse/core test`.
- [ ] Build `@sse/core`.

### Task 4: API routes + async worker

**Files:**
- Create: `packages/api/src/services/payment-receipt-verifier.ts`
- Modify: `packages/api/src/middleware/upload.ts`
- Modify: `packages/api/src/routes/expenses.ts`
- Modify: `packages/api/src/index.ts`

- [ ] Add receipt upload middleware.
- [ ] Add upload/download/manual-verify endpoints.
- [ ] Validate and atomically pay; write audit.
- [ ] Add correction and revert endpoints with audit.
- [ ] Add receipt/audit data to `GET /:id`.
- [ ] Block deletion of paid reports; hide `canDelete`.
- [ ] Queue async verification on upload; retry pending every 5 minutes.
- [ ] Build `@sse/api`.

### Task 5: Frontend dialog + receipt panel

**Files:**
- Create: `packages/web/src/components/PaymentDialog.vue`
- Create: `packages/web/src/components/PaymentReceiptPanel.vue`
- Modify: `packages/web/src/pages/ExpenseDetail.vue`
- Modify: `packages/web/src/pages/ApprovalHandle.vue`

- [ ] Build modal with reference/comment/receipt and at-least-one validation.
- [ ] Replace both `prompt()` payment flows.
- [ ] Show payment info, receipt status/checks, audit logs, correction/revert actions.
- [ ] Refactor detail loading into a reusable function.
- [ ] Build `@sse/web`.

### Task 6: Verification

- [ ] `pnpm --filter @sse/shared build`
- [ ] `pnpm --filter @sse/db build`
- [ ] `pnpm --filter @sse/core test`
- [ ] `pnpm --filter @sse/api build`
- [ ] `pnpm --filter @sse/web build`
- [ ] `pnpm --filter @sse/mcp build`
- [ ] Smoke: pay validation, cancel no-op, receipt upload + async OCR, correction, revert, paid delete rejection.
- [ ] Review diff.

### Task 7: Delivery

- [ ] Commit on `master` and push (per user instruction for this repo).
- [ ] Report verification evidence and any residual limitations.
