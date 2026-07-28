# SSE (Smart Staff Expense) — System Design Document

> Date: 2026-07-06 | Version: v2.2 | Status: Synced with implementation
>
> **Changelog from v1.0:** Invoice storage moved from Postgres BYTEA to object storage (§2.4, §3.2, §7); added SMS/email reminder + escalation design with new `NotificationLog` table and `notifications/` package (§3.2, §4.4); added full MCP tool schemas, pagination, error contract, rate limiting, and versioning (§6); added upload validation detail (§7.3); decoupled MCP auth from user JWT (§5.3, §6.4).
>
> **Changelog v2.1 → v2.2:** §4 Approval Engine rewritten to reflect actual implementation — added full API flows for submission/approval/rejection (§4.3), dual-semantics approver resolution (role string vs UUID, §4.4), two-stage reminder logic (§4.5); documented design vs. implementation gap of 24h hardcoded threshold and unconsumed `escalate_to` field.

---

## 1. Project Overview

**SSE (Smart Staff Expense)** is an intelligent expense reimbursement system designed for small teams (5-20 people). It supports travel + daily expense reimbursement, configurable approval workflows, invoice OCR recognition, Excel report export, and MCP interfaces for AI Agent data queries.

### 1.1 Target Users

- Employee: submit reimbursements, view personal records
- Department Approver: approve department reimbursement requests
- Finance: review and process payments, view company-wide data
- Admin: user management, rule configuration

### 1.2 Core Capabilities

| Capability | Description |
|------------|-------------|
| Expense Types | Transport, accommodation, meals, entertainment, office supplies, communication, training, etc. |
| Approval Workflow | Auto-matches approval chains by amount range + expense category; rules are configurable |
| Invoice Processing | PDF/OFD upload; original stored in object storage, DB holds reference; OCR auto-recognition |
| Query & Export | Multi-dimension filtering, charts, Excel export |
| MCP Interface | 6 read-only query tools callable by AI Agents |
| Data Platform Integration | Reserved standard API gateway, Webhook push, UUID identifiers |

---

## 2. System Architecture

### 2.1 Modular Decoupled Design (Hexagonal Architecture)

Using **Ports & Adapters** pattern, core business logic is completely decoupled from infrastructure:

```
                        ┌──────────────────────┐
                        │     Frontend (web/)    │
                        │   Vue 3 SPA · Responsive│
                        └──────────┬───────────┘
                                   │ HTTP REST
              ┌────────────────────┼────────────────────┐
              │                    ▼                    │
              │  ┌─────────────────────────────────┐   │
              │  │       Adapter Layer               │   │
              │  │  ┌──────────┐  ┌──────────┐     │   │
              │  │  │  api/    │  │  mcp/    │     │   │
              │  │  │ Express  │  │ JSON-RPC │     │   │
              │  │  └────┬─────┘  └────┬─────┘     │   │
              │  │       │              │           │   │
              │  │  ┌────┴─────┐  ┌────┴─────┐     │   │
              │  │  │  db/     │  │  ocr/    │     │   │
              │  │  │ Postgres │  │ Invoice   │     │   │
              │  │  └────┬─────┘  └────┬─────┘     │   │
              │  │       │              │           │   │
              │  └───────┼──────────────┼───────────┘   │
              │          │              │               │
              │          ▼              ▼               │
              │  ┌─────────────────────────────────┐   │
              │  │         Ports (Interfaces)       │   │
              │  │  Contracts defined in core/      │   │
              │  │  IExpenseRepo · IApprovalEngine  │   │
              │  │  IOcrService · IExportService    │   │
              │  │  INotificationService            │   │
              │  └──────────────┬──────────────────┘   │
              │                 │                      │
              │                 ▼                      │
              │  ┌─────────────────────────────────┐   │
              │  │        Domain Core (core/)       │   │
              │  │   · Entities                     │   │
              │  │   · Business Rules               │   │
              │  │   · Approval Engine              │   │
              │  │   · Zero framework dependency    │   │
              │  └─────────────────────────────────┘   │
              └────────────────────────────────────────┘
```

**Decoupling Benefits:** Swap Express without touching business logic; OCR independently upgradeable; different sessions can work on isolated modules; unit tests run without database dependency.

### 2.2 Module Dependency Graph

```
shared/ (pure type definitions, no dependencies)
  ↑
  ├── core/ (domain core, depends only on shared)
  │     ↑
  │     ├── db/ (repository implementation, implements core interfaces)
  │     ├── auth/ (authentication implementation)
  │     ├── ocr/ (OCR implementation, implements core IOcrService)
  │     ├── notifications/ (implements core INotificationService)
  │     ├── api/ (REST adapter)
  │     └── mcp/ (MCP adapter)
  │
  └── web/ (frontend, depends only on shared types)
```

### 2.3 Project Directory Structure

```
sse/
├── packages/
│   ├── shared/          # Shared types, enums, DTO definitions
│   │   └── src/
│   │       ├── types/       # ExpenseReport, User, etc. interfaces
│   │       ├── enums/       # ReportStatus, UserRole, etc. enums
│   │       └── dto/         # Request/response DTO types
│   │
│   ├── core/            # Domain core — zero framework dependency
│   │   └── src/
│   │       ├── entities/    # Entity classes (User, ExpenseReport...)
│   │       ├── ports/       # Interface definitions (IExpenseRepo, IApprovalEngine...)
│   │       ├── services/    # Domain services (ApprovalEngine, ReportService...)
│   │       └── __tests__/
│   │
│   ├── db/              # Database implementation
│   │   └── src/
│   │       ├── migrations/   # Migration scripts
│   │       ├── repositories/ # Repository implementations (PgExpenseRepo...)
│   │       └── connection.ts # Connection pool
│   │
│   ├── auth/            # Authentication & authorization
│   │   └── src/
│   │       ├── jwt.ts        # JWT sign/verify
│   │       ├── middleware.ts  # Auth middleware
│   │       └── rbac.ts       # Permission evaluation
│   │
│   ├── api/             # REST API
│   │   └── src/
│   │       ├── routes/       # Route definitions
│   │       ├── controllers/  # Controllers (thin layer, calls core services)
│   │       ├── middleware/   # Validation, error handling
│   │       └── openapi.ts    # Swagger doc generation
│   │
│   ├── mcp/             # MCP Server
│   │   └── src/
│   │       ├── server.ts     # MCP server startup
│   │       ├── tools/        # 6 tool implementations
│   │       └── index.ts
│   │
│   ├── ocr/             # OCR Invoice Recognition
│   │   └── src/
│   │       ├── parser.ts     # Unified parsing entrypoint
│   │       ├── pdf.ts        # PDF OCR processing
│   │       ├── ofd.ts        # OFD XML parsing
│   │       └── providers/    # Third-party OCR API adapters
│   │
│   ├── notifications/   # SMS / Email delivery
│   │   └── src/
│   │       ├── channels/
│   │       │   ├── sms.ts        # SMS provider adapter
│   │       │   └── email.ts      # Email provider adapter
│   │       ├── templates/        # Reminder / escalation message templates
│   │       └── scheduler.ts      # Cron/queue job scanning for overdue approval steps
│   │
│   └── web/             # Frontend SPA
│       └── src/
│           ├── pages/        # 10 pages
│           ├── components/   # Shared components
│           ├── api/          # API call wrappers
│           ├── router/       # Route configuration
│           └── store/        # State management
│
├── docs/                # Documentation
├── docker-compose.yml   # Local dev environment
└── package.json         # Monorepo root config
```

### 2.4 Technology Stack

| Layer | Recommended | Alternative |
|-------|-------------|-------------|
| Frontend | Vue 3 + Element Plus | React + Ant Design |
| Backend | Node.js + TypeScript | Python FastAPI |
| Database | PostgreSQL | MySQL 8.0 |
| File Storage | MinIO / S3 (or S3-compatible) | PostgreSQL BYTEA (small-scale only, not recommended) |
| Notifications | SMS provider (e.g. Twilio / Aliyun SMS) + Email (SMTP / SendGrid / SES) | — |
| OCR | PaddleOCR (self-hosted) | Baidu OCR / Tencent OCR API |
| MCP | @modelcontextprotocol/sdk | Custom JSON-RPC |
| Auth | JWT + RBAC | — |
| Package Manager | pnpm workspace (monorepo) | npm workspaces |

---

## 3. Core Data Model

### 3.1 Entity Relationships

```
User ──1:N──> ExpenseReport ──1:N──> ExpenseItem ──1:1──> Invoice
                    │
                    └──1:N──> ApprovalRecord

ExpenseCategory <──N:1── ExpenseItem

ApprovalRule (standalone config table, not directly linked to reports)
```

### 3.2 Core Table Schemas

#### User
| Field | Type | Description |
|-------|------|-------------|
| id | UUID | Primary key |
| name | VARCHAR(50) | Display name |
| phone | VARCHAR(20) | Phone number (SMS reminders) |
| email | VARCHAR(100) | Email address, nullable (email reminders) |
| department | VARCHAR(50) | Department |
| role | ENUM | employee / dept_approver / finance / admin |
| parent_id | UUID | Direct supervisor |
| status | ENUM | active / disabled |
| created_at / updated_at | TIMESTAMPTZ | Timestamps |

#### ExpenseCategory
| Field | Type | Description |
|-------|------|-------------|
| id | UUID | Primary key |
| name | VARCHAR(50) | Category name |
| parent_id | UUID | Parent category, supports 2 levels |
| sort_order | INT | Sort order |

Default categories: Transport, Accommodation, Meals, Entertainment, Office Supplies, Communication, Training, Other

#### ExpenseReport
| Field | Type | Description |
|-------|------|-------------|
| id | UUID | Primary key |
| serial_no | VARCHAR(30) | Code, e.g. RE-20260706-001 |
| user_id | UUID | Applicant |
| title | VARCHAR(200) | Report title |
| total_amount | DECIMAL(12,2) | Total amount (denormalized) |
| status | ENUM | draft/pending/approved/rejected/paid |
| current_step | INT | Current approval step index |
| submitted_at | TIMESTAMPTZ | Submission time |
| completed_at | TIMESTAMPTZ | Completion time |
| created_at / updated_at | TIMESTAMPTZ | Timestamps |

#### ExpenseItem
| Field | Type | Description |
|-------|------|-------------|
| id | UUID | Primary key |
| report_id | UUID | Parent report |
| category_id | UUID | Expense category |
| amount | DECIMAL(10,2) | Amount |
| expense_date | DATE | Occurrence date |
| description | VARCHAR(500) | Description |

#### Invoice
| Field | Type | Description |
|-------|------|-------------|
| id | UUID | Primary key |
| item_id | UUID | Linked expense item |
| file_name | VARCHAR(200) | Original filename |
| file_format | ENUM | PDF / OFD |
| file_size | INT | File size (bytes) |
| storage_key | VARCHAR(255) | Object storage key/path (e.g. `invoices/2026/07/{uuid}.pdf`) |
| storage_bucket | VARCHAR(100) | Bucket name (supports multi-bucket / multi-region later) |
| checksum | VARCHAR(64) | SHA-256 of the file, for integrity verification and de-dup |
| ocr_result | JSONB | OCR extraction results |
| uploaded_at | TIMESTAMPTZ | Upload time |

> **Storage note:** the original binary lives in object storage (MinIO/S3), not in Postgres. The database only stores the reference (`storage_bucket` + `storage_key`) and metadata. This keeps the database small and backups fast; object storage handles the actual file bytes, versioning, and lifecycle rules independently.

**OCR JSONB structure example:**
```json
{
  "invoice_no": "12345678",
  "amount": 1500.00,
  "tax_amount": 45.00,
  "total_amount": 1545.00,
  "invoice_date": "2026-07-01",
  "seller_name": "XX Technology Co., Ltd.",
  "buyer_name": "XX Company",
  "status": "verified"
}
```

#### ApprovalRule
| Field | Type | Description |
|-------|------|-------------|
| id | UUID | Primary key |
| name | VARCHAR(100) | Rule name |
| min_amount | DECIMAL(12,2) | Lower bound (inclusive) |
| max_amount | DECIMAL(12,2) | Upper bound (exclusive) |
| category_ids | UUID[] | Applicable categories; empty = all |
| approval_chain | JSONB | Approval chain config |
| priority | INT | Priority (lower = higher) |
| is_active | BOOLEAN | Enabled |

**approval_chain JSONB example:**
```json
[
  {
    "step": 1,
    "role": "dept_approver",
    "label": "Dept Approver",
    "reminder_after_hours": 48,
    "escalate_after_hours": 96,
    "escalate_to": "parent_of_approver"
  },
  {
    "step": 2,
    "role": "finance",
    "label": "Finance Review",
    "reminder_after_hours": 48,
    "escalate_after_hours": 96,
    "escalate_to": "admin"
  }
]
```
`escalate_to` accepts `"parent_of_approver"` (uses the approver's `User.parent_id`) or a fixed role name (e.g. `"admin"`). Both fields are optional per step; omitting them disables escalation for that step and falls back to reminder-only.

#### ApprovalRecord
| Field | Type | Description |
|-------|------|-------------|
| id | UUID | Primary key |
| report_id | UUID | Expense report |
| step | INT | Step index |
| approver_id | UUID | Approver |
| step_started_at | TIMESTAMPTZ | When this step became active; base timestamp for reminder/escalation timing |
| result | ENUM | approved / rejected / pending |
| comment | VARCHAR(500) | Approval comment |
| approved_at | TIMESTAMPTZ | Approval time |
| reminder_sent_at | TIMESTAMPTZ | Nullable; set when the first reminder fires for this step, prevents duplicate sends |
| escalated_at | TIMESTAMPTZ | Nullable; set if this step's timeout escalation has fired |

#### NotificationLog

Backs the reminder/escalation feature (§4.3) and the Notifications page (§8, page 10).

| Field | Type | Description |
|-------|------|-------------|
| id | UUID | Primary key |
| report_id | UUID | Related expense report |
| recipient_id | UUID | User being notified |
| channel | ENUM | sms / email |
| trigger_type | ENUM | approval_reminder / escalation / rejected / paid |
| status | ENUM | sent / failed / pending |
| sent_at | TIMESTAMPTZ | When dispatched |
| error_message | VARCHAR(500) | Provider error, if failed |

### 3.3 Index Strategy

- `ExpenseReport(user_id, status)` — user expense list query
- `ExpenseReport(status, current_step)` — pending approval query
- `ExpenseReport(submitted_at)` — time-based statistics
- `ApprovalRecord(report_id, step)` — approval flow query
- `ApprovalRecord(approver_id, result)` — approver pending items
- `NotificationLog(report_id)` — notification history per report
- `NotificationLog(recipient_id, sent_at)` — user's notification history, chronological
- `ApprovalRecord(result, step_started_at)` — scheduler's scan for overdue pending steps

---

## 4. Approval Engine

### 4.1 Rule Matching Logic

1. User submits report; compute total amount
2. Filter rules where `is_active=true` and amount falls within `[min_amount, max_amount)`
3. If category filter exists, further match expense categories in the report
4. Sort by `priority` ascending; take the first matching rule
5. Execute approval chain steps sequentially per the rule

### 4.2 State Machine

```
Draft ──submit──> Pending ──all approved──> Approved ──paid──> Paid
  ^                  │
  │                  ├──rejected──> Rejected ──resubmit──> Draft
  │                  │
  └───save draft─────┘
```

### 4.3 Approval Workflow

**Submission Phase** (`api/routes/expenses.ts — POST /:id/submit`):

1. Validate identity (must be owner, must be DRAFT)
2. Aggregate totals and category IDs from `expense_items`
3. Call `ApprovalEngine.matchRule(totalAmount, categoryIds)` to find the matching rule
4. If a rule is matched and the chain's first step is valid, call `startApproval()` to create the first `ApprovalRecord` (`result=pending`)
5. Update report: `status=pending, current_step=1, submitted_at=NOW()`

**Approval Phase** (`api/routes/approvals.ts`):

- **Approve (`POST /approvals/:reportId/approve`)**:
  1. Find the current step's pending record (matching approver role), call `approveStep(PENDING→APPROVED)`
  2. Re-run `matchRule()` with current report data (rule changes take effect immediately for in-flight reports)
  3. If not last step → `createNextStep()` advances to `current_step+1`; if last step → report status set to `APPROVED`
  4. If no rule matched, or `createNextStep()` returns null → report status set to `APPROVED`

- **Reject (`POST /approvals/:reportId/reject`)**:
  1. Requires a non-empty `comment`
  2. Find matching pending record, call `approveStep(PENDING→REJECTED)`
  3. Report status set to `REJECTED`; no further steps created; existing steps preserved
  4. Applicant can modify and resubmit, starting from step 1

- **Concurrency**: No optimistic locking or distributed lock. Relies on PostgreSQL row-level locking. Simultaneous approvals by multiple users on the same report carry a race-condition risk.

- **In-flight rule changes**: `matchRule()` re-runs on every approval action. If the approval chain is modified while a report is in-flight, subsequent steps follow the new rule, which may produce unexpected behavior.

### 4.4 Approver Resolution

`ApprovalRecord.approver_id` carries two semantics:

| Value type | Example | Resolution |
|-----------|---------|------------|
| Role string | `"dept_approver"`, `"finance"` | Query all active users with that role in the same department |
| UUID | `"550e8400-..."` | Look up that specific user |

Disambiguated at runtime via regex `/^[0-9a-f-]{36}$/i`. The scheduler resolves role-based approvers to **all** active users with that role in the department.

### 4.5 Reminders & Escalation

The scheduler (`notifications/src/scheduler.ts`) starts with the API server, running every 15 minutes:

1. Query: `approval_records.result = 'pending' AND step_started_at < NOW() - 24 hours`, joining to confirm the associated rule is still active
2. **Two-stage logic**:
   - `reminder_sent_at` is null → send **reminder** (SMS + email), set `reminder_sent_at`
   - `reminder_sent_at` already set → send **escalation** (SMS + email), set `escalated_at`
3. Recipients: resolved per §4.4 approver resolution rules; reminders go to all matching approvers
4. Every send (success or failure) is recorded in `NotificationLog`, preventing duplicate sends on scheduler restart
5. Send failures are not retried and do not block the scheduler from processing other records

> **Design vs. Implementation Gap**: The current implementation hardcodes a 24-hour threshold and does not consume `ApprovalChainStep.reminderAfterHours` / `escalateAfterHours` (per-step configurable time windows) or `escalate_to` (escalation target resolution). These fields are reserved in the type definitions and data model; the scheduler needs future alignment.

### 4.6 Minimal Approval (Fallback Rule)

In small companies, one person often holds multiple roles (e.g., both department approver and finance). The standard approval chain `dept_approver → finance` forces the same person to approve the same report twice. The system resolves this via a **fallback rule + deduplication on detect**:

**Fallback Rule**: A rule with `priority=9999`, full amount range (`[0, 99999999)`), no category filter, and a single-step chain with a designated assignee. `matchRule()` is unchanged — when no higher-priority rule matches, this rule naturally returns.

**Deduplication on Detect**: Upon report submission (`POST /expenses/:id/submit`), after `matchRule()` returns a rule, resolve the actual approvers for each step:

1. Role-based step → `userRepo.findByRole(role, department)`
2. Assignee-based step → `userRepo.findById(assigneeId)`
3. Compare approver sets across steps; if all resolve to the same person or partially overlap → merge into a single step
4. Notify all admins upon deduplication
5. Subsequent approval progression references the actual effective steps rather than the original rule chain, preventing step misalignment

> Detailed design: `docs/2026-07-28-fallback-approval-design.md`.

---

## 5. Permission Design (RBAC)

### 5.1 Role Definitions

| Role | Permission Overview |
|------|--------------------|
| Employee | Submit expenses, view own records, check approval progress |
| Dept Approver | Approve department members' expenses, view department data |
| Finance | Review & process payments, view company-wide data, export reports |
| Admin | User management, role assignment, category maintenance, rule configuration |

### 5.2 Data Scope Isolation

| Role | Data Visibility |
|------|-----------------|
| Employee | Own reports only |
| Dept Approver | All reports in own department |
| Finance, Admin | All reports company-wide |

### 5.3 Authentication

- JWT Token authentication, obtained on login
- Token validity: 2 hours, with Refresh Token support
- **MCP interface uses a separate long-lived API key (not the 2-hour user JWT)** — see §6.4. Requiring an AI agent to re-run an interactive login flow every 2 hours isn't practical, so MCP auth is deliberately decoupled from the web session model.

---

## 6. MCP Query Interface

### 6.1 Architecture

MCP Server runs as a separate process, sharing the business logic and data access layer with the REST API. Only read-only query capabilities are exposed. Tool names are versioned implicitly by the MCP server's advertised protocol/tool version (§6.5) — breaking parameter or schema changes require a new minor tool version, not a silent change to an existing tool's contract.

### 6.2 Common Conventions

These apply to every tool below, so they're stated once instead of repeated per tool:

- **Pagination**: any tool returning a list accepts `page` (default `1`) and `page_size` (default `20`, max `100`). Responses include a `pagination` object: `{ "page": 1, "page_size": 20, "total": 143, "has_more": true }`.
- **Errors**: all tools return errors in a consistent shape rather than throwing raw exceptions:
  ```json
  { "error": { "code": "NOT_FOUND", "message": "Report not found or not accessible" } }
  ```
  Standard `code` values: `NOT_FOUND` (unknown ID, or exists but outside caller's scope — deliberately not distinguished, to avoid leaking existence of out-of-scope records), `INVALID_PARAMS`, `UNAUTHORIZED` (bad/expired key), `RATE_LIMITED`, `INTERNAL_ERROR`.
- **Scope filtering**: every result set is silently filtered to the caller's role/department scope (§5.2) before pagination is applied — an agent never sees a total count that includes out-of-scope records.
- **Dates**: all timestamps ISO-8601 UTC; date-only params as `YYYY-MM-DD`.

### 6.3 Tool List & Schemas

#### `search_expenses`
Multi-condition search over expense reports.

Params: `date_from`, `date_to` (YYYY-MM-DD), `applicant_id` (UUID, optional), `status` (enum, optional), `category_id` (UUID, optional), `amount_min`, `amount_max` (decimal, optional), `keyword` (string, optional, matches title), `page`, `page_size`.

```json
{
  "results": [
    {
      "report_id": "uuid",
      "serial_no": "RE-20260706-001",
      "title": "Q2 client visit",
      "applicant_name": "Jane Doe",
      "total_amount": 1545.00,
      "status": "pending",
      "submitted_at": "2026-07-01T09:00:00Z"
    }
  ],
  "pagination": { "page": 1, "page_size": 20, "total": 143, "has_more": true }
}
```

#### `get_expense_detail`
Params: `report_id` (UUID, required).

```json
{
  "report_id": "uuid",
  "serial_no": "RE-20260706-001",
  "title": "Q2 client visit",
  "status": "pending",
  "total_amount": 1545.00,
  "items": [
    { "item_id": "uuid", "category": "Transport", "amount": 1545.00, "expense_date": "2026-07-01", "description": "..." }
  ],
  "invoices": [
    { "invoice_id": "uuid", "file_name": "invoice.pdf", "ocr_result": { "invoice_no": "12345678", "amount": 1500.00 } }
  ],
  "approval_records": [
    { "step": 1, "approver_name": "John Lee", "result": "approved", "approved_at": "2026-07-02T10:00:00Z" }
  ]
}
```
No `pagination` object — this is a single-record lookup.

#### `get_approval_status`
Params: `report_id` (UUID, required).

```json
{
  "report_id": "uuid",
  "status": "pending",
  "current_step": 2,
  "total_steps": 2,
  "history": [
    { "step": 1, "role": "dept_approver", "approver_name": "John Lee", "result": "approved", "approved_at": "2026-07-02T10:00:00Z" },
    { "step": 2, "role": "finance", "approver_name": null, "result": "pending", "approved_at": null }
  ]
}
```

#### `get_statistics`
Params: `date_from`, `date_to`, `department` (optional).

```json
{
  "total_amount": 128450.00,
  "report_count": 87,
  "by_category": [ { "category": "Transport", "amount": 45200.00, "percentage": 35.2 } ],
  "by_department": [ { "department": "Engineering", "amount": 62000.00 } ],
  "average_per_report": 1476.44
}
```

#### `get_user_summary`
Params: `user_id` (UUID, required), `date_from`, `date_to` (optional).

```json
{
  "user_id": "uuid",
  "report_count": 12,
  "total_amount": 15200.00,
  "by_category": [ { "category": "Meals", "amount": 3200.00 } ]
}
```

#### `list_pending_approvals`
Params: `approver_id` (UUID, required), `page`, `page_size`.

```json
{
  "results": [
    { "report_id": "uuid", "serial_no": "RE-20260706-001", "applicant_name": "Jane Doe", "total_amount": 1545.00, "step_started_at": "2026-07-01T09:00:00Z" }
  ],
  "pagination": { "page": 1, "page_size": 20, "total": 4, "has_more": false }
}
```

### 6.4 Authentication & Rate Limiting

- Separate long-lived **MCP API key** per calling agent/integration, distinct from user login JWTs (§5.3) — allows revocation per-agent without affecting human users.
- Each key is bound to a specific user identity for scope-filtering purposes (an agent acts *as* someone, inheriting that person's role/department visibility — it never gets broader access than its bound user).
- Rate limit: default **60 calls/minute per key**, returned as `RATE_LIMITED` error with a `retry_after_seconds` field when exceeded. Configurable per key for higher-throughput integrations.

### 6.5 Versioning

- The MCP server advertises a `server_version` in its handshake/metadata.
- Adding a new optional param or a new field to a response is a non-breaking (patch) change.
- Renaming a tool, removing/renaming a field, or changing a field's type is a breaking change — ships as a new tool name (e.g. `search_expenses_v2`) alongside the old one for a deprecation window, mirroring the REST `/api/v1/` convention in §9.

### 6.6 Security Constraints

- All query results are filtered by caller's role and department scope (§6.2)
- Read-only queries only; no write operations (submit, approve, modify) exposed
- API key validated on every call; invalid/revoked keys return `UNAUTHORIZED`

---

## 7. Invoice OCR Processing

### 7.1 Processing Flow

```
Upload PDF/OFD → Size + MIME-sniff validation → Format validation → Type determination
                                                                        ├── PDF → OCR API recognition
                                                                        └── OFD → XML structured parsing
                                                                                  ↓
                                                        Original uploaded to object storage (MinIO/S3)
                                                        storage_key + checksum saved to Invoice row
                                                        OCR result saved to JSONB
                                                                                  ↓
                                                        Return recognition results to frontend
                                                        ← User confirms/corrects
```

### 7.2 OFD vs PDF

| | PDF Invoice | OFD Invoice |
|--|-------------|-------------|
| Extraction | OCR image recognition | XML structured parsing |
| Accuracy | Depends on OCR quality | Near 100% |
| Processing Speed | Slower | Fast |
| Standard | Non-national standard | Chinese e-invoice national standard (GB/T 33190) |

### 7.3 Upload Validation

- **Max file size**: 10 MB per invoice (configurable).
- **MIME sniffing, not extension trust**: validate actual file signature/magic bytes, not just the `.pdf`/`.ofd` extension — a renamed file must not bypass type checks.
- **Checksum**: SHA-256 computed on upload, stored on the `Invoice` row (§3.2); used both for integrity verification and to detect duplicate uploads of the same invoice.
- **Storage isolation**: uploaded files are written to object storage under a non-executable, non-web-served path/bucket — never returned as a direct public URL; access is brokered through the API (signed/short-lived URLs or authenticated streaming), so the bucket itself is never publicly listable or directly reachable.

---

## 8. Page Structure

| # | Page | Description |
|---|------|-------------|
| 1 | Login | Username/password login, JWT auth |
| 2 | Dashboard Home | Pending items, stat cards, shortcuts, notifications |
| 3 | Expense List | Filter/search, status badges, pagination |
| 4 | New/Edit Report | Form, dynamic expense items, invoice upload |
| 5 | Report Detail | Items display, invoice preview, approval timeline |
| 6 | Approval Handling | Pending list, single/batch approval, comments |
| 7 | Statistics & Reports | Charts, multi-dimension filtering, Excel export |
| 8 | Profile | Personal info, expense summary, change password |
| 9 | System Admin | User management, role assignment, categories, approval rules |
| 10 | Notifications | In-app messages, approval reminders, rejection/payment notifications |

---

## 9. Data Platform Integration (Reserved)

### 9.1 Design Principles

- **All-UUID Primary Keys**: No dependency on auto-increment IDs; globally unique across systems
- **Timestamp Tracking**: All records include `created_at` / `updated_at` for incremental sync
- **Versioned API**: `/api/v1/` paths; future upgrades don't break existing consumers
- **OpenAPI Documentation**: Auto-generated Swagger, consumable directly by data platforms

### 9.2 Open Data Interfaces (Future Phase)

| Interface | Description |
|-----------|-------------|
| `GET /api/v1/open/reports` | Paginated report retrieval (supports incremental timestamp filtering) |
| `GET /api/v1/open/statistics` | Aggregated statistics |
| `POST /api/v1/webhooks/register` | Webhook callback registration |
| Webhook Events | `report.created` / `report.approved` / `report.paid` |

### 9.3 Authentication

- API Key (HMAC signature), isolated from web user token auth
- Configurable IP whitelist

---

## 10. Non-Functional Requirements

| Dimension | Requirement |
|-----------|-------------|
| Response Time | List query < 500ms, detail < 300ms |
| Concurrency | Support 20 simultaneous online users |
| Security | JWT expiration, XSS prevention, SQL injection prevention, file upload type/size/MIME validation |
| Mobile | Responsive design; submit and approve via mobile |
| Backup | Daily automated database backup; object storage bucket versioning/lifecycle policy for invoice files |
| Notification Reliability | SMS/email delivery failures are logged (`NotificationLog`) and do not block approval workflow progress; failed sends do not retry indefinitely (cap retries, then leave as `failed` for manual follow-up) |

---

## 11. Out of Scope (This Phase)

- Budget control (requires separate evaluation)
- Corporate payments / purchase requests
- Multi-currency support
- ERP system integration
- Native mobile app

---

> Document Location: `E:\app\opencode\sse\docs\2026-07-06-sse-design-en-v2.md`