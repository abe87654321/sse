# SSE 本体层 — 语义编排引擎设计

> 日期：2026-07-26 | 版本：v1.0 | 状态：待评审

---

## 1. 概述

在现有报销系统之上新增本体层（`packages/ontology/`），作为与 MCP 同级的语义编排引擎。本体层通过 OWL 语义模型将报销单、组织、人员、审批规则的关系形式化，结合 LLM 和 OCR 实现"听懂人话 + 看懂发票 → 自动完成报销"。

**核心能力**：语义解析 → 实体映射 → 规则推理 → 自动执行 → NL 反馈 + 错误通知。

---

## 2. 架构定位

`packages/ontology/` 位于六边形架构的应用适配器层：

```
shared → core → db/auth/ocr/notifications → api/web/mcp/ontology
```

### 包内模块

```
packages/ontology/src/
  input-parser.ts        — 路由输入到 OCR 或 LLM
  entity-extractor.ts    — LLM 提取实体（人、金额、类别、描述）
  semantic-mapper.ts     — 实体 → 本体类/属性/个体；DB ↔ RDF 双向映射
  action-reasoner.ts     — 推理：匹配审批规则、确定类别、推导审批链
  action-executor.ts     — 调用 POST /expenses → submit → 通知
  owl-store.ts           — OWL 持久化（Turtle 文件 + RDF Store）
  nl-generator.ts        — LLM 生成自然语言解释
  index.ts
```

---

## 3. 本体数据模型

### 3.1 类层次（OWL Classes）

```
owl:Thing
  ├── sse:OrganizationUnit
  │     ├── sse:Company
  │     └── sse:Department
  ├── sse:Person
  │     └── sse:Approver
  ├── sse:Report
  │     ├── sse:DraftReport
  │     ├── sse:PendingReport
  │     └── sse:ApprovedReport
  ├── sse:ExpenseItem
  ├── sse:Invoice
  └── sse:ApprovalRule
```

### 3.2 对象属性（Object Properties）

| 属性 | Domain | Range |
|------|--------|-------|
| `sse:belongsTo` | Person | Department |
| `sse:submittedBy` | Report | Person |
| `sse:containsItem` | Report | ExpenseItem |
| `sse:hasInvoice` | ExpenseItem | Invoice |
| `sse:approvedBy` | Report | Approver |
| `sse:governedBy` | Report | ApprovalRule |
| `sse:partOf` | Department | Company |

### 3.3 数据属性（Data Properties）

| 属性 | Domain | 类型 |
|------|--------|------|
| `sse:amount` | ExpenseItem | xsd:decimal |
| `sse:reportDate` | Report | xsd:dateTime |
| `sse:status` | Report | xsd:string |

### 3.4 自然语言描述

```
员工张三（归属技术部）于 2026-07-20 提交报销单 SSE-20260720-001（金额 ¥3,850），
包含 3 个费用项：住宿费（¥2,000）、交通费（¥1,200）、餐费（¥650）。
由李四审批，适用规则"默认审批规则"。
```

---

## 4. 语义编排流程

```
外部输入（发票图片/自然语言/Agent指令）
  ↓
[1] input-parser    路由 → OCR（发票）或 LLM（文本）
  ↓ 失败 → 返回错误，无副作用
  ↓
[2] entity-extractor LLM 提取实体 { person, amount, category, description }
  ↓ 失败 → 返回错误 + 通知管理员
  ↓
[3] semantic-mapper  实体 → 本体资源 → DB 实体（user ID, category ID）
  ↓ 失败 → 返回错误 + 通知管理员
  ↓
[4] action-reasoner  匹配审批规则、确定审批链、合规校验
  ↓ 失败 → 返回错误 + 通知管理员
  ↓
[5] action-executor  POST /expenses → POST /expenses/:id/submit
  ↓ 创建失败 → DB 事务回滚，无残留
  ↓ 创建成功 + submit 失败 → 保留 draft，通知手动提交
  ↓ 全部成功 → nl-generator 生成解释
  ↓
输出 + 通知用户
```

---

## 5. 回滚与事务保护

### 5.1 原则

| 场景 | 策略 |
|------|------|
| 阶段 [1]-[3] 失败 | 纯读操作，无副作用，直接返回错误码 |
| 阶段 [4] 失败 | 纯读操作，无副作用 |
| 阶段 [5] 创建 report 失败 | DB 事务已原子回滚，无残留 |
| 阶段 [5] 创建成功 + submit 失败 | 保留 draft，标记 `partial: true`，通知用户手动提交 |
| 阶段 [5] 全部成功 | 完成，生成 NL 解释 |

### 5.2 不自动回滚 draft 的理由

草稿本身有价值——用户界面可补全信息后手动提交。宁可多一个草稿，不丢数据。

---

## 6. 错误处理与通知

### 6.1 失败场景表

| 阶段 | 错误码 | 通知对象 |
|------|--------|---------|
| input-parser | `OCR_FAILED` / `LLM_CALL_FAILED` | 当前用户 + admin |
| entity-extractor | `COULD_NOT_RESOLVE_USER` | admin |
| entity-extractor | `COULD_NOT_RESOLVE_CATEGORY` | admin |
| semantic-mapper | `MAPPING_FAILED` | admin |
| action-reasoner | `NO_RULE_MATCHED` | admin |
| action-executor | `API_CALL_FAILED` | admin |
| action-executor | `SUBMIT_FAILED` | admin（报错已创建 draft） |

### 6.2 返回格式

```typescript
interface MCPToolResponse {
  success: boolean
  data?: {
    report_id?: string
    serial_no?: string
    approval_chain?: string[]
    explanation?: string       // NL 描述
    partial?: boolean          // true=部分成功
  }
  error?: {
    step: string               // 失败阶段
    code: string               // 错误码
    detail: string             // 人类可读
    suggestion?: string        // 建议操作
  }
  notified: string[]           // 已通知对象
}
```

### 6.3 通知机制

失败时复用 `NotificationEngine.send()` → `bounce_alert` 类型 → admin + 相关用户收到"操作失败"通知。

---

## 7. MCP 工具（7 个）

| 工具 | 输入 | 说明 |
|------|------|------|
| `submit_expense_from_text` | `{ text }` | LLM 解析自然语言 → 创建报销 |
| `submit_expense_from_invoice` | `{ image: base64 }` | OCR → LLM 解析 → 创建报销 |
| `query_expense_status` | `{ query }` | 自然语言查询报销状态 |
| `explain_decision` | `{ reportId }` | 解释审批链 + 规则匹配原因 |
| `get_entity_network` | `{ entityId, depth }` | N 跳语义关系图 |
| `validate_expense` | `{ items[] }` | 合规检查 + 建议 |
| `query_ontology` | `{ sparql }` | SPARQL 查询本体 |

---

## 8. 存储与序列化

| 存储 | 格式 | 用途 |
|------|------|------|
| 文件 | `data/ontology/sse.owl` (Turtle) | 主本体文件，版本管理 |
| 内存 | `N3.Store` (RDF Store) | 运行时查询/SPARQL |
| DB | PostgreSQL JSONB `ontology_snapshot` | 缓存 + 快速同步 |
| 同步 | 每次 create/update 报销时异步写入 | 保持本体与 DB 一致 |

---

## 9. 技术选型

| 层 | 技术 | 原因 |
|----|------|------|
| RDF 解析/序列化 | `rdf-parse` + `rdf-data-factory` + `@rdfjs/types` | 最活跃的 RDF JS 生态，MIT 协议 |
| RDF Store | `N3.js Store` | 轻量、支持 Turtle/N-Triples/JSON-LD |
| 图可视化 | Cytoscape.js | 最终用户编辑本体时使用 |
| 自然语言 | Ollama LLM（复用 ai-config.json） | 免额外部署 |
| OCR | 复用 `@sse/ocr` | 已有 3 引擎支持 |

---

## 10. 文件变更清单

| 文件 | 类型 | 说明 |
|------|------|------|
| `packages/ontology/` | 新建 | 本体层包（含以上所有模块） |
| `packages/mcp/src/tools/*.ts` | 修改 | 新增 5 个 MCP 工具 |
| `packages/mcp/src/server.ts` | 修改 | 注册新工具 |
| `packages/api/src/routes/ontology.ts` | 新建 | REST 端点（如有需要） |
| `data/ontology/sse.owl` | 新建 | 初始本体文件 |
| `packages/notifications/src/notification-engine.ts` | 修改 | 支持部分成功通知 |

---

> 评审完成后进入实施计划阶段。
