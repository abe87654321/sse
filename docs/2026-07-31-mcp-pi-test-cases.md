# SSE MCP × Pi Agent — 接入指南与测试用例

> 日期：2026-07-31 | 版本：v1.0 | 状态：已完成接入

---

## 1. 目标

把 SSE 报销系统的 **14 个 MCP 工具** 接入 Pi 编码 Agent（及同类 Agent），使 Pi 能直接：

- 查询报销单、统计、待审批列表
- 用自然语言创建并提交报销单
- 查询本体知识图谱、执行 SPARQL 跨域查询
- 解释审批决策、做合规校验

---

## 2. 架构

```
Pi Agent (TUI)
   │  pi.registerTool() × 14
   ▼
.pi/extensions/sse-mcp.ts  (Pi 扩展桥)
   │  spawn + JSON-RPC over stdio
   ▼
node packages/mcp/dist/index.js  (MCP Server, stdio)
   │  @sse/db / @sse/ontology / @sse/ocr  →  直连 DB（不经 HTTP API）
   ▼
PostgreSQL 192.168.3.107:5433 │ MinIO 192.168.3.107:9002 │ Ollama 192.168.3.107:11434
（API :3000 / 前端 :5173 也运行在 192.168.3.107）
```

**关键事实（决定方案）**：

1. **Pi v0.83 无原生 MCP 支持**（README 明确 "No MCP"），必须通过扩展桥接。
2. MCP 服务端用 **newline-delimited JSON** 走 stdio（已验证：`initialize → notifications/initialized → tools/list → tools/call`）。
3. 工具鉴权：`resolveAuthContext()` 读 `process.env.MCP_API_KEY` 或工具参数 `api_key`；key→`{userId, role, department}` 映射来自 `MCP_API_KEYS` 环境变量或 DB `mcp_api_keys` 表。

---

## 3. 前置条件（环境必须就绪）

> 服务主机：**192.168.3.107**（API :3000、前端 :5173、PostgreSQL :5433、MinIO :9002、Ollama :11434 均运行于此）。

| 服务 | 地址 | 验证命令（本机） | 说明 |
|------|------|---------|------|
| PostgreSQL | `192.168.3.107:5433` | `Test-NetConnection 192.168.3.107 -Port 5433` | Docker 启动 `sse-postgres-1` |
| MinIO | `192.168.3.107:9002` | 同上（9002） | Docker 启动 `sse-minio-1`，已建 `invoices` 桶 |
| API 服务 | `http://192.168.3.107:3000` | `curl http://192.168.3.107:3000/health` | 前端 `:5173` 走 Vite 代理到该 API |
| Ollama | `http://192.168.3.107:11434` | `curl http://192.168.3.107:11434/v1/models` | 仅 NL/OCR 工具需要 |
| MCP Server | stdio | `pnpm --filter @sse/mcp build` | 本机编译，子进程直连远端 DB |

> **⚠️ 常见坑**：PostgreSQL 未启动或 `DB_HOST` 未指向 `192.168.3.107` 时，`search_expenses` 等 DB 类工具会**挂起直到连接超时**（pg 默认连接无超时）。排障先确认本机可连通 `192.168.3.107:5433`。

---

## 4. 配置步骤（一次性的）

### 4.1 准备 API Key + 远端 DB 配置

MCP 子进程**直连远端 PostgreSQL**，本机 `.env` 必须指向 `192.168.3.107`：

```bash
# 1. 查管理员 UUID（在 192.168.3.107 上执行）
ssh user@192.168.3.107 "docker exec -i sse-postgres-1 psql -U sse -d sse -c \"SELECT id, name, role FROM users WHERE role='admin';\""

# 2. 写入本机项目 .env（如不存在则从 .env.example 复制）
#    DB_* 必须指向远端，否则桥接挂起
DB_HOST=192.168.3.107
DB_PORT=5433
DB_NAME=sse
DB_USER=sse
DB_PASSWORD=<远端数据库密码>

MINIO_ENDPOINT=192.168.3.107
MINIO_PORT=9002

# MCP key 格式: key=userId:role:department
MCP_API_KEYS=mcp_key_001=<admin-id>:admin:管理部
MCP_API_KEY=mcp_key_001

# 3. 可选：持久化到 DB（迁移 009，在 192.168.3.107 上执行）
ssh user@192.168.3.107 "docker exec -i sse-postgres-1 psql -U sse -d sse" < packages/db/src/migrations/009_mcp_api_keys.sql
```

### 4.2 编译 MCP Server

```bash
pnpm --filter @sse/mcp build
```

### 4.3 安装 Pi 扩展

扩展已随仓库提供（`.pi/extensions/sse-mcp.ts`），无需独立安装，在项目目录启动 Pi 即自动加载：

```bash
# 项目根目录启动 Pi（自动发现 .pi/settings.json → extensions）
pi

# 或临时加载
pi --extension .pi/extensions/sse-mcp.ts

# 查看桥接状态 / 重新发现工具
/sse-mcp status
/sse-mcp reload
```

> **注意**：首次在项目目录运行 Pi 会弹**项目信任**确认（`.pi/settings.json` 含扩展），选允许。非交互模式（`-p`）默认不弹窗但也不加载项目扩展，需 `--approve`。

---

## 5. 验证：工具清单应出现 14 个

```bash
pi --extension .pi/extensions/sse-mcp.ts -p "列出你能调用的 SSE 报销工具"
```

预期输出出现 14 个工具：

| 分组 | 工具 |
|------|------|
| 报销搜索 | `search_expenses`, `get_expense_detail`, `get_approval_status`, `get_statistics`, `get_user_summary`, `list_pending_approvals` |
| 提交类 | `submit_expense_from_text`, `submit_expense_from_invoice` |
| 查询/解释 | `query_expense_status`, `explain_decision`, `validate_expense` |
| 本体图谱 | `query_ontology`, `get_entity_network`, `query_sparql` |

启动日志应见：`[sse-mcp] registered 14 tools`

---

## 6. 详细测试用例

> 每例格式：**目的 / 给 Pi 的提示词 / 预期结果 / 通过标准**。用 `pi -p "..."` 非交互执行。

### 分组 A：鉴权与连通性

| 用例 | 操作 | 预期 |
|------|------|------|
| **A1** | `MCP_API_KEYS` 未设置时调用任意工具 | 返回 `error.code = UNAUTHORIZED`，消息含"无效或缺失 API key" |
| **A2** | `.env` 配置正确后调用 `search_expenses` | 返回分页结构 `{ results, pagination: { page, page_size, total } }` |
| **A3** | 扩展里 `MCP_API_KEY` 指向错误 key | 同上 UNAUTHORIZED |

### 分组 B：报销搜索（DB 依赖）

**B1 search_expenses**
```bash
pi --extension .pi/extensions/sse-mcp.ts -p "用 search_expenses 查询状态为 approved 的报销单，page_size 3，告诉我总数"
```
- 预期：`pagination.total` ≥ 0；`results[].status === "approved"`；每项含 `serial_no, title, total_amount`
- 通过标准：返回合法分页 JSON，字段齐全

**B2 get_expense_detail**
```bash
pi ... -p "用 get_expense_detail 查报告 <report_id>，列出明细、发票、审批记录"
```
- 预期：`items[]`（含 `category_name, amount, expense_date`）、`invoices[]`（含 `ocr_result`）、`approval_records[]`（含 `step, result, approver_id`）
- 通过标准：report 存在时返回完整详情；不存在时 `error.code = NOT_FOUND`
- 异常：非本人/非审批范围时 `error.code = UNAUTHORIZED`

**B3 get_approval_status**
```bash
pi ... -p "查 <report_id> 的审批状态"
```
- 预期：审批链步骤列表 + 当前进度
- 通过标准：与 `get_expense_detail.approval_records` 一致

**B4 get_statistics**
```bash
pi ... -p "获取报销统计，包含总额和分类汇总"
```
- 预期：`summary`（total, byStatus, byCategory）+ `monthly`
- 通过标准：数值与页面统计一致

**B5 get_user_summary**
```bash
pi ... -p "查用户 <user_id> 的报销汇总"
```
- 预期：报销单数、总额、分类汇总
- 通过标准：返回该用户私有数据；他人调用被角色过滤

**B6 list_pending_approvals**
```bash
pi ... -p "列出审批人 <approver_id> 的待审批报销单"
```
- 预期：待审批记录分页
- 通过标准：admin/finance 可见全部，dept_approver 仅本部门

### 分组 C：本体图谱（无 DB 直连，内存 N3 Store）

**C1 query_ontology**
```bash
pi ... -p "查询本体图谱，全图统计概览"
pi ... -p "查询类型为 Person 的实体"
```
- 预期：全图返回 `summary { total_nodes, total_edges, type_counts }`；按类型返回 `entities[]`
- 通过标准：`query?type=Person` 返回 Person 列表

**C2 get_entity_network**
```bash
pi ... -p "取报告 <report_id> 的 2 跳语义网络"
```
- 预期：实体 + 关联边（N 跳 BFS）
- 通过标准：返回该实体的邻居节点与关系

**C3 query_sparql**
```bash
pi ... -p "执行 SPARQL: SELECT ?s ?p ?o WHERE { ?s ?p ?o } LIMIT 5"
```
- 预期：`results[]` + `count`；predicate 为实际存储名（如 `belongsTo`，非 `sse:belongsTo`）
- 通过标准：count ≥ 0；空结果时先 `GET /ontology/sync` 恢复数据再试

### 分组 D：提交类（依赖 Ollama + DB）

**D1 submit_expense_from_text**
```bash
pi ... -p "帮我报销：出差北京住宿费 600 元"
```
- 预期：`{ success: true, report_id, serial_no: "RE-..." }` 或 `{ success: false, error: { ... } }`（金额不足/类别不匹配等）
- 通过标准：成功则 DB `expense_reports` 新增草稿并触发审批链；失败返回可读原因

**D2 submit_expense_from_invoice**
```bash
# 需先准备发票图片 base64
pi ... -p "提交这张发票报销（<base64>，格式 image）"
```
- 预期：OCR 识别 → 自动创建报销单 → 返回 report_id
- 通过标准：`/ai/ocr` 接口能识别；无 OCR 服务时返回明确错误而非挂起

### 分组 E：解释与合规

**E1 explain_decision**
```bash
pi ... -p "解释 <report_id> 的审批决策"
```
- 预期：匹配规则名 + 金额区间 + 审批链 + 全程审批历史
- 通过标准：输出含 `matched_rule.name` 和完整 `approval_chain`

**E2 validate_expense**
```bash
pi ... -p "校验金额 800 元、类别 差旅费 是否符合规则"
```
- 预期：`{ valid, matched_rule: { name, amount_range, approval_steps }, issues[], suggestions[] }`
- 通过标准：超规则区间时 `valid: false` 且带建议

**E3 query_expense_status（NL 查询）**
```bash
pi ... -p "张三的出差住宿报销批了吗？"
```
- 预期：NL 总结（调用 LLM 汇总 SQL 结果）
- 通过标准：返回 `summary` + 匹配记录；无数据时明确说明

---

## 7. 直接 stdio 验证（不经过 Pi，排障用）

```bash
# 初始化 + 列表
@('{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"t","version":"0.0.1"}}}','{"jsonrpc":"2.0","method":"notifications/initialized"}','{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}') | node packages/mcp/dist/index.js

# 调用工具（需 env 注入 key + 远端 DB；stdio 直跑不会自动加载 .env）
$env:DB_HOST="192.168.3.107"
$env:DB_PORT="5433"
$env:DB_NAME="sse"
$env:DB_USER="sse"
$env:DB_PASSWORD="<远端数据库密码>"
$env:MCP_API_KEYS="mcp_key_001=<admin-id>:admin:管理部"
$env:MCP_API_KEY="mcp_key_001"
@('{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"t","version":"0.0.1"}}}','{"jsonrpc":"2.0","method":"notifications/initialized"}','{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"search_expenses","arguments":{"page_size":5}}}') | node packages/mcp/dist/index.js
```

---

## 8. 常见问题

| 问题 | 原因 | 解决 |
|------|------|------|
| 工具挂起不返回 | PostgreSQL 未启动 或 `.env` 中 `DB_HOST` 仍为 `localhost` | 确认本机可连通 `192.168.3.107:5433`；检查 `.env` 的 `DB_*` |
| 全部工具 UNAUTHORIZED | `MCP_API_KEYS` / `MCP_API_KEY` 未配置 | 检查 `.env` 与管理员 UUID |
| `[sse-mcp] registered 0 tools` | 扩展先于 session_start 触发 | `/sse-mcp reload` 重连 |
| NL 工具返回解析失败 | Ollama 未启动或模型未拉取 | `ollama pull llama3.2-vision`，验证 `192.168.3.107:11434` |
| Pi 不加载项目扩展 | 项目未信任 | 交互模式信任项目；`-p` 加 `--approve` |
| API 重启后图谱/SPARQL 为空 | 本体 Store 异步恢复 | `curl http://192.168.3.107:3000/ontology/sync` |

---

## 9. 文件清单

| 文件 | 说明 |
|------|------|
| `.pi/extensions/sse-mcp.ts` | Pi 扩展桥（spawn MCP + JSON-RPC + registerTool） |
| `.pi/settings.json` | 项目级扩展注册 |
| `docs/2026-07-31-mcp-pi-test-cases.md` | 本文档 |
| `packages/mcp/dist/index.js` | MCP Server（已编译） |
| `test/mcp-regression.sh` | 既有 REST 层回归脚本 |

---

> 文档位置：`docs/2026-07-31-mcp-pi-test-cases.md`
