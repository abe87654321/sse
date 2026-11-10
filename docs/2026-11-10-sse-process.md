# SSE 开发过程记录（2026-11-10）

> 本次会话主题：让外部 Agent 可靠接入 SSE —— 修复 MCP 鉴权与本体状态、补齐审批与 OCR 核对工具、
> 升级到 Streamable HTTP，并提供 OpenAPI 供非 MCP Agent 使用。
> 代码提交：`55fb5eb`（MCP）、`9d7a697`（API OpenAPI）。

---

## 一、本次完成内容

### 1. 修复 MCP 鉴权：按请求注入身份

**问题**：`http.ts` 只校验 Bearer key，但工具内部 `resolveAuthContext()` 读的是
`process.env.MCP_API_KEY` 或 `args.api_key`，**不读取 HTTP 请求的 key**。结果：
未设 `MCP_API_KEY` 时请求通过鉴权后工具仍返回 UNAUTHORIZED；设了则所有 HTTP 客户端共用同一身份。

**实现**：

- `packages/mcp/src/auth.ts`：新增 `AsyncLocalStorage<AuthContext>`（`runWithAuth` / `currentAuth`）；
  `resolveAuthContext` 优先级改为 请求上下文 → `args.api_key` → `MCP_API_KEY`（仅 stdio 场景）。
- `packages/mcp/src/http.ts`：`authorize()` 返回 `AuthContext`；POST 在 `runWithAuth` 内执行工具；
  会话绑定首次初始化用的 key，跨 key 复用返回 403；移除"无 Bearer 用默认 key"的兜底。

### 2. 修复本体：从空图到 DB 快照

**问题**：`get-engine.ts` 每次调用 `new OntologyEngine()`，而 `OwlStore` 构造为空，
`loadFromDb()` 只在 API 启动时调用。因此 MCP 的 `query_ontology` / `get_entity_network` /
`query_sparql` 基本查不到数据。

**实现**：`get-engine.ts` 改为单例，新增 `ensureOntologyLoaded()`，首次查询从
`ontology_snapshots` 载入最新快照（失败保持空图，不阻塞调用）；三个本体工具与两个提交工具改用它。

### 3. 补审批工具

新增 `approve_expense` / `reject_expense`（`packages/mcp/src/tools/`）：通过签名 JWT 调用
`POST /approvals/:id/approve|reject`，**复用现有核对确认、审批链推进、状态流转与通知逻辑**，
不在 MCP 侧重复实现。存在 AI 核对差异时需 `acknowledge_verification=true`。

### 4. 补齐 OCR + AI 核对闭环

- 新增 `upload_invoice`：把 PDF/OFD 发票挂到费用明细（`POST /expenses/:id/items/:itemId/invoice`）。
- 新增 `verify_expense`：触发 AI 核对（`POST /expenses/:id/verify`），返回金额/日期/发票号一致性与重复票摘要。
- 增强 `submit_expense_from_invoice`：PDF/OFD 建单后自动"取明细 → 入库发票 → 触发核对"，
  返回 `invoice_stored` / `verification`；图片仅做 OCR，不入库。
- 抽出 `api-client.ts`（签名 JWT、multipart 上传、JSON 调用），审批与附件工具共用。

### 5. A：Streamable HTTP 与运维化

- 升级 `@modelcontextprotocol/sdk` `0.5.0 → 1.32.2`，补 peer 依赖 `zod@^3.25`。
- `packages/mcp/src/http.ts` 重写：
  - `POST/GET/DELETE /mcp`：标准 Streamable HTTP（`Mcp-Session-Id` 会话）
  - `GET /sse` + `POST /messages`：旧 HTTP+SSE 兼容（`MCP_LEGACY_SSE=0` 可关）
  - `GET /healthz`、`GET /`：健康检查与端点自述
  - 优雅关闭、会话上限、请求体上限、可选 CORS / JSON 响应
- 新增 `pnpm mcp:http`、`packages/mcp` 的 `start:http`、`deploy/systemd/sse-mcp.service`。
- `.env.example` 新增 `MCP_HTTP_PORT`、`MCP_LEGACY_SSE`、`MCP_JSON_RESPONSE`、`MCP_CORS_ORIGIN`、
  `MCP_MAX_SESSIONS`、`MCP_MAX_BODY_BYTES`、`SSE_API_BASE`、`PUBLIC_API_BASE`。

### 6. C：OpenAPI（非 MCP Agent）

- `packages/api/src/openapi.ts`：OpenAPI 3.1 文档，覆盖 19 个 Agent 相关端点。
- `GET /openapi.json`（公开）+ `GET /openapi`（跳转）。
- 统一接入：`POST /auth/api-key-login`（key→JWT）→ 之后 `Authorization: Bearer <accessToken>`。
- 新增契约测试 `packages/api/src/__tests__/openapi.test.ts`（版本、必需路径、bearer 鉴权、`$ref` 完整性）。

### 7. 授权审计与加固（会话追加）

**审计结论**：发现 1 个高危 + 3 个中危，已修复：

- **高危 `query_expense_status` 无数据范围**：改为按 `resolveDataScope` 裁剪（员工本人 / 审批人本部门 / 管理财务全量）。
- **中危 角色 fail-open**：`search_expenses`、`get_statistics`、`enforceReadAccess` 改为白名单
  `resolveDataScope`；未知角色、审批人无部门一律 `deny`；`canViewReport` 不再让"空部门 == 空部门"放行。
- **中危 附件写权限**：`upload_invoice` 改走新增 `assertReportWriteAccess`（本人/财务/管理员）；
  `verify` 保留审批人非强制核对，`force` 重识别仅限本人/财务/管理员。
- **中危 key 失效滞后**：MCP 端 `mcp_api_keys` 每 `MCP_KEY_REFRESH_MS`（默认 60s）刷新，
  角色/部门以 `users` 表为准，禁用用户、停用 key 自动失效；`/auth/api-key-login` 也改为按用户当前角色签发 JWT。
- 新增 `resolveDataScope` / `canWriteReport` 于 `@sse/auth`，补 10 个 RBAC 测试。

### 8. P3 运维加固（会话追加）

- **速率限制**：`@sse/auth` 新增固定窗口限流，`server.ts` 按 `userId` 计数
  （`MCP_RATE_LIMIT_PER_MIN`，默认 120/分钟），超限返回 `RATE_LIMITED`。
- **审计日志**：每次工具调用输出一条 stderr JSON（`[mcp-audit]`，`MCP_AUDIT_LOG=0` 可关），
  含工具、用户、角色、耗时、结果；**不写 stdout**，避免污染 stdio JSON-RPC。
- **本体查询约束**：`get_entity_network` 的 `depth` 限制在 0–5；`executeSparql` 增加查询长度、
  图模式数量、结果上限（`MCP_SPARQL_MAX_RESULTS`，默认 1000，尊重更小的 LIMIT），
  并移除会污染 stdio 的 `console.log`。
- **key 过期**：迁移 `014_mcp_api_key_expiry.sql` 增加 `expires_at`；`/auth/api-key-login`
  与 MCP key 刷新均拒绝过期 key。
- 仍未做：key 作用域（scope）、轮换端点、哈希存储（需 schema + 管理端改造）。

---

## 二、验证结果

```
pnpm build  → 11 个包全部 Done
pnpm test   → core 41 · auth 19 · db 13 · ai 100 · notifications 29 · ontology 14 · api 32
              合计 248 passed / 0 failed（新增 api OpenAPI 4、RBAC 10、限流 4、SPARQL 6）
```

冒烟验证：

- Streamable HTTP（`:3099`）：`/healthz` 正常；`initialize` 返回 2025-06-18 + session id；
  `tools/list` 返回 18 个工具。
- stdio：`initialize` + `tools/list` 返回 18 个工具。
- `GET /openapi.json`：HTTP 200、`openapi: 3.1.0`、19 个路径、JSON 可解析（无 DB 也可访问该端点）。

---

## 三、部署与迁移

```bash
git pull
pnpm install        # 新增 @modelcontextprotocol/sdk 1.x 与 zod，不可跳过
pnpm build
# 重启 API；如启用 HTTP MCP，重启 MCP HTTP 服务
curl -s http://127.0.0.1:3001/healthz
```

- 无数据库迁移。
- **端点变化**：Streamable HTTP 使用 `:3001/mcp`；旧 SSE 客户端改用 `:3001/sse`（或迁到 Streamable）。
- HTTP MCP 需要每个请求带 `Authorization: Bearer <mcp-api-key>`；不再有默认 key 兜底。

---

## 四、MCP 工具清单（18）

只读：`search_expenses`、`get_expense_detail`、`get_approval_status`、`get_statistics`、
`get_user_summary`、`list_pending_approvals`、`query_expense_status`、`explain_decision`、
`validate_expense`、`query_ontology`、`get_entity_network`、`query_sparql`。

写入：`submit_expense_from_text`、`submit_expense_from_invoice`、`approve_expense`、
`reject_expense`、`upload_invoice`、`verify_expense`。

---

## 五、下一会话待办

### P0：密码安全（仍未修）

- `packages/api/src/routes/auth.ts` 登录只校验手机号存在与状态，**完全不校验密码**。
- `packages/api/src/routes/admin.ts` 创建用户时忽略传入的 `password`。
- `packages/api/src/routes/auth.ts` 修改密码明文写入 `password_hash`（无 bcrypt）。

### P1：Agent 接入加固

- 为 `@sse/mcp` 增加独立测试（目前仍以构建 + 现有套件验证）。
- MCP key 治理：过期、限流、审计、刷新已完成；作用域、轮换端点、哈希存储待办。
- 工具契约：`outputSchema`、`annotations`（只读/破坏性提示）、统一错误信封。
- 更新 `docs/2026-07-29-mcp-test-cases.md` 与 `docs/2026-07-31-mcp-pi-test-cases.md`（14 → 18 工具、HTTP 传输）。

### P2：其余

- 历史打款回单批量重识别（新管线 + 千分位解析）。
- 附件路径 bucket 重复（`/invoices/invoices/...`）、扫描件 PDF 规范化。

---

## 六、本次提交记录

| Commit | 说明 |
|---|---|
| `55fb5eb` | feat(mcp): add agent tooling, Streamable HTTP and safe auth |
| `9d7a697` | feat(api): expose OpenAPI 3.1 spec for REST agents |
| `63fded4` | docs: update deployment, README and process notes |
| `a0dbadb` | fix(mcp): harden role scoping and API-key freshness |
| 本提交 | fix(mcp): add rate limiting, audit logs and query guards |

---

## 七、当前状态

- `master` 已包含上述两个功能提交并推送。
- 外部 Agent 可任选：**Streamable HTTP MCP（`/mcp`）** 或 **OpenAPI REST（`/openapi.json`）**，
  两者共用同一套 API key → 角色/部门数据范围。
- Agent 已能完成：发票 OCR 建单 → 发票入库 → AI 核对 → 读摘要 → 审批/驳回 → 查询统计。
