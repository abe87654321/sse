# SSE — Smart Staff Expense / 智能报销管理系统

[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE) [![Node.js](https://img.shields.io/badge/Node.js→18+-339935?logo=node.js)](https://nodejs.org) [![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6?logo=typescript)](https://typescriptlang.org) [![Vue.js](https://img.shields.io/badge/Vue.js-3.x-42b883?logo=vue.js)](https://vuejs.org) [![pnpm](https://img.shields.io/badge/pnpm-9.x+-8B5CF6?logo=pnpm)](https://pnpm.io)

> A lightweight, AI-powered reimbursement management system for small teams (5–20 people).
> 面向小微团队（5-20 人）的智能报销管理系统，支持发票 OCR 识别、可配置审批流、AI 智能填单与 MCP 接口。

<div align="center">

```
┌─────────────────────────────────────────────────┐
│              SSE Dashboard / 工作台               │
│                                                  │
│   ┌──────────┐  ┌──────────┐  ┌──────────┐     │
│   │  待审批   │  │  已提交   │  │  已打款   │     │
│   │ Pending  │  │ Submitted│  │  Paid    │     │
│   │   12     │  │   23     │  │   87     │     │
│   └──────────┘  └──────────┘  └──────────┘     │
│                                                  │
│   ┌────────────────────────────────────┐        │
│   │         费用趋势图 / Expense Chart   │        │
│   │   ╱╲    ╱╲    ╱╲       ╱╲          │        │
│   │  ╱  ╳──╳  ╳──╳  ╲──  ╳  ╲         │        │
│   │ ╱___╲__╳__╳__╳__╳__╳___╲        │        │
│   └────────────────────────────────────┘        │
│                                                  │
│   新建报销  │  审批处理  │  统计报表  │  系统管理    │
│  New Rep.  │  Approval │  Statistics│  Settings   │
└─────────────────────────────────────────────────┘
```

</div>

---

## ✨ Features / 特性

| Feature / 功能 | Description / 说明 |
|--------|--------|
| 📝 **Smart Reimbursement / 智能报销** | Create reports with expense items, auto-calculate totals · 填写费用明细，自动计算金额 |
| 🖼️ **Invoice OCR / 发票识别** | Upload PDF/OFD invoices, auto-extract data via AI vision models · 上传发票文件，AI 自动识别发票信息 |
| 🔀 **Configurable Approval / 可配置审批** | Multi-step approval chains based on amount & category, fully configurable · 按金额区间和费用类型自动匹配多级审批链 |
| 📊 **Statistics & Reports / 统计报表** | Filter by department, category, date range; export to Excel · 多维度筛选统计，图表展示，Excel 导出 |
| 🤖 **MCP Integration / AI 查询** | 6 read-only query tools for AI Agent integration via MCP protocol · 6 个只读查询工具，AI Agent 可调用 |
| 🔔 **Reminders & Escalation / 提醒升级** | Configurable SMS/email alerts for pending approvals · 审批超时自动短信/邮件提醒和升级通知 |
| 🗂️ **Object Storage / 对象存储** | Invoice files stored in MinIO, DB only holds references · 发票原件存 MinIO，数据库仅存引用 |
| 🔐 **RBAC / 角色权限** | Four built-in roles with data scope isolation · 员工 / 审批人 / 财务 / 管理员，数据范围隔离 |

---

## 🏗️ Architecture / 架构

Adopting **Ports & Adapters (Hexagonal Architecture)** — the core business logic has zero framework dependencies.

采用 **六边形架构（端口-适配器模式）** — 核心业务逻辑零框架依赖，换掉 Express 不影响业务、OCR 可独立升级、单元测试不依赖数据库。

<div align="center">

```
┌─────────────────────────────────────────────────┐
│           前端 Frontend (web/)                    │
│        Vue 3 · Element Plus · Pinia · Vite        │
└──────────────────────┬──────────────────────────┘
                       │ HTTP REST / API 接口
┌──────────────────────┴──────────────────────────┐
│              适配器层 Adapters                    │
│   ┌──────────────────┐   ┌──────────────────┐  │
│   │  api/ Express    │   │  mcp/ JSON-RPC   │  │
│   └────────┬─────────┘   └────────┬─────────┘  │
│            │                      │             │
│   ┌────────┴─────────┐   ┌────────┴─────────┐  │
│   │  db/ Postgres    │   │  ocr/ PDF+OFD    │  │
│   └────────┬─────────┘   └────────┬─────────┘  │
└────────────┼──────────────────────┼─────────────┘
             │  端口 Ports          │  端口 Ports
┌────────────┴──────────────────────┴─────────────┐
│              领域核心 Domain Core (core/)         │
│    Entities 权限证  ·  Services 审批引擎           │
│         · 零框架依赖 Zero Framework Dependencies   │
└─────────────────────────────────────────────────┘
```

</div>

---

## 📦 Tech Stack / 技术栈

| Layer / 层级 | Technology / 技术 |
|-------------|------|
| **Frontend / 前端** | Vue 3 + Element Plus + Pinia + Vite |
| **Backend / 后端** | Node.js + Express + TypeScript |
| **Database / 数据库** | PostgreSQL 16 |
| **File Storage / 文件存储** | MinIO (S3-compatible object storage / S3 兼容对象存储) |
| **AI / OCR / 人工智能** | Ollama (local) + MinerU / PaddleOCR (optional) |
| **Authentication / 认证** | JWT + RBAC (四角色权限) |
| **MCP** | @modelcontextprotocol/sdk |
| **Monorepo** | pnpm workspaces |

---

## 👥 User Roles / 用户角色

| Role / 角色 | Permission / 权限 |
|-------------|------|
| 👤 **Employee / 员工** | Create reports, view own records · 提交报销、查看个人记录、查看审批进度 |
| ✅ **Dept. Approver / 审批人** | Approve reports from own department · 审批本部门报销申请 |
| 💰 **Finance / 财务** | Verify payments, view full company data, export reports · 复核打款、查看全公司数据、导出报表 |
| ⚙️ **Admin / 管理员** | User/role management, approval rules, AI config · 用户管理、角色分配、审批规则配置、AI 参数设置 |

---

## 🚀 Quick Start / 快速启动

### Prerequisites / 环境要求

| Component / 组件 | Version / 版本 |
|---------|---------|
| Node.js | ≥ 18 |
| pnpm | ≥ 9 |
| Docker + Compose | Latest（用于启动 PostgreSQL + MinIO） |

### One-shot Setup / 一键启动

```bash
# 1. Clone & install / 拉取代码并安装依赖
git clone <repo-url>
cd sse
pnpm install

# 2. Start infrastructure / 启动基础设施 (PostgreSQL + MinIO)
docker compose up -d

# 3. Build & initialize database / 编译项目并初始化数据库
pnpm build
cp .env.example .env
DB_PORT=5433 pnpm migrate

# 4. Start dev server / 启动开发服务器
pnpm dev
```

| Service / 服务 | URL / 访问地址 | Port / 端口 |
|--------|--------|------|
| **API** | `http://localhost:3000` | 3000 |
| **Web / 前端** | `http://localhost:5173` (加 `--host` 允许外部访问) | 5173 |
| **PostgreSQL** | `localhost:5433` → container 5432 | 5433 |
| **MinIO API** | `localhost:9002` → container 9000 | 9002 |
| **MinIO Console** | `localhost:9003` → container 9001 | 9003 |

> **Default login / 默认账号:** 手机号 `13800000001`（管理员）— 首次登录后请修改密码

---

## 🤖 AI & OCR Setup / AI 与 OCR 配置

```bash
# Install Ollama / 安装本地 AI 模型服务
curl -fsSL https://ollama.com/install.sh | sh
ollama pull llama3.2-vision:11b    # 推荐视觉模型 / Recommended vision model

# Start Ollama service / 启动 Ollama 服务
ollama serve                        # 前台启动，或在后台运行 / run in background
```

配置路径 / Config path: 管理后台 → AI 模型设置 → 保存配置 → 点击检验

---

## 📁 Project Structure / 项目结构

```
sse/
├── packages/
│   ├── shared/          # 共享类型 · Shared types, enums, DTOs
│   ├── core/            # 领域核心 · Domain core (zero framework dependency / 零框架依赖)
│   │   ├── entities/    # 实体类 · User, ExpenseReport, Invoice...
│   │   ├── ports/       # 接口定义 · IExpenseRepo, IApprovalEngine...
│   │   └── services/    # 领域服务 · ApprovalEngine, ReportService...
│   ├── db/              # 数据库 · PostgreSQL repositories & migrations
│   ├── auth/            # 认证授权 · JWT authentication & RBAC
│   ├── api/             # REST API · Express REST API
│   ├── mcp/             # MCP Server · 6 read-only query tools / 6 个只读查询工具
│   ├── ocr/             # 发票 OCR · Invoice OCR (PDF/OFD parsing)
│   ├── ai/              # AI 引擎 · AI vision & smart form filling
│   ├── notifications/   # 通知提醒 · SMS/Email alerts & scheduler
│   └── web/             # 前端 · Vue 3 SPA
├── docs/                # 文档 · Design & deployment docs / 设计与部署文档
├── docker-compose.yml   # Docker 基础设施 / Infrastructure
└── package.json         # Monorepo 根配置 · Monorepo root config
```

---

## 🔁 Approval Workflow / 审批流程

Reports auto-route through configurable multi-step chains based on amount & category.
报销单按金额区间和费用类型自动匹配多级审批链。

<div align="center">

```
┌──────────┐   提交   ┌──────────┐  全部通过  ┌──────────┐  打款  ┌──────────┐
│  草稿     │ ───────→ │  待审批   │ ─────────→ │  已通过   │ ─────→ │  已打款  │
│  Draft   │          │  Pending │            │Approved │        │  Paid   │
└──────────┘          └──────────┘            └──────────┘        └──────────┘
   ▲                       │
   │                       ├─ 驳回 ──→ 已驳回 ──→ 修改重提 ──→ 草稿
   │                       │  Rejected              Edit & Resubmit
   │                       │
   └─── 保存草稿 ←──────────┘
         ↑ 48h 无审批 → 发送提醒
         ↑ 96h 无审批 → 升级通知上级
```

</div>

---

## 🔍 MCP Tools / MCP 查询工具

Six read-only query tools for AI Agents via MCP protocol. 6 个只读查询工具，供 AI Agent 查询报销数据。

| Tool / 工具 | Description / 说明 |
|-----------|------|
| `search_expenses` | 多条件搜索报销单 — Multi-condition search with pagination |
| `get_expense_detail` | 查看报销单完整详情（含明细、发票、审批）— Full report detail |
| `get_approval_status` | 查看审批进度和历史 — Approve status & history |
| `get_statistics` | 汇总统计数据（按类别/部门）— Aggregated stats by category & dept |
| `get_user_summary` | 个人费用概览 — Per-user expense overview |
| `list_pending_approvals` | 待审批列表 — Approver's pending queue |

---

## 🗄️ Data Model / 数据模型

<div align="center">

```
┌──────────┐ 1:N  ┌──────────────┐ 1:N  ┌────────────┐ 1:1  ┌─────────┐
│  User     │─────>│ ExpenseReport ├──────>│ ExpenseItem ├───┤ Invoice │
│  用户     │      │  报销单       │       │  费用明细    │     │ 发票    │
└──────────┘      └──────┬───────┘       └────────────┘     └─────────┘
                        │ 1:N
                        ▼
                 ┌──────────────┐
                 │ApprovalRecord│
                 │  审批记录     │
                 └──────────────┘

ExpenseCategory ←── N:1 ── ExpenseItem      （费用类别）
ApprovalRule → （按金额区间 + 费用类别匹配规则，不直接关联）
```

</div>

---

## 📖 Documentation / 文档

| Docs / 文档 | Content / 内容 |
|-----|------|
| [📄 系统需求设计 System Design](docs/2026-07-06-sse-design.md) | 完整功能说明、数据模型、API 定义、MCP 接口 Schema |
| [📄 部署文档 Deployment](docs/2026-07-06-sse-deployment.md) | 逐步安装指南、Docker 配置、AI/OCR 部署 |
| [📄 审批流设计器 Workflow Designer](docs/2026-07-07-workflow-organisation-design.md) | 可视化拖拽审批流配置、组织人员管理 |
| [📄 实体关系与权限矩阵 ER & Permission Matrix](docs/2026-07-07-er-permission-matrix.md) | 实体关系图、RBAC 数据范围规则、权限矩阵 |

---

## 📚 License / 许可

MIT
