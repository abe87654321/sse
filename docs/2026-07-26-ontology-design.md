# SSE 本体层 — 语义编排引擎设计

> 日期：2026-07-26 | 版本：v1.3 | 状态：已实现
>
> **v1.2 → v1.3 变更记录：** 可视化风格改为浅色粉彩系 + 形状匹配图例 + box 扁矩形 ExpenseItem + 阴影增强（§12）、构建拆分 vis-network 独立 chunk（§15）、Report 子类型颜色统一、节点标签从属性读取有意义名称。

---

## 1. 概述

在现有报销系统之上新增本体层（`packages/ontology/`），作为与 MCP 同级的语义编排引擎。本体层通过 OWL 语义模型将报销单、组织、人员、审批规则的关系形式化，结合 LLM 和 OCR 实现"听懂人话 + 看懂发票 → 自动完成报销"。

**核心能力**：语义解析 → 实体映射 → 规则推理 → 自动执行 → NL 反馈 + 错误通知。扩展支持 NL → 知识图谱生成和 Cytoscape.js 交互式可视化编辑。

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

## 7. MCP 工具（7 个，已全部注册）

| 工具 | 输入 | 说明 | 状态 |
|------|------|------|------|
| `submit_expense_from_text` | `{ text }` | LLM 解析自然语言 → 创建报销 | ✅ |
| `submit_expense_from_invoice` | `{ image_base64, file_format }` | 发票 base64 → OCR → 创建报销 | ✅ |
| `query_expense_status` | `{ query }` | 自然语言查询报销状态 + NL 总结 | ✅ |
| `explain_decision` | `{ report_id }` | 解释审批链 + 规则匹配原因 + 全程历史 | ✅ |
| `get_entity_network` | `{ entity_id, depth }` | N 跳语义关系图（BFS 展开） | ✅ |
| `validate_expense` | `{ amount, category_id?, category_name? }` | 合规检查：规则匹配 + 审批人就绪 + 建议 | ✅ |
| `query_ontology` | `{ type? }` | 图谱查询：全图/按类型过滤 + 统计概览 | ✅ |

工具遵循现有 MCP 模式（`ToolDefinition` + `handler`），统一使用 `resolveAuthContext` 认证和 `errorResult`/`successResult` 响应格式。

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

| 层 | 技术 | 原因 | 状态 |
|----|------|------|------|
| RDF 解析/序列化 | `rdf-parse` + `rdf-data-factory` + `@rdfjs/types` | 最活跃的 RDF JS 生态，MIT 协议 | ✅ |
| RDF Store | `N3.js Store` | 轻量、支持 Turtle/N-Triples/JSON-LD | ✅ |
| 图可视化 | Cytoscape.js | 交互式图谱编辑（缩放/拖拽/NL生成/属性面板） | ✅ |
| 自然语言 | Ollama LLM（复用 ai-config.json） | 免额外部署 | ✅ |
| OCR | 复用 `@sse/ocr` | 已有 3 引擎支持 | ✅ |

---

## 10. 文件变更清单

| 文件 | 类型 | 说明 | 状态 |
|------|------|------|------|
| `packages/ontology/` | 新建 | 本体层包（含以上所有模块） | ✅ |
| `packages/mcp/src/tools/submit-expense-from-text.ts` | 新建 | NL → 报销 MCP 工具 | ✅ |
| `packages/mcp/src/tools/submit-expense-from-invoice.ts` | 新建 | 发票 → 报销 MCP 工具 | ✅ |
| `packages/mcp/src/tools/query-expense-status.ts` | 新建 | NL 查询 MCP 工具 | ✅ |
| `packages/mcp/src/tools/explain-decision.ts` | 新建 | 审批解释 MCP 工具 | ✅ |
| `packages/mcp/src/tools/get-entity-network.ts` | 新建 | 关系网络 MCP 工具 | ✅ |
| `packages/mcp/src/tools/validate-expense.ts` | 新建 | 合规检查 MCP 工具 | ✅ |
| `packages/mcp/src/tools/query-ontology.ts` | 新建 | 图谱查询 MCP 工具 | ✅ |
| `packages/mcp/src/server.ts` | 修改 | 注册 7 个新工具（共 13 个） | ✅ |
| `packages/api/src/routes/ontology.ts` | 新建 | REST 端点（9 个） | ✅ |
| `packages/web/src/pages/Ontology.vue` | 新建 | Cytoscape.js 可视化页面 | ✅ |
| `packages/web/src/router/index.ts` | 修改 | 新增 `/ontology` 路由 | ✅ |
| `packages/web/src/layouts/DefaultLayout.vue` | 修改 | 侧边栏新增"本体可视化"菜单 | ✅ |
| `packages/ontology/src/owl-store.ts` | 修改 | 新增 getGraph/addRelation/deleteEntity/deleteRelation/clear | ✅ |
| `packages/ontology/src/entity-extractor.ts` | 修改 | 新增 extractGraph NL→图谱方法 | ✅ |
| `packages/ontology/src/types.ts` | 修改 | 新增 GraphExtraction 接口 | ✅ |
| `data/ontology/sse.owl` | 新建 | 初始本体文件 | 待创建 |

---

## 13. 合规校验（v1.2 新增）

`OwlStore.validateGraph()` 在每次写操作后自动执行，检查：

| 检查项 | 说明 |
|--------|------|
| 关系来源存在性 | 每个 Relation 的 from/to 必须对应已存在的实体 |
| 孤立节点 | 没有任何关系连接的实体标记为可疑 |
| Person 缺少部门 | 人员类型实体必须有 belongsTo 关系 |

校验结果以 `warnings` 数组返回给前端，以黄色警告面板展示。

---

## 14. 混合持久化（v1.2 新增）

```
写操作 → 内存 OwlStore → saveToTurtle("data/ontology/sse.owl") ┐
                       → saveToDb() (ontology_snapshots 表)   │
                                                               │
API 启动 → loadFromDb() 恢复 ──→ loadFromTurtle() 恢复 ───────┘
```

| 存储 | 格式 | 用途 |
|------|------|------|
| Turtle 文件 | `data/ontology/sse.owl` | 版本管理、可编辑 |
| DB JSONB | `ontology_snapshots` 表 | 恢复速度快、多实例共享 |

---

## 15. 文件变更清单（累计）

| 文件 | 类型 | 说明 | 状态 |
|------|------|------|------|
| `packages/ontology/` | 新建 | 本体层包 | ✅ |
| `packages/mcp/src/tools/submit-expense-from-text.ts` 等 7 文件 | 新建 | MCP 工具 | ✅ |
| `packages/api/src/routes/ontology.ts` | 新建 | REST 端点（9 个） | ✅ |
| `packages/web/src/pages/Ontology.vue` | 新建 | vis-network 可视化页面 | ✅ |
| `packages/web/src/router/index.ts` | 修改 | `/ontology` 路由 | ✅ |
| `packages/web/vite.config.ts` | 修改 | manualChunks 拆分 vis-network | ✅ |
| `packages/ontology/src/semantic-mapper.ts` | 修改 | 修复 addRelation 替代 addEntity | ✅ |
| `packages/db/src/migrations/004_ontology_snapshots.sql` | 新建 | DB 持久化表 | ✅ |
| `packages/api/src/index.ts` | 修改 | 启动时恢复本体 | ✅ |

### 11.1 流程

```
自然语言描述 → POST /ontology/from-text → LLM (extractGraph) → 实体+关系 JSON → 存入 OwlStore
```

### 11.2 LLM Prompt 设计

输入："张三属于技术部，提交了报销单RE-001，包含住宿费2000元，由李四审批"

LLM 提取为结构化的实体列表和关系列表：

```json
{
  "entities": [
    { "uri": "person/zhangsan", "type": "Person", "properties": { "name": "张三" } },
    { "uri": "dept/tech", "type": "Department", "properties": { "name": "技术部" } },
    { "uri": "report/RE-001", "type": "Report", "properties": { "serialNo": "RE-001", "status": "pending" } },
    { "uri": "item/001", "type": "ExpenseItem", "properties": { "amount": "2000", "category": "住宿费" } },
    { "uri": "person/lisi", "type": "Person", "properties": { "name": "李四" } }
  ],
  "relations": [
    { "from": "person/zhangsan", "to": "dept/tech", "predicate": "belongsTo" },
    { "from": "person/zhangsan", "to": "report/RE-001", "predicate": "submittedBy" },
    { "from": "report/RE-001", "to": "item/001", "predicate": "containsItem" },
    { "from": "report/RE-001", "to": "person/lisi", "predicate": "approvedBy" }
  ]
}
```

---

## 12. 本体可视化页面（v1.1 新增）

### 12.1 页面交互

```
┌─ 本体可视化 ───────────────────────────────────────────────┐
│  ┌─ NL 输入 ──────────────────────────────────────────┐   │
│  │ "张三属于技术部，提交了报销单RE-001..."               │   │
│  │ [✨ 生成本体]                                        │   │
│  └────────────────────────────────────────────────────┘   │
│  ┌─ Cytoscape.js 图谱 ─────────────────────────────────┐   │
│  │  ○ Person ──submittedBy──→ □ Report                 │   │
│  │  │                              │ containsItem        │   │
│  │  │ belongsTo                     ├─ △ ExpenseItem     │   │
│  │  ▼                              │                     │   │
│  │  ◇ Department                   └─ ◇ ...             │   │
│  └────────────────────────────────────────────────────┘   │
│  ┌─ 属性面板（点击节点后显示）──────────────────────────┐   │
│  │  类型: Person · 名称: 张三 · 部门: 技术部             │   │
│  │  [保存] [删除]                                        │   │
│  └────────────────────────────────────────────────────┘   │
│  节点: 6 · 边: 5    [+ 手动添加]  [从数据库同步]          │
└──────────────────────────────────────────────────────────┘
```

### 12.2 可视化风格（v1.3）

| 属性 | 设置 |
|------|------|
| 背景 | `#fafbfc` 浅色 + 1px `#e5e7eb` 边框 + 内阴影 |
| 节点 | 无边框 flat fill, `borderWidth: 0` |
| 节点颜色 | 粉彩系：Person=粉, Department=蓝, ExpenseItem=纯黄, Report=青, Invoice=珊瑚, Rule=紫, Approver=天蓝, Company=绿 |
| 节点大小 | dot 类 20px, ExpenseItem box 80x20 |
| 节点阴影 | `rgba(0,0,0,0.2)` size 18 |
| 节点标签 | sans-serif #333 13px, 节点下方 |
| 边 | 直线 `#999`, width 1px, 箭头 0.5 比例 |
| 边标签 | sans-serif #666 11px, 居中, 白色半透明背景 |
| 标题 | serif bold 30px "本体图谱", serif italic 16px 副标题 |
| 图例 | CSS 形状匹配（圆/菱形/六角/星/方/扁矩形）+ 颜色对照 |
| 构建 | vis-network 拆为独立 `vendor-vis` chunk（521KB），页面 chunk 仅 11KB |

### 12.3 节点标签规则

| 类型 | 标签来源 |
|------|----------|
| Person | `name` → `phone` → URI |
| Department / Company | `name` → URI |
| Report | `title` → `serialNo` → URI |
| ExpenseItem | `"类别 ¥金额"` → `description` → `category` |
| Invoice | `file_name` → URI |
| ApprovalRule | `name` → URI |

### 12.4 API 端点（共 9 个）

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/ontology/submit-from-text` | NL → 创建报销单 |
| GET | `/ontology/sync` | 从 DB 同步到 OwlStore |
| GET | `/ontology/query?type=` | 按类型查询实体 |
| GET | `/ontology/graph` | 返回全图谱（nodes + edges） |
| POST | `/ontology/from-text` | NL → 提取实体+关系 → 存 OwlStore → 返回图谱 |
| PUT | `/ontology/entity` | 创建/编辑实体 |
| DELETE | `/ontology/entity?uri=` | 删除实体 |
| POST | `/ontology/relation` | 创建关系 |
| DELETE | `/ontology/relation` | 删除关系 |

---

> 评审完成后进入实施计划阶段。
