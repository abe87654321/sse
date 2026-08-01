# Pi MCP 瘦客户端方案 — 计划（评审稿）

> 日期：2026-07-31 | 状态：待评审

---

## 1. 背景与问题

当前 Pi 接入 MCP 的方式：客户端机器 spawn 本地 `packages/mcp/dist/index.js` 进程（扩展桥接）。这要求客户端：

```
npm i -g pi
git clone sse 仓库          ← 负担 1
pnpm install               ← 负担 2
pnpm --filter @sse/mcp build ← 负担 3
配置 .env（DB 凭据等）      ← 负担 4（还暴露 DB 密码给客户端）
```

对"别人装个 Pi agent 就能用"的目标完全不合格。

## 2. 关键事实（已核实）

1. **SSE 的 REST API 已运行在 `http://192.168.3.107:3000`**，14 个 MCP 工具中 **11 个有现成 REST 端点**：
   - `search_expenses` → `GET /expenses`（同 query 参数）
   - `get_expense_detail` → `GET /expenses/:id`（含 items/invoices/approvalRecords）
   - `get_approval_status` → `GET /expenses/:id`（approvalRecords）
   - `get_statistics` → `GET /statistics`
   - `get_user_summary` → `GET /expenses?applicantId=`
   - `list_pending_approvals` → `GET /approvals/pending`
   - `submit_expense_from_text` → `POST /ontology/submit-from-text`
   - `explain_decision` → `GET /expenses/:id`（ruleName + approvalRecords）
   - `query_ontology` → `GET /ontology/graph`、`GET /ontology/query`
   - `get_entity_network` → `GET /ontology/query?type=` + 边展开
   - `query_sparql` → `POST /ontology/sparql`

2. **REST 认证用 JWT**（`POST /auth/login` 手机号+密码换 token），**MCP 用 API key**（已存远端 DB `mcp_api_keys`）。两者不通。

3. **无现成 REST 端点的工具**（3 个）：
   - `validate_expense` — 规则匹配校验（后端有 `approval_rules` 逻辑）
   - `query_expense_status` — NL 查询 + LLM 总结
   - `submit_expense_from_invoice` — 发票 OCR → 报销（REST 有 `/ai/parse-invoice`，但只返回 items 不建单）

4. **Pi v0.83 无原生 MCP**，任何方案都需扩展用 `pi.registerTool()` 注册工具。

---

## 3. 目标客户端体验（验收标准）

```
新电脑：
1. npm i -g pi
2. 复制 1 个扩展文件（或 `pi install git:...` 一条命令）
3. 运行一次 `pi` → 自动出现 14 个工具，可直接对话使用
```
不需要：git clone、pnpm、本地 MCP 进程、本地 .env、DB 凭据。

---

## 3.5 评审决策（已确认 2026-07-31）

| # | 决策点 | 结论 |
|---|--------|------|
| 1 | 认证方式 | 走 `/auth/api-key-login`，客户端只持有 MCP API key。**角色随 key 走**：`mcp_api_keys` 表已绑定 `user_id + role + department`，登录时用 key 查到对应用户并按**该用户的角色**签发 JWT——员工 key 登出员工权限，管理员 key 登出管理员权限，不共用管理员账号 |
| 2 | 字段名策略 | **做法 A**：扩展内做 camelCase→snake_case 转换 + 分页重组，工具输出与原有 MCP 完全一致，现有文档/测试用例不改 |
| 3 | 原生 MCP 兼容 | 保留方案 B（远端 HTTP MCP），供 Claude Code/Cursor 等原生 MCP 客户端使用，与方案 A 并存 |
| 4 | 扩展分发 | **手动复制优先**（`.pi/` 已提交仓库，从仓库复制即可）；`pi install git:` 作为备用路径保留 |

---

## 4. 方案选型

### 方案 A：瘦客户端扩展，直连远端 REST API（推荐）

扩展不再 spawn 本地 MCP 进程，而是**纯 fetch 调 `http://192.168.3.107:3000`**：

```
Pi (新电脑)
  │  registerTool × 14
  ▼
sse-mcp.ts（瘦客户端，零依赖，仅 fetch）
  │  HTTPS/JWT
  ▼
http://192.168.3.107:3000  (远端 API)
  │
  ▼  DB / 本体 / OCR
```

**客户端零依赖**：扩展只用 Node 内置 `fetch`，无 node_modules、无本地进程。

**认证方案（角色随 key 走）**：扩展启动时用 MCP API key 调 `POST /auth/api-key-login`。后端查 `mcp_api_keys` 表定位 `user_id + role + department`，按该用户身份签发 JWT。即：
- 员工拿自己的 key → 登出员工权限（只能查/提交自己的报销）
- 部门审批人拿自己的 key → 登出部门审批权限
- 管理员拿自己的 key → 登出管理权限
客户端全程只持有 key，不接触任何密码。

**服务端需补**（新增 3 个端点 + 1 个登录端点）：
| 端点 | 用途 |
|------|------|
| `POST /auth/api-key-login` | 用 MCP key 换 JWT（角色随 key 绑定的 user 走） |
| `POST /expenses/validate` | validate_expense |
| `POST /ontology/query-expense-status` | NL 查询 + LLM 总结 |
| `POST /expenses/from-invoice` | 发票 OCR → 建单提交 |

**优点**：改动最小（服务端已有 90%）；客户端最轻；不暴露 DB 凭据。
**缺点**：REST 字段名（camelCase）需在扩展里适配成 MCP 工具输出；认证从 API key 体系切到 JWT。

### 方案 B：远端部署 MCP over HTTP（Streamable HTTP transport）

把现有 MCP server 部署到 192.168.3.107，改走 HTTP transport（MCP SDK 支持），暴露 `http://192.168.3.107:3001/mcp`。客户端扩展做 **MCP HTTP client**（仍须注册工具，因为 Pi 无原生 MCP）。

**优点**：保留标准 MCP 协议；工具定义/鉴权体系不变（API key 已存 DB）。
**缺点**：服务端要多跑一个进程 + 开新端口；客户端扩展要引入 MCP client SDK（`@modelcontextprotocol/sdk`，需 bundle 或依赖）；比 A 重。

### 方案 C：MCP server 打包单文件可执行

用 esbuild/`pkg` 把 MCP server + 依赖 bundle 成一个可执行文件，客户端下载后本地运行。

**优点**：不 clone 不 pnpm。
**缺点**：仍需本地进程 + 下载文件 + DB 凭据（或内网访问）→ 只解决一半。

---

## 5. 推荐：方案 A

理由：服务端 REST 已覆盖 90%，补 4 个端点成本低；客户端真正做到"零依赖零进程"；且补的端点对任何 HTTP 客户端（含未来其他 Agent）通用。

---

## 6. 文件变更清单（方案 A）

| 文件 | 变更 | 说明 |
|------|------|------|
| `packages/api/src/routes/auth.ts` | 修改 | 新增 `POST /auth/api-key-login`（MCP key → JWT，角色随 key 绑定用户） |
| `packages/api/src/routes/expenses.ts` | 修改 | 新增 `POST /expenses/validate` |
| `packages/api/src/routes/ontology.ts` | 修改 | 新增 `POST /ontology/query-expense-status` |
| `packages/api/src/routes/expenses.ts` | 修改 | 新增 `POST /expenses/from-invoice`（OCR→建单） |
| `.pi/extensions/sse-mcp.ts` | 重写 | 从"spawn 本地 MCP"改为"fetch 远端 REST"，含 JWT 缓存 + snake_case 适配 |
| `.pi/settings.json` | 不变 | 继续项目级注册 |
| `docs/2026-07-31-mcp-pi-test-cases.md` | 更新 | 客户端接入步骤简化为 3 步 |
| `docs/2026-07-31-pi-mcp-thin-client-plan.md` | 新建 | 本文档 |

---

## 7. 实施任务（方案 A）

### Task 1：后端新增 API Key → JWT 登录端点（角色随 key 走）
- `POST /auth/api-key-login`：body `{ apiKey }` → 查 `mcp_api_keys` 表定位 `user_id, role, department` → 加载该 user → 若 user 为 active 则按该用户身份签 JWT 返回 `{ accessToken, role, department }`
- 校验：key 不存在 / user 已禁用 → 401

### Task 2：补 3 个缺失工具端点
- `POST /expenses/validate`：参数 `{ amount, categoryId?, categoryName? }` → 复用现有规则匹配返回 `{ valid, matchedRule, issues, suggestions }`
- `POST /ontology/query-expense-status`：参数 `{ query }` → 复用现有 extractor + SQL + LLM 总结逻辑（注意员工/审批人按当前 JWT 角色过滤数据范围）
- `POST /expenses/from-invoice`：参数 `{ imageBase64, fileFormat }` → 复用现有 OCR + 建单逻辑

### Task 3：重写瘦客户端扩展
- 启动时 `POST /auth/api-key-login` 换 JWT（key 从 `SSE_API_KEY` 环境变量读，未设置则提示）
- 注册 14 个工具，每个 handler 用 `fetch` 调对应 REST 端点
- 输出适配：camelCase → snake_case + 分页重组（`pagination: { page, page_size, total, has_more }`）
- 错误处理：401 时自动重新登录重试一次
- 移除 spawn/子进程/DB 相关代码
- 数据范围：由后端 JWT 角色自动控制（扩展不感知角色，只透传 token）

### Task 4：方案 B（原生 MCP 兼容，备用部署）
- 为 MCP server 增加 Streamable HTTP transport 入口（`packages/mcp/src/http.ts`），暴露 `http://192.168.3.107:3001/mcp`
- 服务端部署该进程（systemd / pm2），鉴权仍用 MCP API key（不换 JWT）
- 供 Claude Code / Cursor 等原生 MCP 客户端通过 `mcpServers` 配置连接

### Task 5：文档更新 + 全量验证
- 更新接入指南（3 步安装：装 pi → 复制 `.pi/` → 配 `SSE_API_KEY`）
- 在 192.168.3.107 上验证 14 个工具全部通过；员工/管理员 key 各验证一次权限边界

---

## 8. 已确认决策

| # | 决策点 | 结论 |
|---|--------|------|
| 1 | 认证方式 | `/auth/api-key-login`，客户端只拿 key；角色随 key 绑定的用户走 |
| 2 | 字段名策略 | 扩展内做 snake_case 适配，现有测试文档不改 |
| 3 | 原生 MCP 兼容 | 保留方案 B（远端 HTTP MCP），与方案 A 并存 |
| 4 | 扩展分发 | 手动复制优先；`pi install git:` 备用 |

---

> 评审通过后进入实施。

