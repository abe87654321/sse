# Expense List Category / Applicant + Real Pagination — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:test-driven-development where test infrastructure exists, and superpowers:verification-before-completion before claiming completion. Tasks use checkbox syntax.

> **Status:** Implemented and merged to `master` (PR #2, `6f7de13`; see `docs/2026-11-02-sse-process.md`, 阶段十八). Checkboxes below are retained as the original task breakdown.

**Goal:** Return applicant names and aggregated category names to the expense list/detail, and replace the fake client-side pagination with server-side paging/filtering.

**Architecture:** Extend the existing read queries (`PgExpenseRepo` + the department-approver inline query) with a `users` join and a correlated category aggregation. Keep the existing role-based data scoping untouched. Rewire `ExpenseList.vue` to send `status`, `keyword`, `page`, `pageSize` and render the API's `total`.

**Tech Stack:** TypeScript, PostgreSQL, Express, Vue 3, Jest (core only), Vite.

---

### Task 1: Shared type

**Files:**
- Modify: `packages/shared/src/types/expense-report.ts`

- [ ] Add `applicantName?: string`.
- [ ] Add `categoryNames?: string[]`.
- [ ] Build `@sse/shared`.

### Task 2: Repository queries

**Files:**
- Modify: `packages/db/src/repositories/pg-expense-repo.ts`

- [ ] `mapReport()` maps `applicant_name` and `category_names`.
- [ ] `findById()` joins `users` for `applicant_name`.
- [ ] `findMany()` joins `users`, aggregates categories, qualifies predicates with `er.`, and makes keyword match `serial_no OR title`.
- [ ] Align `findManyByApprover()` and `findManyByUser()` with the same select/join/keyword behavior.
- [ ] Build `@sse/db`.

### Task 3: API route

**Files:**
- Modify: `packages/api/src/routes/expenses.ts`

- [ ] Department-approver branch: join `users`, aggregate categories, keyword matches `serial_no OR title`.
- [ ] `mapReportRow()` maps `applicantName` and `categoryNames`.
- [ ] Verify `GET /:id` now exposes `applicantName` through `findById`.
- [ ] Build `@sse/api`.

### Task 4: Expense list UI

**Files:**
- Modify: `packages/web/src/pages/ExpenseList.vue`

- [ ] Replace client-side `filteredExpenses` with server-driven refetch.
- [ ] Add 报销人 column.
- [ ] Render category tags (`categoryNames`, first 3 + `+N`, full list in tooltip).
- [ ] Implement real pagination from `total` / `pageSize`.
- [ ] Reset to page 1 on filter change; debounce keyword.
- [ ] Update empty-state `colspan`.

### Task 5: Expense detail UI

**Files:**
- Modify: `packages/web/src/pages/ExpenseDetail.vue`

- [ ] Add `applicantName` to the `Report` interface.
- [ ] Show 报销人 in 基本信息.

### Task 6: Verification

- [ ] `pnpm --filter @sse/shared build`
- [ ] `pnpm --filter @sse/db build`
- [ ] `pnpm --filter @sse/api build`
- [ ] `pnpm --filter @sse/web build`
- [ ] `pnpm --filter @sse/core test`
- [ ] Review diff; confirm no unrelated files.

### Task 7: Delivery

- [ ] Create feature branch.
- [ ] Commit only the design/plan, shared, db, api, and web changes.
- [ ] Push and open PR with a summary and test notes.
