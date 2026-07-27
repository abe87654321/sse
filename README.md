# SSE — Smart Staff Expense / 智能报销管理系统

[![License](https://img.shields.io/badge/license-Apache%202.0-blue.svg)](LICENSE) [![Node.js](https://img.shields.io/badge/Node.js→18+-339935?logo=node.js)](https://nodejs.org) [![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6?logo=typescript)](https://typescriptlang.org) [![Vue.js](https://img.shields.io/badge/Vue.js-3.x-42b883?logo=vue.js)](https://vuejs.org) [![pnpm](https://img.shields.io/badge/pnpm-9.x+-8B5CF6?logo=pnpm)](https://pnpm.io)

<div align="center">

<!-- SSE Logo -->
<svg width="120" height="120" viewBox="0 0 120 120" fill="none" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="sseGrad" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#ff6b6b" />
      <stop offset="100%" stop-color="#ffa94d" />
    </linearGradient>
  </defs>
  <!-- Background -->
  <rect x="4" y="4" width="112" height="112" rx="28" fill="url(#sseGrad)" />
  <!-- Phosphor invoice icon (regular) - white -->
  <g transform="translate(34, 26) scale(3.2)" stroke="#fff" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
    <!-- Document body -->
    <path d="M4 2h11a1 1 0 011 1v18a1 1 0 01-1 1H1a1 1 0 01-1-1V6l4-4z" fill="none" />
    <!-- Fold corner -->
    <path d="M4 2v4H0" fill="none" />
    <!-- Lines -->
    <line x1="4" y1="9" x2="12" y2="9" />
    <line x1="4" y1="13" x2="10" y2="13" />
    <line x1="4" y1="17" x2="8" y2="17" />
  </g>
  <!-- SSE text -->
  <text x="60" y="108" text-anchor="middle" font-family="Georgia, serif" font-size="16" font-weight="700" fill="#fff" opacity="0.85" letter-spacing="2">SSE</text>
</svg>

> AI-powered semantic expense management — **Speak. Scan. Submit.**
> 面向小微团队的智能报销系统：说话、拍照、自动报销。

</div>

---

## ✨ Features / 特性

| Feature | Description |
|---------|-------------|
| 📝 **Smart Reimbursement** | Natural-language expense submission ("张三出差住宿600元") |
| 🖼️ **Invoice OCR** | Upload PDF/OFD invoices, auto-extract data via AI vision models |
| 🔀 **Configurable Approval** | Multi-step approval chains based on amount & category |
| 🤖 **Ontology / Knowledge Graph** | OWL-based semantic model linking reports, people, and organizations |
| 🧠 **AI Semantic Engine** | LLM-powered entity extraction, category matching, and NL explanation |
| 📊 **Statistics & Export** | Charts, monthly trends, Excel export |
| 🔔 **Notifications** | In-app + SMS + Email with per-user preferences and delivery tracking |
| 📡 **MCP Protocol** | 13 read/write tools for AI Agent integration |
| 🔗 **SCIM 2.0 + MDM** | External identity sync via SCIM and MDM Webhook |
| 🗂️ **Object Storage** | Invoice files in MinIO, DB holds references only |
| 🔐 **RBAC** | 4 roles with data scope isolation |

---

## 🏗️ Architecture / 架构

Hexagonal Architecture (Ports & Adapters) — core business logic has zero framework dependencies.

```
┌────────────────────────────────────────────────────────┐
│                 Frontend (web/)                         │
│             Vue 3 · Pinia · Vite                        │
└───────────────────────┬────────────────────────────────┘
                        │ HTTP / MCP / SCIM
┌───────────────────────┴────────────────────────────────┐
│               Adapters / 适配器层                        │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐  │
│  │ api/     │ │ mcp/     │ │ ontology/│ │ scim/    │  │
│  │ Express  │ │ JSON-RPC │ │ OWL RDF  │ │ Webhook  │  │
│  └────┬─────┘ └────┬─────┘ └────┬─────┘ └────┬─────┘  │
│       └─────────────┼─────────────┼─────────────┘     │
│                     │             │                     │
│  ┌──────────┐ ┌─────┴─────┐ ┌────┴──────┐             │
│  │ db/      │ │ ocr/      │ │ ai/       │             │
│  │ Postgres │ │ PDF+OFD   │ │ Ollama    │             │
│  └────┬─────┘ └─────┬─────┘ └────┬──────┘             │
└───────┼─────────────┼─────────────┼────────────────────┘
        │             │             │
        └─────────────┼─────────────┘
                      ▼
┌────────────────────────────────────────────────────────┐
│            Domain Core (core/)                           │
│   Entities · Services · Ports — Zero framework deps     │
└────────────────────────────────────────────────────────┘
```

---

## 📦 Tech Stack / 技术栈

| Layer | Technology |
|-------|-----------|
| Frontend | Vue 3 + Vue Router + Pinia + Vite |
| Backend | Node.js + Express + TypeScript |
| Database | PostgreSQL 16 (UUID PKs, JSONB, full-text) |
| File Storage | MinIO (S3-compatible) |
| AI / OCR | Ollama (local LLM) + MinerU / PaddleOCR |
| Ontology | N3.js + RDF/JS + OWL 2 |
| Messaging | SMTP (nodemailer) + Aliyun SMS |
| Protocol | MCP (@modelcontextprotocol/sdk) + SCIM 2.0 |
| Auth | JWT + RBAC (4 roles) |
| Monorepo | pnpm workspaces |

---

## 👥 User Roles / 用户角色

| Role | Permissions |
|------|------------|
| 👤 Employee / 员工 | Create/view own reports, submit from text/voice |
| ✅ Dept. Approver / 部门审批人 | Approve reports from own department |
| 💰 Finance / 财务 | Full-company data, export, payment processing |
| ⚙️ Admin / 管理员 | User/role/rule management, broadcast messages, AI config, MDM setup |

---

## 🚀 Quick Start / 快速启动

### Prerequisites / 环境要求

| Component | Version |
|-----------|---------|
| Node.js | ≥ 18 |
| pnpm | ≥ 9 |
| Docker + Compose | Latest |

### Setup / 一键启动

```bash
git clone <repo-url> && cd sse
pnpm install
docker compose up -d
pnpm build
cp .env.example .env
DB_PORT=5433 pnpm migrate
pnpm dev
```

| Service | URL | Port |
|---------|-----|------|
| API | `http://localhost:3000` | 3000 |
| Web | `http://localhost:5173` | 5173 |
| PostgreSQL | `localhost:5433` | 5433 |
| MinIO API | `localhost:9002` | 9002 |
| MinIO Console | `localhost:9003` | 9003 |

> **Default login:** `13800000001` (admin) — change password after first login.

---

## 📁 Project Structure / 项目结构

```
sse/
├── packages/
│   ├── shared/          # Shared types, enums, DTOs
│   ├── core/            # Domain core (zero framework dependency)
│   ├── db/              # PostgreSQL repositories & migrations
│   ├── auth/            # JWT + RBAC
│   ├── api/             # Express REST API
│   ├── mcp/             # MCP Server (13 tools)
│   ├── ontology/        # OWL ontology + semantic orchestration engine
│   ├── ocr/             # Invoice OCR (PDF/OFD)
│   ├── ai/              # LLM provider (Ollama)
│   ├── notifications/   # SMS/Email + scheduler
│   └── web/             # Vue 3 SPA
├── docs/                # Design, deployment, process docs
├── docker-compose.yml
└── package.json
```

---

## 🔁 Approval Workflow / 审批流程

```
Draft ──submit──→ Pending ──all approved──→ Approved ──paid──→ Paid
  ↑                  │
  └──save draft───────┼──rejected──→ Rejected ──resubmit──→ Draft
                     │
           48h no approval → reminder
           96h no approval → escalation
```

---

## 🤖 Ontology & Semantic Engine / 本体语义引擎

Natural language → LLM extraction → ontology mapping → auto expense creation:

```
"张三出差北京住宿600元"
  → EntityExtractor: {person:"张三", amount:600, category:"住宿费"}
  → SemanticMapper: Person → DB userId, category → DB categoryId
  → ActionReasoner: match approval rule, validate
  → ActionExecutor: POST /expenses → submit
  → NL Explanation: "已为张三创建报销单，住宿费 ¥600，审批中。"
```

**Endpoints (9):**
- `POST /ontology/submit-from-text` — Natural language expense creation
- `POST /ontology/from-text` — NL → ontology graph generation (LLM extraction)
- `GET /ontology/graph` — Full ontology graph (nodes + edges)
- `GET /ontology/sync` — Full ontology sync from DB
- `GET /ontology/query?type=X` — Query ontology by class
- `PUT /ontology/entity` — Create/update entity
- `DELETE /ontology/entity?uri=...` — Delete entity
- `POST /ontology/relation` — Create relation
- `DELETE /ontology/relation` — Delete relation

**Visualization:** `/ontology` page — interactive Cytoscape.js graph with NL-to-graph generation, manual node/edge editing, and DB sync.

---

## 🔗 MDM & SCIM Integration / 主数据整合

```
External Systems (HR / LDAP / 企业微信)
  ├── SCIM 2.0 ─────────→ [users + identity_mappings]
  └── MDM Webhook ───────→ [users sync]
```

- `POST /scim/Users` — SCIM 2.0 user CRUD
- `POST /webhook/mdm` — MDM event receiver

---

## 📡 MCP Tools / MCP 工具

| Tool | Description |
|------|------------|
| `search_expenses` | Multi-condition search with pagination |
| `get_expense_detail` | Full report detail (items, invoices, approvals) |
| `get_approval_status` | Approval status & history |
| `get_statistics` | Aggregated stats by category/department |
| `get_user_summary` | Per-user expense overview |
| `list_pending_approvals` | Approver's pending queue |
| `submit_expense_from_text` | Natural language → create expense |
| `submit_expense_from_invoice` | Invoice image → OCR → create expense |
| `query_expense_status` | NL query: "张三这个月报销批了吗" |
| `explain_decision` | Approval chain + rule matching explanation |
| `validate_expense` | Compliance check + suggestions |
| `get_entity_network` | N-hop semantic relationship network |
| `query_ontology` | Query ontology graph by type or full graph |

---

## 📖 Documentation / 文档

| Doc | Content |
|-----|---------|
| [系统需求设计 (v2)](docs/2026-07-06-sse-design.md) | Full feature spec, data model, API, MCP schema |
| [部署文档](docs/2026-07-06-sse-deployment.md) | Step-by-step install, Docker, AI/OCR, email/SMS setup |
| [本体层设计](docs/2026-07-26-ontology-design.md) | OWL ontology + semantic orchestration engine |
| [MDM 整合设计](docs/2026-07-26-mdm-design.md) | SCIM 2.0 + MDM Webhook + Identity Bridge |
| [通知系统设计](docs/2026-07-26-notification-system-design.md) | In-app + SMS + Email notification system |
| [UserPicker 设计](docs/2026-07-26-userpicker-design.md) | Reusable user search/select component |
| [审批流设计器](docs/2026-07-07-workflow-organisation-design.md) | Visual drag-drop approval flow designer |
| [实体关系与权限矩阵](docs/2026-07-07-er-permission-matrix.md) | ER diagram, RBAC data scope, permission matrix |
| [开发过程记录 (2026-07-26)](docs/2026-07-26-sse-process.md) | Latest session progress, bug fixes, next steps |

---

## 📜 License / 许可

Apache License 2.0 — see [LICENSE](LICENSE) for details.
