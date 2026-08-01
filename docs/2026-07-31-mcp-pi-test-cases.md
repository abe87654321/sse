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

## 2. 架构（瘦客户端 v2）

```
Pi Agent (新电脑)
   │  pi.registerTool() × 14
   ▼
.pi/extensions/sse-mcp.ts  (Pi 瘦客户端扩展，纯 fetch 零依赖)
   │  JWT（API key → /auth/api-key-login 换 token）
   ▼
http://192.168.3.107:3000  (远端 REST API)
   │
   ▼  DB / 本体 / OCR
```

**关键事实（决定方案）**：

1. **Pi v0.83 无原生 MCP 支持**（README 明确 "No MCP"），必须通过扩展注册工具。
2. **客户端零依赖**：扩展只用 Node 内置 `fetch`，不 spawn 本地进程、无 node_modules、无 `.env`、无 DB 凭据。新电脑只需：装 pi → 复制 `.pi/` → 配 `SSE_API_KEY`。
3. **角色随 key 走**：`POST /auth/api-key-login` 查 `mcp_api_keys` 表定位 key 绑定的用户，按该用户角色签发 JWT——员工 key 看自己数据，管理员 key 全量。
4. **方案 B（备用）**：`packages/mcp/dist/http.js` 暴露 HTTP+SSE transport（`:3001/mcp`），供 Claude Code / Cursor 等原生 MCP 客户端使用。

---

## 3. 前置条件

> 服务主机：**192.168.3.107**（API :3000、前端 :5173、PostgreSQL :5433、MinIO :9002、Ollama :11434 均运行于此）。

瘦客户端模式**只需要远端 API 可用**，客户端无本地依赖：

| 服务 | 地址 | 验证命令 | 说明 |
|------|------|---------|------|
| API 服务（必） | `http://192.168.3.107:3000` | `curl http://192.168.3.107:3000/health` | 含 `/auth/api-key-login` 等新端点 |
| 前端 | `http://192.168.3.107:5173` | 浏览器访问 | 可选 |
| Ollama | `http://192.168.3.107:11434` | `curl http://192.168.3.107:11434/v1/models` | 仅 NL/OCR 工具需要 |

> **客户端不需要**：git clone、pnpm、本地 MCP 进程、本地 `.env`、DB 凭据。

---

## 4. 客户端配置（3 步）

### 4.1 安装 Pi
```powershell
npm install -g @earendil-works/pi-coding-agent
```

### 4.2 复制 `.pi/` 扩展（随仓库提供，或手动复制）
```powershell
# 方式一：从仓库复制
git clone https://github.com/abe87654321/sse.git temp-sse
copy temp-sse\.pi E:\app\opencode\sse\.pi   # 或放入任意项目根目录 .pi/
# 方式二：手动复制 .pi/settings.json + .pi/extensions/sse-mcp.ts 到项目 .pi/

# 方式三（备用）：pi install git:
# pi install git:github.com/abe87654321/sse
```

### 4.3 配置 API Key（每人一个，权限随 key 走）

各人的 key 已存入远端 DB `mcp_api_keys` 表。每个 key 绑定一个真实用户，拥有对应的角色和部门：

| key | 绑定用户 | 角色 | 部门 | 权限范围 |
|-----|---------|------|------|---------|
| `mcp_admin_001` | 系统管理员 | admin | 管理部 | 全部数据 |
| `mcp_admin_002` | 孙哲林 | admin | 行政部 | 全部数据 |
| `mcp_finance_001` | 王钰 | finance | 财务部 | 全部数据 + 统计 |
| `mcp_emp_jiqiong` | 姬琼 | employee | 市场部 | 仅自己 |
| `mcp_emp_sunyihang` | 孙逸航 | employee | 技术部 | 仅自己 |
| `mcp_emp_zhangsan` | 张三 | employee | 产品部 | 仅自己 |
| `mcp_emp_lisi` | 李四 | employee | 产品部 | 仅自己 |

**每个人找自己的 key，在启动 Pi 前设置环境变量：**

Windows (cmd):
```cmd
set SSE_API_KEY=mcp_emp_zhangsan          ← 改成自己的 key
set SSE_API_BASE=http://192.168.3.107:3000
```

Windows (PowerShell):
```powershell
$env:SSE_API_KEY = "mcp_admin_001"
$env:SSE_API_BASE = "http://192.168.3.107:3000"
```

Linux / macOS:
```bash
export SSE_API_KEY="mcp_emp_zhangsan"
export SSE_API_BASE="http://192.168.3.107:3000"
```

**推荐**：写入配置文件，一劳永逸（优先级：环境变量 > 配置文件）：

**全局配置（`~/.pi/agent/sse-config.json`，当前用户所有项目生效）**：
```bash
cat > ~/.pi/agent/sse-config.json << 'EOF'
{
  "apiBase": "http://192.168.3.107:3000",
  "apiKey": "mcp_admin_001"
}
EOF
```

**项目配置（`.pi/sse-config.json`，仅当前项目生效）**：
```bash
cat > .pi/sse-config.json << 'EOF'
{
  "apiBase": "http://192.168.3.107:3000",
  "apiKey": "mcp_emp_zhangsan"
}
EOF
```

> **原理**：启动 Pi 时，扩展调 `POST /auth/api-key-login` 拿 key 查 `mcp_api_keys` 表，找到绑定的用户，按该用户的 role + department 签发 JWT。之后所有工具调用都带这个 JWT，REST API 自带角色过滤自动生效——admin 看全部、employee 只看自己。

> **新增 key**：参照 `packages/db/src/migrations/009_mcp_api_keys.sql`，往 `mcp_api_keys` 表 INSERT 即可，格式 `(key, user_id, role, department, is_active = true)`.

### 4.4 启动 Pi
```powershell
cd <项目根目录>        # 含 .pi/ 的目录
pi
/sse-mcp status       # 应显示 base 与 logged in
```

> 首次运行会弹**项目信任**确认，选允许。非交互模式（`-p`）需 `--approve` 才会加载项目扩展。

---

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

## 7. 直接 REST 验证（不经过 Pi，排障用）

```bash
BASE="http://192.168.3.107:3000"
# 1. 用 API key 换 JWT
TOKEN=$(curl -s -X POST "$BASE/auth/api-key-login" -H "Content-Type: application/json" \
  -d '{"apiKey":"mcp_admin_001"}' | python3 -c "import json,sys; print(json.load(sys.stdin)['accessToken'])")

# 2. 搜索报销单（等价 search_expenses）
curl -s -H "Authorization: Bearer $TOKEN" "$BASE/expenses?page=1&pageSize=5"

# 3. 合规校验（等价 validate_expense）
curl -s -X POST "$BASE/expenses/validate" -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" -d '{"amount":800,"categoryName":"差旅费"}'

# 4. NL 查询（等价 query_expense_status）
curl -s -X POST "$BASE/ontology/query-expense-status" -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" -d '{"query":"张三的出差住宿报销批了吗"}'
```

---

## 8. 常见问题

| 问题 | 原因 | 解决 |
|------|------|------|
| 工具返回 UNAUTHORIZED | `SSE_API_KEY` 未配置或 key 无效 | 检查 `$env:SSE_API_KEY`；确认 key 在远端 `mcp_api_keys` 表 active |
| 提示"未配置 SSE_API_KEY" | 启动 Pi 的 shell 没设环境变量 | `$env:SSE_API_KEY = "mcp_admin_001"` 后再启动 pi |
| 员工登录却看到别人的数据 | key 绑定的 user/role 不对 | 重新生成绑定正确用户的 key |
| NL 工具返回解析失败 | Ollama 未启动或模型未拉取 | `ollama pull llama3.2-vision`，验证 `192.168.3.107:11434` |
| Pi 不加载项目扩展 | 项目未信任 | 交互模式信任项目；`-p` 加 `--approve` |
| API 重启后图谱/SPARQL 为空 | 本体 Store 异步恢复 | `curl http://192.168.3.107:3000/ontology/sync` |
| 想用原生 MCP 客户端 | 方案 B HTTP transport | 部署 `packages/mcp/dist/http.js` 到 `:3001/mcp`，配 `Authorization: Bearer <key>` |

---

## 9. 文件清单

| 文件 | 说明 |
|------|------|
| `.pi/extensions/sse-mcp.ts` | Pi 瘦客户端扩展（fetch 远端 REST + JWT + snake_case 适配） |
| `.pi/settings.json` | 项目级扩展注册 |
| `packages/api/src/routes/auth.ts` | 新增 `POST /auth/api-key-login` |
| `packages/api/src/routes/expenses.ts` | 新增 `POST /expenses/validate`、`POST /expenses/from-invoice` |
| `packages/api/src/routes/ontology.ts` | 新增 `POST /ontology/query-expense-status` |
| `packages/mcp/src/http.ts` | 方案 B：HTTP+SSE transport 入口 |
| `docs/2026-07-31-mcp-pi-test-cases.md` | 本文档 |
| `docs/2026-07-31-pi-mcp-thin-client-plan.md` | 实施计划 |

---

> 文档位置：`docs/2026-07-31-mcp-pi-test-cases.md`
