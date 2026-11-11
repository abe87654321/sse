# SSE 会话交接与进度（2026-11-10 ~ 2026-11-11）

> 用途：下次重开会话时先读本文件，再按“下一步”继续。不要在这里记录任何真实密码、API key 或 token。

## 一、当前代码状态

- 分支：`master`
- 当前 HEAD / origin/master：`3d5d2a9 fix(ontology): fix preflight uuid query and document admin recovery`
- 本体 v2 合并提交：`e1cbba0 merge: ontology v2 platform overhaul and P0 security fixes`
- 工作区：仅剩原有未跟踪的 `docs/handover-docs/*`，未提交、未改动。
- 测试：`pnpm -r build` 通过；`pnpm -r test` 595 tests，0 failures。
  - ontology 170、api 123、mcp 56、web 25、core 41、auth 30、db 21、ai 100、notifications 29。

## 二、本次已完成

### 1. 本体 v2（Phase 0-7）

- PostgreSQL 仍是记录源；触发器写入 `ontology_outbox`，API 内 projector 投影到嵌入式 Oxigraph，版本化快照存 `ontology_graph_snapshots`。
- 真实 SPARQL 1.1（join/FILTER/GROUP BY/ORDER BY/LIMIT），worker 超时/重启恢复。
- 8 张表全部映射：users、expense_categories、expense_reports、expense_items、invoices、approval_rules、approval_records、payment_receipts。
- CONSTRUCT 规则、SHACL、explain/validate/impact/anomalies（v1 三个异常检查）。
- 类型化查询、scope 隔离、分页、`/ontology/graph`、`/ontology/status`、reconcile job。
- MCP 22 个工具；本体读工具全部改为 API 瘦客户端，新增 explain/impact/anomalies/schema。
- Web 本体工作台：图谱、证据链、校验、影响分析、异常、同步健康、手动图。
- shadow SQL 真值比对、health/healthz lag 检查、单 API 副本约束、安全下线别名。

### 2. P0 密码安全

- 登录 bcrypt 校验；改密校验旧密码；管理员建用户必须提供密码。
- 登录限流 10 次/15 分钟；先验密码再判断禁用状态，避免账号枚举。
- bcrypt 72 UTF-8 字节限制；`BCRYPT_ROUNDS` 限制 10-14。
- SCIM/MDM 哨兵值永久不可登录；迁移 `018` 清理历史哨兵；SCIM/Webhook 增加服务令牌。
- 默认管理员 seed hash 已修正；旧库需手动重置管理员密码（测试机已做）。

### 3. 文档与 cutover 物料

- `README.md`：Ontology v2、22 个 MCP 工具、单副本要求、回滚。
- `docs/2026-11-09-sse-deployment.md`：nginx `X-Forwarded-For`、`TRUST_PROXY`、本体 v2 部署说明。
- `docs/2026-11-10-sse-process.md`：P0 修复、Phase 7、执行进度。
- `docs/2026-11-10-ontology-v2-runbook.md`：回填、24h shadow、cutover、rollback、认证、死信。
- `docs/2026-11-10-ontology-v2-cutover-checklist.md`：10 步生产清单。
- `deploy/preflight-ontology-v2.sql`：只读预检；已修复 `MIN(uuid)` 报错。
- `docs/superpowers/plans/2026-11-10-ontology-platform-overhaul.md`：完整计划 + 执行状态。

## 三、测试机当前状态

路径：`szl@ubuntuhome:~/projects/sse`

已完成：

- 备份：`backups/sse-2026-11-11-0424.dump`
- 迁移 `015`-`018` 已应用。
- `outbox_enabled=false`，`pending=0`，`dead_letter=0`，尚无快照（shadow 启动前正常）。
- 实体计数正常：users 7、reports 4、items 11、invoices 8、rules 3。
- 5 条 legacy 状态 CONSTRUCT 规则已启用。
- 管理员 `13800000000` 密码已通过 bcrypt 直接写入重置（密码不记录在文档）。
- preflight 已重新执行并修复 `MIN(uuid)`；`has_legacy_default_hash` 应为 false。
- 已进入 `ONTOLOGY_V2=shadow`，基础健康和登录验证通过（用户反馈）。
- 尚余 6 个 `!` 哨兵用户（SCIM/MDM/无密码）；如需密码登录，在 Admin → Users 逐个重置。

尚未记录/尚未完成：

- 24h shadow 门禁的连续 `shadow.equal=true` 结果。
- 22 个 MCP 工具完整冒烟结果。
- 切 `ONTOLOGY_V2=on` 及切换后监控。
- `.env` 中 `$` 值造成的 `docker compose` 警告（`jFK/G/g`）是否已清理。

## 四、下次会话先做什么

1. 拉取最新代码并确认版本：

```bash
cd ~/projects/sse
git fetch origin
git checkout master
git pull --ff-only
git rev-parse --short HEAD     # 应为 3d5d2a9 或更新
```

2. 检查 shadow 状态（用管理员 token）：

```bash
curl -s -H "Authorization: Bearer $TOKEN" \
  http://127.0.0.1:3000/ontology/status | python3 -m json.tool
```

要求：

- `shadow.equal = true` 连续多次。
- `outbox.pending = 0`。
- `outbox.deadLettered = 0`。
- `failuresLastHour = 0`。
- `counts.quads` / `counts.subjects` 稳定。

3. 如果 24h gate 通过，按 `docs/2026-11-10-ontology-v2-cutover-checklist.md`：
   - 切 `ONTOLOGY_V2=on`。
   - 重启 API + MCP。
   - 监控 lag、dead letters、counts、`/healthz`、Web。
4. 切 `on` 后做认证与 MCP 冒烟：
   - 错误密码 401；连续失败 429。
   - 管理员新建用户可登录。
   - SCIM/MDM 无 token 401/503。
   - 22 个 MCP 工具、员工 `query_sparql` FORBIDDEN、失效 key UNAUTHORIZED。
5. 如异常，回滚：

```bash
sed -i 's/^ONTOLOGY_V2=.*/ONTOLOGY_V2=0/' .env
docker compose exec -T postgres psql -U sse -d sse \
  -c "UPDATE ontology_settings SET value='false' WHERE key='outbox_enabled';"
# 重启 API
curl -s -H "Authorization: Bearer $TOKEN" http://127.0.0.1:3000/ontology/sync
```

## 五、已知约束与后续项

- **单 API 副本**：`ONTOLOGY_V2=shadow|on` 时，每个 API 进程持有独立内存图；只允许一个 API 副本。
- **PII allowlist**：outbox 仍是 denylist + 图字段白名单；生产前建议按表 allowlist。
- **reconcile 主线程**：大数据量时可能阻塞 event loop；建议低峰或单独实例执行。
- **MCP HTTP**：`pnpm dev` 只起 MCP stdio；HTTP MCP 需单独 `pnpm mcp:http`。
- **`pnpm dev` 与本体**：`pnpm dev` 会启动 API/Web/MCP；本体 projector 仅在 `.env` 的 `ONTOLOGY_V2=shadow|on` 时随 API 启动；DB/MinIO 和迁移仍需单独执行。
- **`.env` 特殊字符**：`SCIM_TOKEN`/`MDM_TOKEN`/`WEBHOOK_TOKEN` 实际含 `& * @ ! # % ^`（**不含 `$`**）；shell 用 `set -a; . ./.env` 会因未加引号的 `&`/`#` 截断赋值。给值加单引号，或用安全解析器。Docker Compose 仍会对 `$` 插值，bcrypt hash 不要放 `.env`。
- **默认管理员**：已轮换；不要恢复 `admin123`。
- **旧 legacy 路径**：`executeSparql`、`OwlStore`、旧端点保留用于 `ONTOLOGY_V2=0` 回滚；完整删除需在生产 shadow 通过且一个干净发布后执行。

## 六、关键文件

- 计划：`docs/superpowers/plans/2026-11-10-ontology-platform-overhaul.md`
- Runbook：`docs/2026-11-10-ontology-v2-runbook.md`
- Cutover checklist：`docs/2026-11-10-ontology-v2-cutover-checklist.md`
- 预检 SQL：`deploy/preflight-ontology-v2.sql`
- ADR：`docs/adr/2026-11-10-ontology-graph-projection.md`
- 部署文档：`docs/2026-11-09-sse-deployment.md`
- 过程记录：`docs/2026-11-10-sse-process.md`

## 七、本轮执行结果（2026-11-11，门禁 + MCP 冒烟）

> 测试机：`szl@ubuntuhome`（192.168.3.107），仓库 HEAD `3d5d2a9`。本机 Windows 的 SSH known_hosts 已更新；测试机主机密钥为 2026-11-06 生成，指纹已与 `/etc/ssh/ssh_host_ed25519_key.pub` 核对一致。

### 1. 24h shadow 门禁（进行中）

- API 于 `2026-11-11 11:36:13 UTC` 由 `pnpm dev` 重启，PID `4056009`，进程环境 `ONTOLOGY_V2=shadow`；`.env` 已改为 `ONTOLOGY_V2=shadow`。
- 重启后 shadow 正常：`engine=oxigraph`、`counts.quads=661`、`subjects=119`、`outbox.pending=0`、`deadLettered=0`、`failuresLastHour=0`、`shadow.equal=true`、`differences=[]`。
- 后台采样器：`/tmp/sse-shadow-gate.py`，PID `4040676`，每 5 分钟采样；日志 `/tmp/sse-shadow-gate.jsonl`，状态 `/tmp/sse-shadow-gate.state.json`，通过结果 `/tmp/sse-shadow-gate.result`。
- 采样器检测 API 进程标识；修复期间 API 多次重启，窗口多次重置。**最终门禁时间以本文件末尾“7. 当前门禁与下一步”为准**。
- 判定条件：`engine=oxigraph`、`counts.quads>0`、`outbox.pending=0`、`deadLettered=0`、`oldestPendingAgeSeconds<300`、`failuresLastHour=0`、`shadow.equal=true`、`shadow.checkedAt` 不陈旧、API 进程标识不变。
- 停止：`kill $(cat /tmp/sse-shadow-gate.pid)`；机器重启后采样器不会自动恢复。

### 2. MCP 22 工具冒烟（读/注册/鉴权）

使用 Streamable HTTP（`http://127.0.0.1:3001/mcp`）：先 `initialize` 拿 `Mcp-Session-Id`，再 `tools/list` / `tools/call`。结果：**25 PASS / 1 WARN / 0 FAIL**。

- `tools/list`：22 个工具名完全匹配。
- 通过：`search_expenses`、`get_statistics`、`get_user_summary`、`list_pending_approvals`、`query_ontology`、`get_ontology_schema`、`find_anomalies`、`impact_analysis`、`validate_expense`、`query_sparql`、`get_expense_detail`、`get_approval_status`、`explain_decision`、`explain_expense`、`get_entity_network`。
- `query_expense_status`：最初因 MCP 默认 10s 超时 WARN；将 `MCP_TOOL_TIMEOUT_MS=180000` 后通过（约 44.7s）。AI 使用 `http://192.168.3.110:8000` / `qwen3.6-35b`；35B 思考模型较慢，生产建议 `MCP_TOOL_TIMEOUT_MS>=120000`。
- 写工具必填参数校验全部通过（未产生数据）：`submit_expense_from_text`、`submit_expense_from_invoice`、`approve_expense`、`reject_expense`、`upload_invoice`、`verify_expense` → `INVALID_PARAMS`。
- 鉴权：employee `query_sparql` → `FORBIDDEN`；无效 key `initialize` → HTTP 401。
- `pnpm dev` 只启动 stdio MCP；HTTP MCP 需单独 `pnpm mcp:http`。冒烟时临时启动，PID `4064689`。

### 3. 真实写冒烟发现的阻断

1. **P0：所有建单失败（PostgreSQL 42703）**
   - `PgExpenseRepo.create` 的 INSERT 写入 `expense_reports.description`，但 `001_initial.sql` 和当前测试库都没有该列。
   - 证据：`packages/db/src/repositories/pg-expense-repo.ts:177`；`POST /expenses` 返回 `500 {"code":"42703"}`。
   - Web `ExpenseForm.vue`、`CreateReportDto`、`mapReport` 都使用报告级 `description`，判断为**漏迁移**。建议新增迁移：
     `ALTER TABLE expense_reports ADD COLUMN IF NOT EXISTS description TEXT NOT NULL DEFAULT '';`
     或最小修复：从 INSERT 去掉 `description`（会丢失报告级描述）。
2. **P1：类别匹配方向错误**
   - AI 返回 `住宿费`/`餐饮费`，DB 类别是 `住宿`/`餐饮`；代码用 `name ILIKE '%<extracted>%'`，方向反了。
   - 证据：`packages/ontology/src/index.ts:78`、`packages/mcp/src/tools/submit-expense-from-invoice.ts:111`。
   - 建议：取回类别列表后在 JS 中双向匹配并去掉尾部“费”，或 SQL 改为
     `$1 ILIKE '%' || name || '%' OR name ILIKE '%' || $1 || '%'`；同时把 `entity-extractor.ts` 提示词中的类别改为 DB 实际名称（交通/住宿/餐饮/招待/办公用品/通讯/培训/其他）。
3. **已知限制：PDF OCR 是 stub**
   - `submit_expense_from_invoice` 返回 `OCR_FAILED`；`packages/ocr/src/pdf.ts` 明确返回 `unverified`，需要外部 OCR 服务。不是本次冒烟引入的回归。
4. 由于第 1 条，`upload_invoice`、`verify_expense`、`approve_expense`、`reject_expense` 未能端到端执行；本轮未产生测试报销单。

### 4. `.env` 特殊字符（更正）

- `SCIM_TOKEN`、`MDM_TOKEN`、`WEBHOOK_TOKEN` **不含 `$`**；实际特殊字符为 `& * @ ! # % ^`。
- shell 用 `set -a; . ./.env` 加载时，未加引号的 `&` 会截断赋值，`#` 会当注释，导致 `command not found`。
- 处理：给值加单引号，或用安全解析器（本轮用 Python `shlex.quote` 逐行 `export`）。项目未安装 `dotenv`，不要依赖它。

### 5. 下一步

1. 修复 P0/P1 后重建并重启 `pnpm dev`。
2. 重跑写冒烟：建单 → 上传 PDF → 核对 → 财务审批；再建单 → 驳回；`submit_expense_from_invoice` 仍会 `OCR_FAILED`（需接 OCR）。
3. 24h 门禁继续（API 重启会重置窗口），通过前不要切 `ONTOLOGY_V2=on`。
4. 清理临时 HTTP MCP：`kill $(cat /tmp/sse-mcp-http.pid)`。

### 6. 修复与重跑（2026-11-11 11:51–12:03 UTC）

已按建议修复并在测试机验证：

| 问题 | 修复 | 文件 |
|---|---|---|
| P0 建单 42703 | 新增迁移 `019_expense_report_description.sql`，给 `expense_reports` 加可空 `description TEXT` | `packages/db/src/migrations/019_expense_report_description.sql` |
| P1 类别匹配 | 去掉尾部“费”并双向匹配 DB 类别；提示词改为实际类别名 | `packages/ontology/src/index.ts`、`packages/mcp/src/tools/submit-expense-from-invoice.ts`、`packages/ontology/src/entity-extractor.ts` |
| P1 审批 approver_id | `startApproval`/`createNextStep` 优先使用 `assigneeId`，不再把角色名写入 UUID 列 | `packages/core/src/services/approval-engine.ts` |
| P1 审批权限 | approve/reject 用 `userId` 与 `approverId` 比较，不再用角色字符串 | `packages/api/src/routes/approvals.ts` |

验证：

- `pnpm -r build` 通过；`pnpm -r test` 通过（API 123、MCP 56，其余包全绿）。
- 迁移 019 已应用：`schema_migrations` 有 `019_expense_report_description`，`expense_reports.description` 存在（nullable）。
- 写冒烟最终结果：**8 PASS / 1 WARN / 0 FAIL**。`query_expense_status`、`submit_expense_from_text` A/B、`get_expense_detail`、`upload_invoice`、`verify_expense`、`approve_expense`、`reject_expense` 全部通过；`submit_expense_from_invoice` 仍为已知 `OCR_FAILED`（PDF OCR stub）。
- 测试数据：`RE-20261111-535`（approved）、`RE-20261111-581`（rejected）；另有失败尝试留下的草稿 `RE-20261111-646`、`RE-20261111-145`。均为“MCP冒烟测试”，可按需清理。
- 100 元“住宿”走兜底规则（admin 审批）；50 元“餐饮”走小额度规则（finance 驳回）。这是现有 `approval_rules.category_ids` 配置，不是代码问题。

### 7. 当前门禁与下一步

- 修复期间 API 多次重启，门禁窗口被重置。最终 API 于 `2026-11-11 12:01:14Z` 启动（PID `4105012`，shadow）；采样器在 `12:07:44Z` 前后写入新的 `first_clean_at`，预计 `2026-11-12T12:07:44Z`（北京时间 20:07:44）通过。以 `/tmp/sse-shadow-gate.state.json` 为准。
- **不要再重启 API**，否则门禁窗口再次重置。
- 通过后按 cutover checklist 切 `ONTOLOGY_V2=on`，重启 API + MCP，再做一次 MCP 冒烟和 `/healthz`、`/ontology/status` 监控。
- 临时 HTTP MCP 仍在运行（PID `4095838`）；如不继续冒烟可 `kill $(cat /tmp/sse-mcp-http.pid)`。
- 代码修复已在测试机工作区（未提交）和本机工作区（未提交）。如需固化，按仓库风格提交并推送后再在测试机 `git pull`；当前未执行 commit/push。
