# SSE Payment Interface — Design Document

> Date: 2026-07-29 | Version: v1.0 | Status: Pending Review

---

## 1. Overview

After approval, expense reports enter the "Approved" status. The final step is for the finance role to confirm payment. Currently, the `paid` status exists only as an enum value without an API or supporting data. This design proceeds in two phases: manual payment marking first, with reserved callbacks for automated financial system integration.

---

## 2. Data Model

### 2.1 New columns on `expense_reports`

| Field | Type | Description |
|-------|------|-------------|
| `paid_at` | TIMESTAMPTZ | Timestamp when payment was completed |
| `paid_by` | UUID | Operator who marked payment, FK → users(id) |
| `payment_ref` | VARCHAR(100) | Transaction reference / bank voucher number, nullable |

### 2.2 Migration

```sql
ALTER TABLE expense_reports
  ADD COLUMN paid_at TIMESTAMPTZ,
  ADD COLUMN paid_by UUID REFERENCES users(id),
  ADD COLUMN payment_ref VARCHAR(100);
```

---

## 3. API Design

### 3.1 Manual Payment

`POST /expenses/:id/pay`

**Authorization**: `finance` or `admin` role. Only `approved` status is allowed.

**Request**:
```json
{
  "paymentRef": "BANK-20260729-001",
  "comment": "Transferred to ICBC account ending 1872"
}
```

**Response**:
```json
{
  "message": "Payment marked",
  "paidAt": "2026-07-29T10:00:00Z",
  "paymentRef": "BANK-20260729-001"
}
```

### 3.2 Financial System Callback (Phase 2 — Reserved)

`POST /api/v1/webhooks/payment-callback`

**Auth**: HMAC-SHA256 signature (consistent with §9 Data Platform Integration).

**Request**:
```json
{
  "reportId": "uuid",
  "paidAt": "2026-07-29T10:00:00Z",
  "paymentRef": "ERP-PAY-001",
  "status": "success"
}
```

**Response**:
```json
{ "message": "ok" }
```

**Error codes**: Invalid signature → 401; `reportId` not found → 404; status not `approved` → 409.

### 3.3 State Machine Update

```
Draft → Pending → Approved → Paid
                              ↑
                     POST /expenses/:id/pay
```

---

## 4. viewerActions Update

`GET /expenses/:id` response adds `canPay`:

```typescript
{ canPay: (isAdmin || isFinance) && report.status === 'approved' }
```

Paid reports hide all action buttons (including admin delete).

---

## 5. Ontology Layer Extension

`packages/ontology/src/semantic-mapper.ts` adds:

| Element | Definition |
|---------|-----------|
| Class | `sse:PaidReport` subclass of `sse:ApprovedReport` |
| Data Properties | `sse:paidAt` (xsd:dateTime), `sse:paidBy` (xsd:string), `sse:paymentRef` (xsd:string) |

`query_ontology` type filter adds `PaidReport` support.

---

## 6. Frontend

| Page | Change |
|------|--------|
| `ExpenseDetail.vue` | Basic info card shows payer name and payment timestamp |
| `ExpenseList.vue` | Paid status displays `paid` badge |
| `ApprovalHandle.vue` | Approved reports show "Confirm Payment" button |

---

## 7. File Change List

| File | Type | Description |
|------|------|-------------|
| `packages/db/src/migrations/006_payment.sql` | New | Add paid_at, paid_by, payment_ref |
| `packages/shared/src/types/expense-report.ts` | Modify | Add three fields |
| `packages/core/src/ports/iexpense-repo.ts` | Modify | Add markPaid method |
| `packages/db/src/repositories/pg-expense-repo.ts` | Modify | Implement markPaid + map new fields |
| `packages/api/src/routes/expenses.ts` | Modify | Add POST /:id/pay; viewerActions add canPay |
| `packages/ontology/src/semantic-mapper.ts` | Modify | Sync PaidReport class |
| `packages/web/src/pages/ExpenseDetail.vue` | Modify | Payment info display |
| `packages/web/src/pages/ApprovalHandle.vue` | Modify | Confirm payment button |

---

> Pending review before implementation.
