# SSE 本体层升级 — 需求设计文档

> 日期：2026-07-29 | 版本：v1.0 | 状态：待评审

---

## 1. 概述

将当前"DB 数据 → RDF 镜像"的薄本体层升级为具备三大能力：**多系统数据融合**、**可配置推理引擎**、**SPARQL 跨域查询**。使本体层从数据库的冗余副本变为系统真正的语义中心。

---

## 2. 三大场景设计

### 场景一：多系统数据融合

```
SCIM/MDM (用户) ─┐
SSE 内部 (报销)  ─┼──→ 本体层 (统一命名空间) ──→ RDF Store ──→ 查询/推理
打款系统 (支付)  ─┘
```

**核心改动**：

| 来源 | 当前状态 | 改造后 |
|------|---------|--------|
| SSE 内部 | `semantic-mapper` 同步报销单 | 同，新增打款状态同步 |
| SCIM/MDM | `identity-bridge` 写 `identity_mappings`，不写本体 | `identity-bridge` 同步时同时写入本体 Person 实体（含 externalId 属性） |
| 打款回调 | 设计文档已预留，未实现 | Webhook 回调时调用 `semantic-mapper` 更新 PaidReport 状态 |

统一命名空间：
- 内部用户：`sse:person/{userId}`
- SCIM 用户：`scim:person/{externalId}`，通过 `sse:sameAs` 关联到 `sse:person/{userId}`
- MDM 组织：`mdm:org/{externalId}`，通过 `sse:equivalentTo` 关联到 `sse:department/{name}`

### 场景二：可配置推理引擎

**新增 `reasoning_rules` 表**：

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | UUID | PK |
| `name` | TEXT | 规则名称 |
| `description` | TEXT | 规则说明 |
| `conditions` | JSONB | 条件数组 `[{subject, predicate, object}]` |
| `conclusion` | JSONB | 结论 `{subject, predicate, object}` |
| `priority` | INT | 优先级 |
| `is_active` | BOOLEAN | 启用 |

变量语法：`?x` 表示变量，匹配后代入 conclusion。

**规则示例**：

```json
{
  "name": "部门归属传递",
  "conditions": [
    {"subject": "?p", "predicate": "sse:belongsTo", "object": "?d"},
    {"subject": "?d", "predicate": "sse:partOf", "object": "?c"}
  ],
  "conclusion": {"subject": "?p", "predicate": "sse:worksFor", "object": "?c"}
}
```

输入："张三 belongsTo 技术部，技术部 partOf 总公司"  
输出："张三 worksFor 总公司"（新三元组写入 RDF Store）

**推理执行时机**：
- 本体同步后自动触发（sync API）
- 规则保存/修改后触发
- 手动触发（API：`POST /ontology/reason`）

**推理引擎实现**：前向链（forward-chaining）——迭代应用所有活跃规则，直到没有新三元组产生。

### 场景三：SPARQL 跨域查询

**新增 MCP 工具** `query_sparql`：

```
参数: query (SPARQL 字符串)
返回: { results: [{...}], count: N }
```

**新增 REST 端点** `POST /ontology/sparql`：

```
权限: 仅 admin / finance
参数: { query: "SELECT ?s ?p ?o WHERE { ?s ?p ?o } LIMIT 10" }
返回: { results: [...] }
```

SPARQL 直接查询内存 N3 Store，零 DB 依赖。结果按用户角色过滤（复用 `filterGraph` 逻辑）。

---

## 3. 推理规则管理界面

系统管理 → 新增"推理规则"页 `AdminReasoningRules.vue`：

```
┌─ 推理规则管理 ───────────────────────────────────┐
│  [+ 新建规则]                                      │
│                                                    │
│  ┌─ 规则列表 ──────────────────────────────────┐  │
│  │ ☑ 部门归属传递    优先级 1    [编辑] [删除]    │  │
│  │ ☑ 报销关联发票    优先级 2    [编辑] [删除]    │  │
│  │ ☐ 支付追溯        优先级 3    [编辑] [删除]    │  │
│  └──────────────────────────────────────────────┘  │
│                                                    │
│  ┌─ 编辑规则 ──────────────────────────────────┐  │
│  │ 名称: [________________________]               │  │
│  │ 条件 (JSON):                                   │  │
│  │ [{"subject":"?p","predicate":"sse:belongsTo",  │  │
│  │   "object":"?d"}, ...]                          │  │
│  │ 结论: {"subject":"?p","predicate":"sse:worksFor",│  │
│  │        "object":"?c"}                          │  │
│  │ [保存] [取消]                                  │  │
│  └──────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────┘
```

---

## 4. 文件变更清单

| 文件 | 变更 | 说明 |
|------|------|------|
| `packages/db/src/migrations/007_reasoning_rules.sql` | 新建 | reasoning_rules 表 |
| `packages/ontology/src/reasoner.ts` | 新建 | 前向链推理引擎 |
| `packages/ontology/src/sparql.ts` | 新建 | SPARQL 查询封装 |
| `packages/ontology/src/types.ts` | 修改 | ReasoningRule, SparqlResult 类型 |
| `packages/db/src/repositories/pg-reasoning-rule-repo.ts` | 新建 | 推理规则 CRUD |
| `packages/api/src/routes/ontology.ts` | 修改 | 新增 /reason, /sparql |
| `packages/api/src/routes/admin-rules.ts` | 新建或扩展到现有 | 推理规则管理 API |
| `packages/mcp/src/tools/query-sparql.ts` | 新建 | MCP SPARQL 工具 |
| `packages/mcp/src/server.ts` | 修改 | 注册 query_sparql |
| `packages/api/src/services/identity-bridge.ts` | 修改 | 同步时写入本体 Person |
| `packages/web/src/pages/AdminReasoningRules.vue` | 新建 | 推理规则管理页面 |
| `packages/web/src/router/index.ts` | 修改 | 新增路由 |
| `packages/web/src/layouts/DefaultLayout.vue` | 修改 | 侧边栏菜单 |

---

## 5. 本体层最终架构

```
                        外部系统
                    ┌─────┼─────┐
                    │SCIM │ MDM │ 财务│
                    └──┬──┴──┬──┴──┬─┘
                       │     │     │
                  ┌────▼─────▼─────▼────┐
                  │   Identity Bridge   │
                  │  (统一命名空间)      │
                  └────────┬───────────┘
                           │
            ┌──────────────┼──────────────┐
            ▼              ▼              ▼
      semantic-mapper   reasoner       SPARQL
      (DB → RDF)        (前向链)       (查询)
            │              │              │
            └──────────────┼──────────────┘
                           ▼
                      N3 RDF Store
                      (内存 + DB 持久化)
                           │
            ┌──────────────┼──────────────┐
            ▼              ▼              ▼
      GET /graph       MCP query_sparql   可视化
      (vis-network)
```

---

> 评审完成后进入实施阶段。
