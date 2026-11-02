# Expense List Category / Applicant + Real Pagination — Design

> Date: 2026-11-02
> Status: Approved for implementation
> Scope: Expense list and expense detail read paths

## Goal

1. Fix the empty **类别 (category)** column in the expense list by returning aggregated category names from the API.
2. Add an **报销人 (applicant)** column to the expense list, sourced from `expense_reports.user_id -> users.name`.
3. Show the applicant in the **基本信息** section of the expense detail page.
4. Fix the broken pagination in the expense list: move filtering and paging to the server instead of loading page 1 and filtering in the browser.

## Confirmed Decisions

| Topic | Decision |
|---|---|
| Multi-category display | API returns `categoryNames: string[]`; frontend renders tags (first 3 + `+N`, full list in `title` tooltip) |
| Applicant field name | `applicantName`, consistent with `GET /approvals/pending` |
| Keyword scope | Preserve current UI promise: match `serial_no` OR `title` (case-insensitive) |
| Pagination | Server-side `page` / `pageSize`; API already exposes `total` |
| Detail page | Show applicant only; per-item category already exists there |
| Out of scope | Rewriting the stale `packages/web/src/api/expenses.ts` wrapper; global expense search redesign |

## Root Cause (verified)

- `ExpenseList.vue` renders `item.category`, but `GET /expenses` never returns it.
- `PgExpenseRepo.mapReport()` maps only columns of `expense_reports`; the table has no category column.
- Categories live per item: `expense_items.category_id -> expense_categories.name`. A report may have several.
- `GET /expenses` likewise returns only `userId`, so no applicant name is available to the UI.
- `ExpenseList.vue` fetches only page 1 and applies status/keyword filtering client-side; pagination buttons are hardcoded and do not fetch.

## Data Flow

```
GET /expenses?status=&keyword=&page=&pageSize=
  -> role branch:
       admin/finance | employee -> PgExpenseRepo.findMany()
       dept_approver           -> inline SQL in routes/expenses.ts
  -> SQL augments each report with:
       u.name                             AS applicant_name
       array_agg(DISTINCT ec.name)        AS category_names
  -> mapReport() / mapReportRow()
       applicantName: string
       categoryNames: string[]
  -> { results, total, page, pageSize }
  -> ExpenseList renders server-provided page and total
```

`GET /expenses/:id` uses `PgExpenseRepo.findById()`, which is extended to `JOIN users` and return `applicantName`.

## Query Design

### Category aggregation

```sql
COALESCE(
  (SELECT array_agg(DISTINCT ec.name ORDER BY ec.name)
     FROM expense_items ei
     JOIN expense_categories ec ON ec.id = ei.category_id
    WHERE ei.report_id = er.id),
  ARRAY[]::text[]
) AS category_names
```

### Applicant join

```sql
JOIN users u ON u.id = er.user_id
```

All `WHERE` predicates in the list queries must be qualified with `er.` because `users` also has `created_at` and `status`.

### Keyword

```sql
(er.serial_no ILIKE $n OR er.title ILIKE $n)   -- value: %keyword%
```

## API Contract

`GET /expenses` response items gain:

```json
{
  "applicantName": "张三",
  "categoryNames": ["交通", "住宿"]
}
```

`GET /expenses/:id` `report` gains:

```json
{ "applicantName": "张三" }
```

No new endpoints, no breaking removals. `categoryNames` is `[]` when a report has no items.

## Frontend

### `ExpenseList.vue`

- Columns: 编号 | 报销人 | 标题 | 金额 | 状态 | 类别 | 日期 | 操作.
- Fetch with `{ status, keyword, page, pageSize }`; keep a `total` ref from the response.
- Filter changes reset `page` to 1 and refetch (keyword debounced ~300 ms).
- Pagination renders `totalPages = max(1, ceil(total / pageSize))`, with prev/next and a windowed page list.
- Category cell renders tags: up to 3 names plus `+N`; container `title` contains the full joined list.
- Empty state `colspan` updated to 8.

### `ExpenseDetail.vue`

- `Report` interface gains `applicantName?: string`.
- 基本信息 grid gains an 报销人 item before 提交时间.

## Security

- No authorization changes. The three existing role branches keep their data-scope filters.
- Applicant names are already visible to admins/finance and to approvers within their department; employees only see their own reports.
- Category names are non-sensitive configuration data.

## Testing

- `pnpm --filter @sse/shared build` — type change compiles.
- `pnpm --filter @sse/db build` — repository SQL/mapping compiles.
- `pnpm --filter @sse/api build` — route changes compile.
- `pnpm --filter @sse/web build` — Vue/TS build.
- `pnpm --filter @sse/core test` — confirm no regression in domain services.
- Manual E2E when DB/API is available: list shows applicant + category tags; filters/paging hit the server; detail shows 报销人.

## Non-Goals

- Changing what "category" means at the report level (no new DB column).
- Reworking the unused `web/src/api/expenses.ts` types.
- Changing approval, verification, or ontology logic.
