# 报销系统 (SSE) — 需求设计文档

> 日期：2026-07-06 | 版本：v2.3 | 状态：已同步实现
>
> **v1.0 → v2.0 变更记录：** 发票存储从 PostgreSQL BYTEA 迁移至对象存储（§2.4, §3.2, §7）；新增 SMS/邮件提醒与升级机制，含 NotificationLog 表和 notifications/ 包（§3.2, §4.4）；新增完整 MCP 工具 Schema、分页、错误约定、限流、版本化（§6）；新增上传校验细则（§7.3）；MCP 认证与用户 JWT 解耦（§5.3, §6.4）。
>
> **v2.1 → v2.2 变更记录：** §4 审批引擎重写以反映实际实现——补全提交/审批/驳回的完整 API 流程（§4.3）、审批人角色/UUID 双语义解析规则（§4.4）、两阶段提醒逻辑（§4.5）；标注设计 vs 实现的 24h 硬编码与 escalate_to 未消费差距。
>
> **v2.2 → v2.3 变更记录：** 新增 §4.6 最简审批流程——兜底规则（零优先级全范围规则）+ 同人检测降级机制，解决小公司一人多角色重复审批问题。新增 §8.1 报销详情页按角色拆分：提交者视图（编辑/提交）、审批者视图（审批/驳回），管理员拥有全部权限并支持级联删除审批记录。

---

## 1. 项目概述

**SSE (Smart Staff Expense)** 是一套面向小微团队（5-20人）的智能报销管理系统。支持差旅+日常费用报销、可配置审批流、发票 OCR 识别、Excel 报表导出，并提供 MCP 接口供 AI Agent 查询数据。

### 1.1 目标用户

- 普通员工：提交报销、查看个人记录
- 部门审批人：审批本部门报销申请
- 财务人员：复核打款、查看全公司数据
- 系统管理员：用户管理、规则配置

### 1.2 核心能力

| 能力 | 说明 |
|------|------|
| 费用类型 | 交通、住宿、餐饮、招待、办公用品、通讯、培训等 |
| 审批流程 | 按金额区间 + 费用类型自动匹配审批链，规则可配置 |
| 发票处理 | 支持 PDF/OFD 上传，原件存对象存储，DB 仅存引用；OCR 自动识别 |
| 查询导出 | 多维度筛选统计，图表展示，Excel 导出 |
| MCP 接口 | 6 个只读查询工具，AI Agent 可调用，完整 Schema + 分页 + 限流 |
| 数据中台对接 | 预留标准 API 网关、Webhook 推送、UUID 标识符 |

---

## 2. 系统架构

### 2.1 模块解耦设计（六边形架构）

采用 **Ports & Adapters（端口-适配器）** 模式，核心业务逻辑与基础设施完全解耦：

```
                        ┌──────────────────────┐
                        │      前端 (web/)       │
                        │   Vue 3 SPA · 响应式   │
                        └──────────┬───────────┘
                                   │ HTTP REST
              ┌────────────────────┼────────────────────┐
              │                    ▼                    │
              │  ┌─────────────────────────────────┐   │
              │  │         适配器层 (Adapters)       │   │
              │  │  ┌──────────┐  ┌──────────┐     │   │
              │  │  │  api/    │  │  mcp/    │     │   │
              │  │  │ Express  │  │ JSON-RPC │     │   │
              │  │  └────┬─────┘  └────┬─────┘     │   │
              │  │       │              │           │   │
              │  │  ┌────┴─────┐  ┌────┴─────┐     │   │
              │  │  │  db/     │  │  ocr/    │     │   │
              │  │  │ Postgres │  │ 发票识别  │     │   │
              │  │  └────┬─────┘  └────┬─────┘     │   │
              │  │       │              │           │   │
              │  └───────┼──────────────┼───────────┘   │
              │          │              │               │
              │          ▼              ▼               │
              │  ┌─────────────────────────────────┐   │
              │  │       端口接口层 (Ports)          │   │
              │  │   定义在 core/ 中的接口契约       │   │
              │  │   IExpenseRepo · IApprovalEngine │   │
              │  │   IOcrService · IExportService   │   │
              │  │   INotificationService           │   │
              │  └──────────────┬──────────────────┘   │
              │                 │                      │
              │                 ▼                      │
              │  ┌─────────────────────────────────┐   │
              │  │         领域核心 (core/)         │   │
              │  │    · 实体定义 (Entity)           │   │
              │  │    · 业务规则 (Domain Service)    │   │
              │  │    · 审批引擎                     │   │
              │  │    · 零框架依赖                    │   │
              │  └─────────────────────────────────┘   │
              └────────────────────────────────────────┘
```

**解耦收益：** 换掉 Express 不影响业务逻辑、OCR 可独立升级、不同会话可分别在独立模块上工作、单元测试不依赖数据库。

### 2.2 模块依赖关系

```
shared/ (纯类型定义，无依赖)
  ↑
  ├── core/ (领域核心，仅依赖 shared)
  │     ↑
  │     ├── db/ (仓储实现，实现 core 定义的接口)
  │     ├── auth/ (认证实现)
  │     ├── ocr/ (OCR 实现，实现 core 定义的 IOcrService)
  │     ├── notifications/ (实现 core 定义的 INotificationService)
  │     ├── api/ (REST 适配器)
  │     └── mcp/ (MCP 适配器)
  │
  └── web/ (前端，仅依赖 shared 类型)
```

### 2.3 项目目录结构

```
sse/
├── packages/
│   ├── shared/          # 共享类型、枚举、DTO 定义
│   │   └── src/
│   │       ├── types/       # ExpenseReport, User 等接口类型
│   │       ├── enums/       # ReportStatus, UserRole 等枚举
│   │       └── dto/         # 请求/响应 DTO 类型
│   │
│   ├── core/            # 领域核心 — 零框架依赖
│   │   └── src/
│   │       ├── entities/    # 实体类（User, ExpenseReport...）
│   │       ├── ports/       # 接口定义（IExpenseRepo, IApprovalEngine...）
│   │       ├── services/    # 领域服务（ApprovalEngine, ReportService...）
│   │       └── __tests__/
│   │
│   ├── db/              # 数据库实现
│   │   └── src/
│   │       ├── migrations/   # 迁移脚本
│   │       ├── repositories/ # 仓储实现（PgExpenseRepo...）
│   │       └── connection.ts # 连接池
│   │
│   ├── auth/            # 认证授权
│   │   └── src/
│   │       ├── jwt.ts        # JWT 签发/验证
│   │       ├── middleware.ts  # 认证中间件
│   │       └── rbac.ts       # 权限判断
│   │
│   ├── api/             # REST API
│   │   └── src/
│   │       ├── routes/       # 路由定义
│   │       ├── controllers/  # 控制器（薄层，调用 core service）
│   │       ├── middleware/   # 校验、错误处理
│   │       └── openapi.ts    # Swagger 文档生成
│   │
│   ├── mcp/             # MCP Server
│   │   └── src/
│   │       ├── server.ts     # MCP 服务启动
│   │       ├── tools/        # 6 个工具实现
│   │       └── index.ts
│   │
│   ├── ocr/             # OCR 发票识别
│   │   └── src/
│   │       ├── parser.ts     # 统一解析入口
│   │       ├── pdf.ts        # PDF OCR 处理
│   │       ├── ofd.ts        # OFD XML 解析
│   │       └── providers/    # 第三方 OCR API 适配
│   │
│   ├── notifications/   # SMS / 邮件发送
│   │   └── src/
│   │       ├── channels/
│   │       │   ├── sms.ts        # SMS 服务商适配
│   │       │   └── email.ts      # 邮件服务商适配
│   │       ├── templates/        # 提醒/升级消息模板
│   │       └── scheduler.ts      # 定时扫描超时审批步骤
│   │
│   └── web/             # 前端 SPA
│       └── src/
│           ├── pages/        # 10 个页面
│           ├── components/   # 共享组件
│           ├── api/          # API 调用封装
│           ├── router/       # 路由配置
│           └── store/        # 状态管理
│
├── docs/                # 文档
├── docker-compose.yml   # 本地开发环境
└── package.json         # monorepo 根配置
```

### 2.4 技术栈

| 层 | 推荐方案 | 备选 |
|----|----------|------|
| 前端 | Vue 3 + Element Plus | React + Ant Design |
| 后端 | Node.js + TypeScript | Python FastAPI |
| 数据库 | PostgreSQL | MySQL 8.0 |
| 文件存储 | MinIO / S3（或 S3 兼容存储） | PostgreSQL BYTEA（仅小规模，不推荐） |
| 通知 | SMS 服务商（如阿里云短信/Twilio）+ 邮件（SMTP/SendGrid/SES） | — |
| OCR | PaddleOCR 私有部署 | 百度OCR / 腾讯OCR API |
| MCP | @modelcontextprotocol/sdk | 自定义 JSON-RPC |
| 认证 | JWT + RBAC | — |
| 包管理 | pnpm workspace (monorepo) | npm workspaces |

---

## 3. 核心数据模型

### 3.1 实体关系

```
User ──1:N──> ExpenseReport ──1:N──> ExpenseItem ──1:1──> Invoice
                    │
                    └──1:N──> ApprovalRecord

ExpenseCategory <──N:1── ExpenseItem

ApprovalRule（独立配置表，不直接关联报销单）
```

### 3.2 核心表结构

#### User（用户）

| 字段 | 类型 | 说明 |
|------|------|------|
| id | UUID | 主键 |
| name | VARCHAR(50) | 姓名 |
| phone | VARCHAR(20) | 手机号（SMS 提醒） |
| email | VARCHAR(100) | 邮箱地址，可为空（邮件提醒） |
| department | VARCHAR(50) | 部门 |
| role | ENUM | 员工 / 部门审批人 / 财务 / 管理员 |
| parent_id | UUID | 直属上级 |
| status | ENUM | 启用 / 禁用 |
| created_at / updated_at | TIMESTAMPTZ | 时间戳 |

#### ExpenseCategory（费用类别）

| 字段 | 类型 | 说明 |
|------|------|------|
| id | UUID | 主键 |
| name | VARCHAR(50) | 类别名称 |
| parent_id | UUID | 上级分类，支持两级 |
| sort_order | INT | 排序 |

默认分类：交通、住宿、餐饮、招待、办公用品、通讯、培训、其他

#### ExpenseReport（报销单）

| 字段 | 类型 | 说明 |
|------|------|------|
| id | UUID | 主键 |
| serial_no | VARCHAR(30) | 编号，如 RE-20260706-001 |
| user_id | UUID | 申请人 |
| title | VARCHAR(200) | 报销标题 |
| total_amount | DECIMAL(12,2) | 总金额（冗余计算） |
| status | ENUM | 草稿/待审批/已通过/已驳回/已打款 |
| current_step | INT | 当前审批步骤序号 |
| submitted_at | TIMESTAMPTZ | 提交时间 |
| completed_at | TIMESTAMPTZ | 完成时间 |
| created_at / updated_at | TIMESTAMPTZ | 时间戳 |

#### ExpenseItem（费用明细）

| 字段 | 类型 | 说明 |
|------|------|------|
| id | UUID | 主键 |
| report_id | UUID | 所属报销单 |
| category_id | UUID | 费用类别 |
| amount | DECIMAL(10,2) | 金额 |
| expense_date | DATE | 发生日期 |
| description | VARCHAR(500) | 费用说明 |

#### Invoice（发票）

| 字段 | 类型 | 说明 |
|------|------|------|
| id | UUID | 主键 |
| item_id | UUID | 关联费用明细 |
| file_name | VARCHAR(200) | 原始文件名 |
| file_format | ENUM | PDF / OFD |
| file_size | INT | 文件大小（字节） |
| storage_key | VARCHAR(255) | 对象存储路径，如 `invoices/2026/07/{uuid}.pdf` |
| storage_bucket | VARCHAR(100) | 存储桶名称（后续支持多桶/多区域） |
| checksum | VARCHAR(64) | 文件 SHA-256，用于完整性校验和去重 |
| ocr_result | JSONB | OCR 解析结果 |
| uploaded_at | TIMESTAMPTZ | 上传时间 |

> **存储说明：** 原始文件存储于对象存储（MinIO/S3），不存入 Postgres。数据库仅保存引用（`storage_bucket` + `storage_key`）和元数据。这样数据库保持轻量、备份快速；对象存储独立管理文件字节、版本和生命周期策略。

**OCR JSONB 结构示例：**
```json
{
  "invoice_no": "12345678",
  "amount": 1500.00,
  "tax_amount": 45.00,
  "total_amount": 1545.00,
  "invoice_date": "2026-07-01",
  "seller_name": "XX科技有限公司",
  "buyer_name": "XX公司",
  "status": "verified"
}
```

#### ApprovalRule（审批规则）

| 字段 | 类型 | 说明 |
|------|------|------|
| id | UUID | 主键 |
| name | VARCHAR(100) | 规则名称 |
| min_amount | DECIMAL(12,2) | 金额下限（含） |
| max_amount | DECIMAL(12,2) | 金额上限（不含） |
| category_ids | UUID[] | 适用费用类别，为空表示全部 |
| approval_chain | JSONB | 审批链配置 |
| priority | INT | 优先级，数字小=高 |
| is_active | BOOLEAN | 启用 |

**approval_chain JSONB 示例：**
```json
[
  {
    "step": 1,
    "role": "dept_approver",
    "label": "部门审批人",
    "reminder_after_hours": 48,
    "escalate_after_hours": 96,
    "escalate_to": "parent_of_approver"
  },
  {
    "step": 2,
    "role": "finance",
    "label": "财务复核",
    "reminder_after_hours": 48,
    "escalate_after_hours": 96,
    "escalate_to": "admin"
  }
]
```

`escalate_to` 可填 `"parent_of_approver"`（使用审批人的 `User.parent_id`）或固定角色名（如 `"admin"`）。每步两个字段均为可选，省略则禁用该步的升级功能，仅保留提醒。

#### ApprovalRecord（审批记录）

| 字段 | 类型 | 说明 |
|------|------|------|
| id | UUID | 主键 |
| report_id | UUID | 报销单 |
| step | INT | 步骤序号 |
| approver_id | UUID | 审批人 |
| step_started_at | TIMESTAMPTZ | 该步骤变为活跃的时间；提醒/升级计时基准 |
| result | ENUM | 通过 / 驳回 / 待审批 |
| comment | VARCHAR(500) | 审批意见 |
| approved_at | TIMESTAMPTZ | 审批时间 |
| reminder_sent_at | TIMESTAMPTZ | 可为空；首次提醒发送后设置，防止重复发送 |
| escalated_at | TIMESTAMPTZ | 可为空；超时升级触发后设置 |

#### NotificationLog（通知日志）

支撑提醒/升级功能（§4.4）和通知中心页面（§8，第 10 页）。

| 字段 | 类型 | 说明 |
|------|------|------|
| id | UUID | 主键 |
| report_id | UUID | 关联报销单 |
| recipient_id | UUID | 接收通知的用户 |
| channel | ENUM | sms / email |
| trigger_type | ENUM | approval_reminder / escalation / rejected / paid |
| status | ENUM | sent / failed / pending |
| sent_at | TIMESTAMPTZ | 发送时间 |
| error_message | VARCHAR(500) | 服务商返回的错误信息，发送失败时记录 |

### 3.3 索引策略

- `ExpenseReport(user_id, status)` — 用户报销列表查询
- `ExpenseReport(status, current_step)` — 待审批查询
- `ExpenseReport(submitted_at)` — 按时间统计
- `ApprovalRecord(report_id, step)` — 审批流转查询
- `ApprovalRecord(approver_id, result)` — 审批人待办
- `NotificationLog(report_id)` — 按报销单查通知历史
- `NotificationLog(recipient_id, sent_at)` — 用户通知历史，按时间排序
- `ApprovalRecord(result, step_started_at)` — 调度器扫描超时待审批步骤

---

## 4. 审批引擎

### 4.1 规则匹配逻辑

1. 用户提交报销单，计算总金额
2. 筛选 `is_active=true` 且金额落在 `[min_amount, max_amount)` 的规则
3. 若有类别限定，进一步匹配报销单中的费用类别
4. 按 `priority` 升序排列，取第一条匹配的规则
5. 按规则的 `approval_chain` 依次执行审批

### 4.2 状态流转

```
草稿 ──提交──> 待审批 ──全部通过──> 已通过 ──打款──> 已打款
  ^               │
  │               ├──驳回──> 已驳回 ──修改重提──> 草稿
  │               │
  └───保存草稿─────┘
```

### 4.3 审批流程

**提交阶段**（`api/routes/expenses.ts — POST /:id/submit`）：

1. 校验用户身份（仅草稿、仅本人）
2. 聚合 `expense_items` 的金额和类别
3. 调用 `ApprovalEngine.matchRule(totalAmount, categoryIds)` 匹配审批规则
4. 若有匹配规则且审批链首步有效，调用 `startApproval()` 创建第一条 `ApprovalRecord`（`result=pending`）
5. 更新报表：`status=pending, current_step=1, submitted_at=NOW()`

**审批阶段**（`api/routes/approvals.ts`）：

- **通过（`POST /approvals/:reportId/approve`）**：
  1. 查找当前步骤的 pending 记录（匹配审批人角色），调用 `approveStep(PENDING→APPROVED)`
  2. 重新运行 `matchRule()` 获取最新规则（规则变更即时生效）
  3. 判断是否末步——不是则 `createNextStep()` 推进到 `current_step+1`，是则报表变更为 `APPROVED`
  4. 若未匹配到规则，或 `createNextStep()` 返回 null，直接变更为 `APPROVED`

- **驳回（`POST /approvals/:reportId/reject`）**：
  1. 要求填写驳回原因（非空 `comment`）
  2. 查找匹配的 pending 记录，调用 `approveStep(PENDING→REJECTED)`
  3. 报表变更为 `REJECTED`，不创建后续步骤，不清除已有步骤
  4. 申请人可修改报销单后重新提交，从步骤 1 重新开始

- **并发控制**：当前无乐观锁或分布式锁，依赖 PostgreSQL 行级锁。同一报表被多人同时审批存在竞态风险。

- **规则变更对在途审批的影响**：每次审批操作都重新运行 `matchRule()`，若审批链配置在审批中途被修改，后续步骤会按新规则匹配，可能导致行为不一致。

### 4.4 审批人解析

`ApprovalRecord.approver_id` 字段承载两种语义：

| 值类型 | 示例 | 解析方式 |
|--------|------|---------|
| 角色字符串 | `"dept_approver"`, `"finance"` | 查询同部门内该角色的所有活跃用户 |
| UUID | `"550e8400-..."` | 直接查找该用户 |

运行时通过正则 `/^[0-9a-f-]{36}$/i` 区分。通知调度器按角色解析时，向该部门该角色的**所有**在职用户发送提醒。

### 4.5 提醒与升级

调度器（`notifications/src/scheduler.ts`）随 API 服务启动，每 15 分钟执行一次：

1. 查询 `approval_records.result = 'pending' AND step_started_at < NOW() - 24小时`，JOIN 确认关联规则仍为激活状态
2. **两阶段判断**：
   - `reminder_sent_at` 为空 → 发送**提醒**（SMS + 邮件），设置 `reminder_sent_at`
   - `reminder_sent_at` 已有值 → 发送**升级催办**（SMS + 邮件），设置 `escalated_at`
3. 通知对象：按 §4.4 的审批人解析规则查找，向所有匹配的审批人发送
4. 每次发送（成功或失败）均记录到 `NotificationLog`，确保不重复发送
5. 发送失败不重试、不阻塞调度器继续处理其他记录

> **设计 vs 实现差距**：当前实现硬编码 24 小时阈值，未消费 `ApprovalChainStep.reminderAfterHours` / `escalateAfterHours`（按步骤可配置的时间窗口）；也未消费 `escalate_to` 字段（升级目标解析）。这些字段在类型定义和数据模型中已预留，调度器需后续对齐。

### 4.6 最简审批流程（兜底规则）

小公司一人常担任多角色（如同时是部门审批人和财务），常规审批链 `dept_approver → finance` 会导致同一人对同一报销单审批两次。系统通过**兜底规则 + 同人检测降级**解决：

**兜底规则**：一条 `priority=9999`、全金额范围（`[0, 99999999)`）、不限类别的极低优先级规则，审批链为单步指定人。`matchRule()` 无改动——前面规则均不匹配时，此规则自然返回。

**同人检测降级**：提交报销时（`POST /expenses/:id/submit`），在 `matchRule()` 返回规则后，解析每步审批链的实际审批人集合：

1. 角色步骤 → `userRepo.findByRole(role, department)`
2. 指定人步骤 → `userRepo.findById(assigneeId)`
3. 对比各步骤审批人集合，若全指向同一人或部分重叠 → 合并为一步
4. 降级后向所有管理员发送通知
5. 后续审批推进参照实际创建的有效步骤而非原始规则审批链，避免步数错位

> 详细设计见 `docs/2026-07-28-fallback-approval-design.md`。

---

## 5. 权限设计 (RBAC)

### 5.1 角色定义

| 角色 | 权限概述 |
|------|----------|
| 员工 | 提交报销、查看自己的记录、查看审批进度 |
| 部门审批人 | 审批本部门员工的报销、查看本部门数据 |
| 财务 | 复核打款、查看全公司数据、导出报表 |
| 管理员 | 用户管理、角色分配、费用类别维护、审批规则配置 |

### 5.2 数据范围隔离

| 角色 | 数据可见范围 |
|------|-------------|
| 员工 | 仅自己的报销单 |
| 部门审批人 | 本部门所有员工的报销单 |
| 财务、管理员 | 全公司所有报销单 |

### 5.3 认证方式

- JWT Token 认证，登录后获取
- Token 有效期：2 小时，支持 Refresh Token 续期
- **MCP 接口使用独立的长效 API Key（非 2 小时用户 JWT）** — 见 §6.4。要求 AI Agent 每 2 小时重新登录不切实际，因此 MCP 认证刻意与 Web 会话模型解耦。

---

## 6. MCP 查询接口

### 6.1 架构说明

MCP Server 作为独立进程运行，与 REST API 共享业务逻辑层和数据访问层，仅开放只读查询能力。工具名称通过 MCP 服务器声明的协议/工具版本隐式版本化（§6.5）——破坏性的参数或结构变更需发布新的次级工具版本，而非静默修改已有工具的契约。

### 6.2 通用约定

以下约定适用于所有工具，在此统一声明，不再逐工具重复：

- **分页**：返回列表的工具均接受 `page`（默认 `1`）和 `page_size`（默认 `20`，最大 `100`）。响应中包含 `pagination` 对象：`{ "page": 1, "page_size": 20, "total": 143, "has_more": true }`。
- **错误**：所有工具以统一结构返回错误，不抛原始异常：
  ```json
  { "error": { "code": "NOT_FOUND", "message": "报销单不存在或无权访问" } }
  ```
  标准 `code` 值：`NOT_FOUND`（ID 不存在，或存在但超出调用者数据范围——故意不区分，避免泄露范围外记录的存在性）、`INVALID_PARAMS`、`UNAUTHORIZED`（密钥错误/过期）、`RATE_LIMITED`、`INTERNAL_ERROR`。
- **范围过滤**：所有结果集在分页前按调用者角色/部门范围无声过滤——Agent 不会看到包含范围外记录的 total 总数。
- **日期格式**：所有时间戳为 ISO-8601 UTC 格式；纯日期参数使用 `YYYY-MM-DD`。

### 6.3 工具列表与 Schema

#### `search_expenses` — 多条件搜索报销单

参数：`date_from`, `date_to` (YYYY-MM-DD), `applicant_id` (UUID, 可选), `status` (枚举, 可选), `category_id` (UUID, 可选), `amount_min`, `amount_max` (小数, 可选), `keyword` (字符串, 可选, 匹配标题), `page`, `page_size`。

```json
{
  "results": [
    {
      "report_id": "uuid",
      "serial_no": "RE-20260706-001",
      "title": "Q2客户拜访",
      "applicant_name": "张三",
      "total_amount": 1545.00,
      "status": "pending",
      "submitted_at": "2026-07-01T09:00:00Z"
    }
  ],
  "pagination": { "page": 1, "page_size": 20, "total": 143, "has_more": true }
}
```

#### `get_expense_detail` — 查看报销单详情

参数：`report_id` (UUID, 必填)。

```json
{
  "report_id": "uuid",
  "serial_no": "RE-20260706-001",
  "title": "Q2客户拜访",
  "status": "pending",
  "total_amount": 1545.00,
  "items": [
    { "item_id": "uuid", "category": "交通", "amount": 1545.00, "expense_date": "2026-07-01", "description": "..." }
  ],
  "invoices": [
    { "invoice_id": "uuid", "file_name": "invoice.pdf", "ocr_result": { "invoice_no": "12345678", "amount": 1500.00 } }
  ],
  "approval_records": [
    { "step": 1, "approver_name": "李四", "result": "approved", "approved_at": "2026-07-02T10:00:00Z" }
  ]
}
```

无 `pagination` 对象——此为单条记录查询。

#### `get_approval_status` — 查看审批进度

参数：`report_id` (UUID, 必填)。

```json
{
  "report_id": "uuid",
  "status": "pending",
  "current_step": 2,
  "total_steps": 2,
  "history": [
    { "step": 1, "role": "dept_approver", "approver_name": "李四", "result": "approved", "approved_at": "2026-07-02T10:00:00Z" },
    { "step": 2, "role": "finance", "approver_name": null, "result": "pending", "approved_at": null }
  ]
}
```

#### `get_statistics` — 汇总统计

参数：`date_from`, `date_to`, `department` (可选)。

```json
{
  "total_amount": 128450.00,
  "report_count": 87,
  "by_category": [ { "category": "交通", "amount": 45200.00, "percentage": 35.2 } ],
  "by_department": [ { "department": "研发部", "amount": 62000.00 } ],
  "average_per_report": 1476.44
}
```

#### `get_user_summary` — 个人费用概览

参数：`user_id` (UUID, 必填), `date_from`, `date_to` (可选)。

```json
{
  "user_id": "uuid",
  "report_count": 12,
  "total_amount": 15200.00,
  "by_category": [ { "category": "餐饮", "amount": 3200.00 } ]
}
```

#### `list_pending_approvals` — 待审批列表

参数：`approver_id` (UUID, 必填), `page`, `page_size`。

```json
{
  "results": [
    { "report_id": "uuid", "serial_no": "RE-20260706-001", "applicant_name": "张三", "total_amount": 1545.00, "step_started_at": "2026-07-01T09:00:00Z" }
  ],
  "pagination": { "page": 1, "page_size": 20, "total": 4, "has_more": false }
}
```

### 6.4 认证与限流

- 每个调用 Agent/集成使用独立的**长效 MCP API Key**，与用户登录 JWT 分离（§5.3）——可按 Agent 独立吊销，不影响人类用户。
- 每个 Key 绑定一个特定用户身份用于范围过滤（Agent 以某人身份操作，继承该人的角色/部门可见性——绝不获得超出绑定用户的访问权限）。
- 限流：默认 **每分钟 60 次/Key**，超限返回 `RATE_LIMITED` 错误并附带 `retry_after_seconds` 字段。高吞吐集成可按 Key 上调限额。

### 6.5 版本化

- MCP Server 在握手/元数据中声明 `server_version`。
- 添加新的可选参数或响应字段为非破坏性（修补）变更。
- 重命名工具、删除/重命名字段、或变更字段类型为破坏性变更——以新工具名发布（如 `search_expenses_v2`），旧版并行保留一段废弃过渡期，与 REST `/api/v1/` 约定（§9）保持一致。

### 6.6 安全约束

- 所有查询结果按调用者角色和部门范围过滤（§6.2）
- 仅提供只读查询，不开放提交、审批、修改等写操作
- 每次调用验证 API Key 有效性；无效/已吊销的 Key 返回 `UNAUTHORIZED`

---

## 7. 发票 OCR 处理

### 7.1 处理流程

```
上传 PDF/OFD → 大小 + MIME 嗅探校验 → 格式校验 → 类型判断
                                                     ├── PDF → OCR API 识别
                                                     └── OFD → XML 结构化解析
                                                               ↓
                                              原件上传至对象存储 (MinIO/S3)
                                              storage_key + checksum 写入 Invoice 表
                                              OCR 结果存入 JSONB
                                                               ↓
                                              返回识别结果给前端
                                              ← 用户确认/修正
```

### 7.2 OFD vs PDF

| | PDF 发票 | OFD 发票 |
|------|----------|----------|
| 提取方式 | OCR 图文识别 | XML 结构化解析 |
| 准确率 | 依赖 OCR 质量 | 接近 100% |
| 处理速度 | 较慢 | 快 |
| 国标 | 非国标格式 | 中国电子发票国标 (GB/T 33190) |

### 7.3 上传校验

- **最大文件大小**：单张发票 10 MB（可配置）。
- **MIME 嗅探，不依赖扩展名**：校验实际文件签名/魔数，而非仅检查 `.pdf`/`.ofd` 扩展名——防止重命名绕过类型检查。
- **校验和**：上传时计算 SHA-256，存入 `Invoice` 表（§3.2）；用于完整性校验和检测同一发票的重复上传。
- **存储隔离**：上传文件写入对象存储的非可执行、非 Web 直连路径/桶——不提供公开直链 URL；访问通过 API 代理（签名/短时效 URL 或认证流），确保存储桶本身不可公开列举和直接访问。

---

## 8. 页面结构

| 序号 | 页面 | 功能描述 |
|------|------|----------|
| 1 | 登录 | 账号密码登录，JWT 认证 |
| 2 | 工作台首页 | 待办事项、统计卡片、快捷入口、通知中心 |
| 3 | 报销列表 | 筛选搜索、状态标签、分页 |
| 4 | 新建/编辑报销单 | 表单填写、费用明细动态添加、发票上传 |
| 5 | 报销单详情 | 明细展示、发票预览、审批时间线 |
| 6 | 审批处理 | 待审批列表、逐一/批量审批、意见填写 |
| 7 | 统计报表 | 图表展示、多维筛选、Excel 导出 |
| 8 | 个人中心 | 个人信息、我的报销汇总、修改密码 |
| 9 | 系统管理 | 用户管理、角色分配、费用类别、审批规则配置 |
| 10 | 通知中心 | 站内消息、审批提醒、驳回/打款通知 |

---

## 9. 数据中台对接预留

### 9.1 设计原则

- **全 UUID 主键**：不依赖自增 ID，跨系统唯一标识
- **时间戳追踪**：所有记录含 `created_at` / `updated_at`，支持增量同步
- **版本化 API**：`/api/v1/` 路径，后续升级不影响现有调用
- **OpenAPI 文档**：Swagger 自动生成，数据中台可直接消费

### 9.2 开放数据接口（后续阶段）

| 接口 | 说明 |
|------|------|
| `GET /api/v1/open/reports` | 分页获取报销单（支持增量时间戳过滤） |
| `GET /api/v1/open/statistics` | 聚合统计数据 |
| `POST /api/v1/webhooks/register` | 注册 Webhook 回调 |
| Webhook 事件 | `report.created` / `report.approved` / `report.paid` |

### 9.3 认证方式

- API Key (HMAC 签名)，与服务端 Token 认证隔离
- 可配置 IP 白名单

---

## 10. 非功能性需求

| 维度 | 要求 |
|------|------|
| 响应时间 | 列表查询 < 500ms，详情 < 300ms |
| 并发 | 支持 20 人同时在线 |
| 安全 | JWT 过期、XSS 防护、SQL 注入防护、文件上传类型/大小/MIME 校验 |
| 移动端 | 响应式设计，手机可完成提交和审批 |
| 数据备份 | 数据库每日自动备份；对象存储桶开启版本管理和生命周期策略 |
| 通知可靠性 | SMS/邮件发送失败记录至 NotificationLog，不阻塞审批流程推进；失败发送不无限重试（设上限，超限后标记 failed 待人工处理） |

---

## 11. 不在本期范围

- 预算管控（需另行评估）
- 对公付款 / 采购申请
- 多币种支持
- 与第三方 ERP 系统对接
- 移动端原生 App

---

> 文档位置：`E:\app\opencode\sse\docs\2026-07-06-sse-design.md`
