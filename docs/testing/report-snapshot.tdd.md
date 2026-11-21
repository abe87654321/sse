# TDD Evidence Report: Report Snapshots (P1-5)

## 1. Source plan

- Design: `docs/superpowers/specs/2026-11-21-report-snapshot-design.md`
- Plan: `docs/superpowers/plans/2026-11-21-report-snapshot.md`
- Process record: `docs/2026-11-21-sse-process.md`

## 2. User journeys

1. As an employee, when I submit a report, the system stores an immutable JSON snapshot of what I submitted.
2. As an approver, each time I approve or reject a step, the system stores a snapshot with the report content, AI verification state, approval rule chain and my comment.
3. As finance, when I mark a report paid, the system stores a payment snapshot including payment reference and receipt metadata.
4. As an admin/auditor, I can list snapshots by report/type/time and open the payload; the UI shows whether the SHA-256 content hash still matches.

## 3. Task report

### Task 1: Shared types and core ports

- Summary: added snapshot payload/metadata types and `IReportSnapshotRepo` / `SqlExecutor` ports.
- Validation: `pnpm --filter @sse/shared build` and `pnpm --filter @sse/core build`.
- Result: PASS.
- Guarantee: later layers share one type contract for snapshot metadata and payload.

### Task 2: Core snapshot payload builder

- Summary: `buildReportSnapshotPayload` composes report, items, invoices, verification aggregate, rule chain, records, action and payment.
- RED: `pnpm --filter @sse/core test -- report-snapshot`
  - Output: `TS2307: Cannot find module '../report-snapshot'`
- GREEN: same command after implementation
  - Output: `Test Suites: 1 passed`, `Tests: 4 passed`.
- Guarantee: payload shape, invoice grouping, `no_invoices`, payment section and legacy null rule behave as specified.

### Task 3: Migration 023

- Summary: append-only table, SHA-256 hash, no foreign keys, backfill for non-draft reports.
- RED: `pnpm --filter @sse/db test -- migration-023`
  - Output: `ENOENT ... 023_report_snapshots.sql`
- GREEN: same command
  - Output: `Test Suites: 1 passed`, `Tests: 5 passed`.
- Guarantee: table/trigger/hash/backfill clauses exist and no `REFERENCES users|expense_reports` are introduced.

### Task 4: PgReportSnapshotRepo

- Summary: loads report/items/invoices/records/receipt, builds payload, inserts with SQL-computed hash; reads metadata/detail and clamps admin pagination.
- RED: `pnpm --filter @sse/db test -- pg-report-snapshot-repo`
  - Output: `TS2307: Cannot find module '../repositories/pg-report-snapshot-repo'`
- GREEN: same command
  - Output: `Test Suites: 1 passed`, `Tests: 4 passed`.
- Guarantee: capture uses the expected queries, sends the built payload, returns mapped metadata, and computes `hashValid`.

### Task 5: Transaction client threading

- Summary: approval record writes and expense status updates accept an optional transaction client; `ApprovalEngine` forwards it.
- RED: `pnpm --filter @sse/core test -- approval-engine`
  - Output: `TS2554: Expected 4 arguments, but got 5` and `Expected 3-4 arguments, but got 5`.
- GREEN: `pnpm --filter @sse/core test`
  - Output: `Test Suites: 7 passed`, `Tests: 59 passed`.
- Guarantee: `startApproval`, `approveStep`, `createNextStep` pass the transaction client to the record repo.

### Task 6: API capture and read routes

- Summary: submit/approve/reject/pay capture snapshots inside `withTransaction`; added expense snapshot reads and admin snapshot routes.
- RED: `pnpm --filter @sse/api test -- snapshots`
  - Output: `Cannot find module '../routes/admin-snapshots'`; GET snapshot returned 404; `mockCapture` called 0 times.
- GREEN: same command
  - Output: `Test Suites: 2 passed`, `Tests: 5 passed`.
- Full API suite: `pnpm --filter @sse/api test`
  - Output: `Test Suites: 23 passed`, `Tests: 180 passed`.
- Guarantee: report viewers can list snapshots, unrelated employees get 403, submit captures a `submit` snapshot in the transaction, admin endpoints are admin-only and pass filters, and receipt verification details are redacted for non-finance/admin.

### Task 7: Web display

- Summary: snapshot display helpers, viewer modal, detail card, admin page, route and navigation.
- RED: `pnpm --filter @sse/web test -- snapshot`
  - Output: `Failed to resolve import "../snapshot"`.
- GREEN: same command
  - Output: `Test Files 1 passed`, `Tests 5 passed`.
- Build: `pnpm --filter @sse/web build`
  - Output: `built in ~5s`, includes `AdminSnapshots` and `SnapshotViewer` chunks.
- Guarantee: labels/hash/time/actor formatting, plus the new views compile into the production bundle.

### Task 8: Full verification

- `pnpm -r test`: 717 tests passed across 9 packages with tests.
- `pnpm -r build`: all 11 workspace packages built.
- Real PostgreSQL migration: **not run** because Docker/`docker compose` is unavailable on this machine. Migration correctness is covered by static guard tests; run on the test machine before deployment.

## 4. Test specification

| # | What is guaranteed | Test file / command | Test type | Result | Evidence |
|---|---|---|---|---|---|
| 1 | Full snapshot payload includes report/items/invoices/verification/rule/action | `packages/core/src/services/__tests__/report-snapshot.test.ts` | unit | PASS | `pnpm --filter @sse/core test -- report-snapshot` |
| 2 | No invoices yields `no_invoices` | same | unit | PASS | same |
| 3 | Multiple invoices group per item; pay section includes payment/receipt | same | unit | PASS | same |
| 4 | Legacy input keeps rule null | same | unit | PASS | same |
| 5 | Approval engine forwards transaction client on create | `packages/core/src/services/__tests__/approval-engine.test.ts` | unit | PASS | `pnpm --filter @sse/core test` |
| 6 | Approval engine forwards transaction client on update | same | unit | PASS | same |
| 7 | Migration creates table, check, trigger, hash and backfill, no FKs | `packages/db/src/__tests__/migration-023.test.ts` | static | PASS | `pnpm --filter @sse/db test -- migration-023` |
| 8 | Repo capture loads data and inserts a hashed snapshot | `packages/db/src/__tests__/pg-report-snapshot-repo.test.ts` | unit | PASS | `pnpm --filter @sse/db test -- pg-report-snapshot-repo` |
| 9 | Repo reads order by created_at/id and return hashValid | same | unit | PASS | same |
| 10 | Admin query clamps limit to 200 and offset to 0 | same | unit | PASS | same |
| 11 | Owner can read snapshot metadata | `packages/api/src/__tests__/expenses-snapshots.test.ts` | integration | PASS | `pnpm --filter @sse/api test -- snapshots` |
| 12 | Unrelated employee gets 403 | same | integration | PASS | same |
| 13 | Submit captures a submit snapshot inside the transaction | same | integration | PASS | same |
| 14 | Admin snapshot endpoint rejects non-admin and returns filters | `packages/api/src/__tests__/admin-snapshots.test.ts` | integration | PASS | same |
| 15 | Snapshot type/hash/time/actor formatting | `packages/web/src/utils/__tests__/snapshot.test.ts` | unit | PASS | `pnpm --filter @sse/web test -- snapshot` |
| 16 | Receipt verification details are redacted for owners and kept for finance | `packages/api/src/__tests__/expenses-snapshots.test.ts` | integration | PASS | `pnpm --filter @sse/api test -- expenses-snapshots` |

## 5. Coverage and known gaps

- No coverage script is configured in these packages; coverage was not collected.
- No browser E2E test was added. The Web viewer is covered by its pure formatting tests and a production Vite build.
- The migration was not executed against a real PostgreSQL in this environment (Docker unavailable). Static tests assert the critical clauses; the process document records the deployment verification steps.
- `approve` / `reject` / `pay` capture paths are covered by the shared capture unit tests and the submit integration test; no separate HTTP integration test was added for each of those three paths.

## 6. Merge evidence

Checkpoint sequence (RED test commit → GREEN implementation commit):

| Stage | RED commit | GREEN commit |
|---|---|---|
| Core payload builder | `72be916` | `c7c7f3b` |
| Migration 023 | `8bb8b98` | `6556650` |
| Snapshot repo | `a9c38b8` | `482ac6d` |
| Client threading | `ada6667` | `754c8e6` |
| API routes | `2300e38` | `aafe7e5` |
| Web helpers | `7f9703a` | `2e58761` + `760d7ae` |

Shared types/ports (`42d1194`) contain no runtime behavior and are covered indirectly by the builder and repo tests.
