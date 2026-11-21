# TDD Evidence Report: Statistics Consistency (P1-8)

## 1. Source

- Analysis: `docs/2026-11-12-sse-multi-role-analysis.md` P1-8
- Process record: `docs/2026-11-21-sse-process.md`
- Preceding fix: `c29d6db fix(statistics): scope aggregates by viewer role`

## 2. User journeys

1. As an employee, my statistics page counts only my own approved/paid reports.
2. As a department approver, category/department/monthly panels use my department and the same date range as the overview cards.
3. As finance/admin, I can filter by department and see overview, category, department, monthly and MCP results agree.
4. As an auditor, I can trust that totals only include money that was approved or paid, and that every panel uses the same date boundary.

## 3. Task report

### Task 1: Shared statistics predicate in core

- Summary: added `resolveStatisticsFilter`, `buildStatisticsPredicate`, `statisticsScopeLabel` and `SPENDING_STATUSES` so API and MCP share one filter/status contract.
- RED: `pnpm --filter @sse/core test -- statistics.test.ts`
  - Output: `TS2307: Cannot find module '../statistics'`.
- GREEN: same command
  - Output: `Test Suites: 1 passed`, `Tests: 7 passed`.
- Guarantee: employee/department/all scopes resolve correctly; `dateTo` uses an exclusive next-day bound; spending statuses are `approved + paid`; the users join is required only for department filters.

### Task 2: Overview semantics

- Summary: `PgExpenseRepo.getStatistics` now uses the shared predicate, `LEFT JOIN users`, and `FILTER` counts for spending/rejected/pending/draft.
- RED: `pnpm --filter @sse/db test -- pg-expense-repo-statistics.test.ts`
  - Output: `Expected substring: "LEFT JOIN users u ON u.id = er.user_id"`, received `JOIN users ...`; no `FILTER (... approved, paid)` clauses.
- GREEN: same command
  - Output: `Test Suites: 1 passed`, `Tests: 3 passed`.
- Guarantee: total amount/count cover approved + paid only; rejected, pending and draft are counted separately; department join is a `LEFT JOIN` so users without a department are still counted.

### Task 3: API aggregates

- Summary: `/statistics` applies the shared spending predicate to category, department and monthly queries; category shows `未分类`, department shows `未分配`; response adds `draftCount`.
- RED: `pnpm --filter @sse/api test -- statistics.test.ts`
  - Output: 5 failing tests: no exclusive `dateTo` bound, no `er.status = ANY(...)`, category params still only contained user/date/department.
- GREEN: same command
  - Output: `Test Suites: 1 passed`, `Tests: 8 passed`.
- Guarantee: all three aggregates share the same scope/date/status predicate and parameters; export keeps listing all statuses but respects scope/date/department.

### Task 4: MCP parity

- Summary: `get_statistics` now reuses the core predicate, applies the spending basis, uses `LEFT JOIN` for categories/departments, and returns scope, status counts, by_category, by_department and by_month.
- RED: `pnpm --filter @sse/mcp test -- get-statistics.test.ts`
  - Output: expected exclusive `dateTo` and `er.status = ANY(...)`; received legacy `<=` and inner joins.
- GREEN: same command
  - Output: `Test Suites: 1 passed`, `Tests: 3 passed`.
- Guarantee: employee scope ignores an explicit department filter; finance can filter by department; roles without a data scope get `FORBIDDEN`; MCP and REST now expose the same totals/monthly shape.

### Task 5: Web basis label

- Summary: the statistics page shows `统计口径：已通过 + 已付款` next to the scope badge.
- RED: `pnpm --filter @sse/web test -- Statistics.test.ts`
  - Output: expected text was not found in the rendered page.
- GREEN: same command
  - Output: `Test Files 1 passed`, `Tests 2 passed`.
- Guarantee: users can see which report statuses the amounts include.

### Task 6: Full verification

- `pnpm -r test`: 782 tests passed across 9 packages with tests.
  - web 58, core 70, db 59, auth 30, ai 100, notifications 29, ontology 176, api 201, mcp 59.
- `pnpm -r build`: 11/11 workspace packages built.
- No real PostgreSQL was required: this change is SQL construction plus response mapping, and the static SQL is covered by repository/route tests.

## 4. Test specification

| # | What is guaranteed | Test file | Type | Result |
|---|---|---|---|---|
| 1 | Employee filter ignores a department argument | `packages/core/src/services/__tests__/statistics.test.ts` | unit | PASS |
| 2 | Department approvers are forced to their own department | same | unit | PASS |
| 3 | Finance/admin can pass a department filter | same | unit | PASS |
| 4 | `dateTo` is inclusive only through the next-day exclusive bound | same | unit | PASS |
| 5 | Spending predicate is `approved + paid` via `ANY($n)` | same | unit | PASS |
| 6 | Users join is requested only for department filters | same | unit | PASS |
| 7 | Scope labels match between API and MCP | same | unit | PASS |
| 8 | Overview totals/counts use approved + paid | `packages/db/src/__tests__/pg-expense-repo-statistics.test.ts` | unit | PASS |
| 9 | Rejected/pending/draft are counted separately | same | unit | PASS |
| 10 | Department overview uses `LEFT JOIN` and shared predicate | same | unit | PASS |
| 11 | API category/department/monthly share scope/date/status | `packages/api/src/__tests__/statistics.test.ts` | integration | PASS |
| 12 | Category shows `未分类`, department shows `未分配` | same | integration | PASS |
| 13 | Export keeps its scope/date/department filter | same | integration | PASS |
| 14 | MCP employee scope ignores department and uses spending basis | `packages/mcp/src/__tests__/get-statistics.test.ts` | integration | PASS |
| 15 | MCP finance department filter and monthly/status fields | same | integration | PASS |
| 16 | MCP denies roles without a data scope | same | integration | PASS |
| 17 | Web page shows the spending basis | `packages/web/src/pages/__tests__/Statistics.test.ts` | unit | PASS |

## 5. Coverage and known gaps

- No coverage script is configured in these packages; coverage was not collected.
- No browser E2E test was added; the page hint and scope label are covered by Vue Test Utils.
- Reconciliation (`sum(byCategory) == overview.totalAmount`, `sum(byDepartment) == overview.totalAmount`) is guaranteed by construction (same predicate/status set) and by the shape tests, but no seeded-PostgreSQL test asserts numeric equality.
- Month grouping and date comparisons both use the PostgreSQL session timezone. The tests assert the SQL shape; a deployment with a mismatched application/DB timezone should still be validated on the test machine.
- Monthly is intentionally the latest 12 months, so its sum can be smaller than the overview when older reports are in range.

## 6. Merge evidence

- Branch: `fix/p1-8-statistics-consistency`
- RED test commits precede the implementation commit in the branch history; the final commit records this evidence.
