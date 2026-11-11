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

- 数据库迁移：`014_mcp_api_key_expiry.sql`（`mcp_api_keys.expires_at`）；其余无迁移。
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

- **下一次会话优先：MCP key 治理剩余项**（本次已完成 过期 / 限流 / 审计 / 刷新）：
  - 作用域（read / write / admin）：新增 `scopes` 列，并在工具入口按 scope 校验。
  - 轮换端点：`POST /admin/mcp-keys/:id/rotate`（或新增管理端接口），生成新 key、停用旧 key。
  - 哈希存储：新增 `key_hash` 列、迁移现有明文 key、查询改为按哈希匹配。
  - 前置：管理端 MCP key 管理页/接口（目前只能直接改 `mcp_api_keys` 表）。
- 为 `@sse/mcp` 增加独立测试（目前仍以构建 + 现有套件验证）。
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
| `5090a48` | feat(mcp): add rate limiting, audit logs and query guards |

---

## 七、当前状态

- `master` 已包含上述提交并推送（最新 `5090a48`）。
- 授权审计加固（P1/P2）与 P3 运维加固（限流、审计、查询约束、key 过期）已完成。
- 外部 Agent 可任选：**Streamable HTTP MCP（`/mcp`）** 或 **OpenAPI REST（`/openapi.json`）**，
  两者共用同一套 API key → 角色/部门数据范围。
- Agent 已能完成：发票 OCR 建单 → 发票入库 → AI 核对 → 读摘要 → 审批/驳回 → 查询统计。
- 未完成（下一会话）：MCP key 作用域、轮换端点、哈希存储；P0 密码安全。

---

## 八、本体 v2：影子比对、健康检查与安全下线（Phase 7）

**架构**：PostgreSQL 仍是系统记录源。行触发器把映射表的变更写入
`ontology_outbox`；API 进程内的 `GraphProjector` 把事件投影到嵌入式 Oxigraph
图，并按版本写入 `ontology_graph_snapshots`。`ONTOLOGY_V2=0|shadow|on` 控制
行为：`0` 保持旧路径，`shadow` 双写并按 SQL 真值比对，`on` 使用 v2 图查询。

### 影子比对（shadow）

- 新增 `packages/ontology/src/projection/shadow.ts`：直接以 PostgreSQL 为真值，
  不依赖旧的 `SemanticMapper`。
- 每张表比对 `COUNT(*)` 与图节点数；按 id keyset 抽样 200 行比对白名单字段；
  比对状态分布与 6 个关系计数（`submittedBy`、`containsItem`、`hasCategory`、
  `hasInvoice`、`hasApproval`、`hasPaymentReceipt`）。
- `ONTOLOGY_V2=shadow` 时启动即执行，之后每
  `ONTOLOGY_SHADOW_INTERVAL_MS`（默认 300000）执行一次，stderr 输出
  `[ontology-shadow]`，结果挂在 `GET /ontology/status.shadow`（仅 admin）。

### 状态、指标与健康

- `GET /ontology/status`：`engine`、`counts`、`outbox`、`version`，shadow 模式
  额外返回 `shadow: { equal, differences, checkedAt }`（admin-only）。
- 投影器每次处理事件输出
  `[ontology-projector] {"processed":n,"failed":n,"lag_ms":n,"duration_ms":n}`，
  不输出行内容。
- `GET /health` 与 `GET /healthz`：`ONTOLOGY_V2=on` 且
  `outbox.oldestPendingAgeSeconds > 300` 时返回 503；其余情况保持 200。
  非 v2 的 health 载荷不变。

### 兼容与安全下线

- `SemanticMapper.syncReportToOntology` / `syncAll` 在 `on|shadow` 下为 no-op，
  仅输出弃用日志；`0` 时保持旧行为。
- `GET /ontology/sync` 在 `on` 时触发 reconcile job；`GET /ontology/query?type=`
  和 `GET /ontology/graph` 在 `on` 时返回 v2 视图（旧 `[{uri,properties}]` /
  图结构保持兼容），`0` 时回退旧实现。
- `ensureOntologyLoaded` 仍保留（提交类工具仍在用），但 v2 下不再加载旧快照。
- `executeSparql`、`OwlStore` 和旧端点**暂不删除**，保证 `ONTOLOGY_V2=0`
  可回滚；完整删除需在 24h 生产 shadow 通过且有一个干净发布后进行，详见
  `docs/2026-11-10-ontology-v2-runbook.md`。

### 端点与工具速查

| 类型 | 名称 |
|---|---|
| 状态 | `GET /ontology/status`（含 `shadow`）、`GET /health`、`GET /healthz` |
| 查询 | `GET /ontology/entities[?type=]`、`POST /ontology/query`、`POST /ontology/sparql` |
| 证据 | `POST /ontology/explain`、`POST /ontology/validate`、`POST /ontology/impact`、`GET /ontology/anomalies` |
| 运维 | `POST /ontology/reconcile`、`GET /ontology/reconcile/:jobId`、`GET /ontology/sync` |
| MCP | `query_ontology`、`get_entity_network`、`query_sparql`、`explain_expense`、`impact_analysis`、`find_anomalies`、`get_ontology_schema` |

环境变量已补入 `.env.example`：`ONTOLOGY_V2`、`ONTOLOGY_PROJECT_INTERVAL_MS`、
`ONTOLOGY_SNAPSHOT_INTERVAL_MS`、`ONTOLOGY_SPARQL_TIMEOUT_MS`、
`ONTOLOGY_SPARQL_MAX_RESULTS`、`ONTOLOGY_OUTBOX_RETENTION_DAYS`、
`ONTOLOGY_ANOMALY_INTERVAL_MS`、`ONTOLOGY_MAX_OUTBOX_BATCH`、
`ONTOLOGY_GRAPH_CALL_TIMEOUT_MS`、`ONTOLOGY_SHADOW_INTERVAL_MS`。
