# SSE (Smart Staff Expense) — System Design Document

> Date: 2026-07-06 | Version: v1.0 | Status: Pending Review

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
| Invoice Processing | PDF/OFD upload; original binary stored in DB; OCR auto-recognition |
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
| File Storage | PostgreSQL BYTEA | MinIO / S3 |
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
| phone | VARCHAR(20) | Phone number |
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
| file_data | BYTEA | Binary original |
| ocr_result | JSONB | OCR extraction results |
| uploaded_at | TIMESTAMPTZ | Upload time |

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
  {"step": 1, "role": "dept_approver", "label": "Dept Approver"},
  {"step": 2, "role": "finance", "label": "Finance Review"}
]
```

#### ApprovalRecord
| Field | Type | Description |
|-------|------|-------------|
| id | UUID | Primary key |
| report_id | UUID | Expense report |
| step | INT | Step index |
| approver_id | UUID | Approver |
| result | ENUM | approved / rejected |
| comment | VARCHAR(500) | Approval comment |
| approved_at | TIMESTAMPTZ | Approval time |

### 3.3 Index Strategy

- `ExpenseReport(user_id, status)` — user expense list query
- `ExpenseReport(status, current_step)` — pending approval query
- `ExpenseReport(submitted_at)` — time-based statistics
- `ApprovalRecord(report_id, step)` — approval flow query
- `ApprovalRecord(approver_id, result)` — approver pending items

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

- After each step is approved, status advances to the next step automatically
- Any step rejection returns the report to "Rejected" status, notifying the applicant
- Applicant can modify and resubmit, starting from step 1
- Timeout reminder: auto-reminder after 48 hours without action

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
- MCP interface also uses JWT, no Refresh support

---

## 6. MCP Query Interface

### 6.1 Architecture

MCP Server runs as a separate process, sharing the business logic and data access layer with the REST API. Only read-only query capabilities are exposed.

### 6.2 Tool List

| Tool Name | Function | Key Parameters |
|-----------|----------|----------------|
| `search_expenses` | Multi-condition search | date range, applicant, status, category, amount range, keyword |
| `get_expense_detail` | View report detail | report ID → items, invoices, approval records |
| `get_approval_status` | Check approval progress | report ID → current step, approved/pending, history |
| `get_statistics` | Aggregate statistics | time range, department → totals, breakdown, averages, ranking |
| `get_user_summary` | User expense summary | user ID, timeframe → count, amount, category breakdown |
| `list_pending_approvals` | Pending approval list | approver ID → list of pending reports |

### 6.3 Security Constraints

- All query results are filtered by caller's role and department scope
- Read-only queries only; no write operations (submit, approve, modify) exposed
- JWT Token validation on every call

---

## 7. Invoice OCR Processing

### 7.1 Processing Flow

```
Upload PDF/OFD → Format validation → Type determination
                                        ├── PDF → OCR API recognition
                                        └── OFD → XML structured parsing
                                                  ↓
                                       Original saved to BYTEA
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
| Security | JWT expiration, XSS prevention, SQL injection prevention, file upload type validation |
| Mobile | Responsive design; submit and approve via mobile |
| Backup | Daily automated database backup |

---

## 11. Out of Scope (This Phase)

- Budget control (requires separate evaluation)
- Corporate payments / purchase requests
- Multi-currency support
- ERP system integration
- Native mobile app

---

> Document Location: `E:\app\opencode\sse\docs\2026-07-06-sse-design-en.md`
