# SSE 会话交接与进度（2026-11-10 ~ 2026-11-11）

> 用途：下次重开会话时先读本文件，再按“下一步”继续。不要在这里记录任何真实密码、API key 或 token。

## 一、当前代码状态

- 分支：`master`
- 当前 HEAD / origin/master：`208075d fix(web): hide opaque graph labels and restore drag spring-back`
- 本体 v2 合并提交：`e1cbba0 merge: ontology v2 platform overhaul and P0 security fixes`
- 工作区：仅剩原有未跟踪的 `docs/handover-docs/*`，未提交、未改动。
- 测试：`pnpm -r build` 通过；上次数值 `pnpm -r test` 595 tests，0 failures。
  - ontology 170、api 123、mcp 56、web 25、core 41、auth 30、db 21、ai 100、notifications 29。
  - 本轮新增 12 个 web 用例（`graph-view-state` 7 个、`utils` 5 个），本机未安装 `vitest`，待测试机执行确认。

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
- 代码修复已提交并推送：`741375b`（修复）+ `b86f4ce`（文档）；测试机已 `git fetch && git reset --hard origin/master` 到 `b86f4ce`。

## 八、本体工作台 UI 修复（2026-11-11 12:56–13:10 UTC）

提交：`7a5c53e fix(web): fill ontology graph canvas and restore legend`（随后推送）。

### 1. 图例

- 恢复图下方独立“图例”卡片，按当前图中出现的类型动态生成，颜色复用当前 `COLORS`/`SHAPES`。
- 新增 `packages/web/src/components/ontology/graph-style.ts` 统一维护颜色、形状和中文类型名；补充了 `ExpenseCategory (费用类别)`。
- 图例位置/配色按确认：图下方独立卡片 + 当前图谱配色。

### 2. 灰色遮挡根因与修复

- 现象不是 tooltip，而是 vis-network 画布没有铺满容器：`.graph-canvas` 高 460px，但 `.vis-network` 仅 156.8px、canvas 缓冲区仅 150px，下面显示的是 `.graph-canvas` 的 `#fafbfc` 背景。
- 根因：`.graph-canvas` 是 `flex: 1 1 0%` 的 flex 子项，子元素 `height: 100%` 未解析到 460px，vis-network 初始化时按 157px 建画布。
- 修复：增加 `.graph-canvas-wrap` 固定 560px 高度；`.graph-canvas` 填满 wrapper；增加 `ResizeObserver` 调用 `network.setSize()`/`redraw()`；布局稳定后 `network.fit()`。
- 验证（Playwright + Edge）：`.graph-canvas` 661×560，`.vis-network` 659×558，canvas 缓冲区 659×558；灰色块消失，节点铺满。

### 3. 悬停浮层

- 移除节点 `title`（vis-network 内置灰色 tooltip 来源），改为自定义 `.graph-tooltip`。
- 另发现：vis-network 初始化会清空 `.graph-canvas` 子节点，Vue 的 `v-if` 锚点被移除，浮层无法插入；已把浮层移到 canvas 外层 wrapper。
- 行为：悬停节点显示“类型 + 中文名 + 最多 6 个属性”，`pointer-events: none`，3 秒后自动消失；移出/点击/拖拽/缩放立即隐藏。
- 验证：悬停出现 `ExpenseItem · 费用明细` 浮层，内置 `.vis-tooltip` 数量 0，3.6s 后消失。

### 4. 验证与状态

- `pnpm --filter @sse/web build` 通过；测试机 `pnpm --filter @sse/web test`：5 个文件、25 个用例全部通过。
- 测试机 Vite 已热更新；刷新 `http://192.168.3.107:5173/ontology` 可见。
- 改动文件：`GraphExplorer.vue`、`graph-style.ts`（新）、`Ontology.vue`。

### 5. 当前门禁（下次会话直接看这里）

- API：`2026-11-11 12:01:14Z` 启动，PID `4105012`，`ONTOLOGY_V2=shadow`，之后未重启。
- 门禁：`first_clean_at = 2026-11-11T12:07:44Z`；最近样本 `13:07:46Z` clean，已连续约 1 小时。
- 预计通过：`2026-11-12T12:07:44Z`（北京时间 20:07:44）。以 `/tmp/sse-shadow-gate.state.json` 为准。
- 当前 `/ontology/status`：`version=9`、`quads=673`、`subjects=131`、`pending=0`、`deadLettered=0`、`failuresLastHour=0`、`shadow.equal=true`、`checkedAt=13:11:20Z`。
- **不要再重启 API**；通过后按 cutover checklist 切 `ONTOLOGY_V2=on`，重启 API + MCP，再做冒烟和监控。
- 测试报销单已全部清理（`DELETE 4`，查询回到 4 条）；MinIO 两个测试发票对象由用户自行删除。

## 九、本体工作台前端交互修复（2026-11-11 后续）

提交：

- `66491c0 fix(web): lay out ontology graph filters horizontally`
- `1b8551a feat(web): persist ontology graph view state`
- `208075d fix(web): hide opaque graph labels and restore drag spring-back`

### 1. 工具栏横向排列

- 根因：全局 `select { width: 100% }` 让工具栏四个下拉各占一行。
- 修复：`GraphExplorer.vue` 的 scoped 样式给工具栏 `select` 设置 `width: auto; flex: 0 0 auto`，深度下拉保留 `max-width: 96px`。
- 窄屏仍由现有 `flex-wrap` 换行。

### 2. 图谱状态持久化

- 新增 `packages/web/src/components/ontology/graph-view-state.ts`，sessionStorage key `sse:ontology-graph:v1`。
- 保存内容：类型/状态/部门/搜索、深度、视口（scale + position）、选中节点 URI。
- `Ontology.vue` 图谱面板由 `v-if` 改为 `v-show`，工作台标签切换不再销毁 vis-network 实例。
- 刷新或重新进入 `/ontology`：恢复筛选/深度/视口/选中节点，并在图数据加载后重新拉取右侧详情；失效节点自动清除。
- 视口在节点稳定后 `moveTo` 恢复；恢复期间禁止写回。退出登录时清理该 sessionStorage。
- 单测：`__tests__/graph-view-state.test.ts`（7 个用例）。

### 3. 标签与拖动回弹

- 标签：`entityLabel` 增加 opaque ID 识别（UUID、`item/<uuid>`、checksum、24+ 位长串），并把 `description`/`invoiceNo`/`paymentRef` 提到 `node.label` 之前；全部无意义时节点不显示文字。`normalizeGraph`/`normalizeNetwork` 同步改用 `entityLabel`。
- 回弹：节点 `dragStart` 临时开启 physics，`dragEnd` 后保留约 900ms 再关闭；平移画布不触发。恢复旧版本拖动时的力导向回弹效果，同时避免常驻物理模拟。
- 单测：`utils.test.ts` 新增 5 个用例（opaque ID 与标签回退）。

### 4. 下一步

1. 测试机 `git fetch origin && git reset --hard origin/master`（当前应为 `208075d`），刷新 `http://192.168.3.107:5173/ontology` 验证：
   - 工具栏四个下拉横向排列；
   - 切到校验/影响分析/异常再回图谱，筛选、深度、缩放、平移、选中详情保持；
   - 刷新页面后上述状态恢复；
   - 费用明细显示描述、发票显示发票号，UUID 不再出现在图上；
   - 拖动节点有回弹效果，约 900ms 后停止。
2. 测试机执行 `pnpm --filter @sse/web test` 确认新增用例。
3. shadow 24h 门禁不变，仍以第八节第 5 条为准；**不要重启 API**。
4. 门禁通过后再按 cutover checklist 切 `ONTOLOGY_V2=on`。

## 十、第 1 项验证完成（2026-11-12 11:00 UTC）

> 测试机 `szl@ubuntuhome`（192.168.3.107），HEAD `208075d`，API PID `4105012`（`ONTOLOGY_V2=shadow`，本轮未重启），Web `http://192.168.3.107:5173` 返回 200。

### 1. 单元测试

- 命令：`pnpm --filter @sse/web test`
- 结果：6 个文件 / 37 个用例全部通过（含 `graph-view-state` 7 个、`utils` 10 个）。

### 2. Playwright 交互验证（34 PASS / 0 FAIL / 0 WARN）

浏览器：Chromium/Edge，视口 1440×900；脚本仅做登录、读图、切标签、刷新和拖拽，未写业务数据。

| 验证点 | 结果 |
|---|---|
| 工具栏 4 个下拉横向同排（tops 均为 225） | PASS |
| 工具栏下拉为自适应宽度（113/64/64/50，非 100%） | PASS |
| 费用明细标签显示描述而非 UUID | PASS |
| 发票标签显示发票号（如 `26112000004865189101`） | PASS |
| 节点可点击选中 | PASS |
| 类型/状态/部门/深度(3)/缩放平移写入 `sse:ontology-graph:v1` | PASS |
| 切 校验→影响分析→异常→图谱 后筛选/深度/视口/选中保持 | PASS |
| 切标签不销毁 vis-network（`v-show`，canvas 实例标记保持） | PASS |
| 刷新页面后筛选/深度/选中/视口恢复 | PASS |
| 拖动节点有回弹（520ms 回移 43.7px），约 900ms 后静止 | PASS |
| 无未捕获异常 / 无控制台错误 | PASS |

- 截图存放：`C:\Users\Admin\AppData\Local\Temp\opencode\v2-0*.png`（本机临时目录，未入库）。
- 登录使用管理员账号，密码仅用于本次登录请求，未写入任何文件或本目录。

### 3. 门禁状态（11:05 UTC）

- 采样器正常：`last_ok=true`、`last_reasons=[]`；`api_identity.pid=4105012` 未变。
- `first_clean_at = 2026-11-11T12:07:44Z`，预计 `2026-11-12T12:07:44Z`（北京时间 20:07:44）生成通过结果。
- **仍不要重启 API**。

### 4. 下一步

1. 等 `/tmp/sse-shadow-gate.result` 生成且为通过。
2. 按 cutover checklist 切 `ONTOLOGY_V2=on`，重启 API + MCP。
3. 切换后做 MCP 冒烟、`/healthz`、`/ontology/status`、Web 监控。
4. 第 1 项已完成，无需再重复。

## 十一、Cutover 完成（2026-11-12 12:08–12:15 UTC）

### 1. 门禁结果

- `/tmp/sse-shadow-gate.result`：`verdict=PASS`、`ts=2026-11-12T12:08:21Z`、`elapsed_seconds=86437`、`window_seconds=86400`、`first_clean_at=2026-11-11T12:07:44Z`。
- `api_identity.pid=4105012` 在门禁窗口内未变；`last_ok=true`。
- 切换前备份：`backups/sse-pre-ontology-on-2026-11-12-1208.dump`（162K，`pg_restore --list` 校验通过）。

### 2. Cutover 操作

- `.env`：`ONTOLOGY_V2=shadow` → `on`。
- 重启 `pnpm dev`（API + Web + stdio MCP）；单独重启 HTTP MCP。
- **已修复（494578b）**：`pnpm mcp:http` 原先不加载 `.env`，导致 MCP 签名 JWT 的 `JWT_SECRET` 与 API 不一致，本体读工具转发 API 全部 401。现由 MCP 入口 `packages/mcp/src/env.ts` 在启动时加载仓库根 `.env`（`index.ts`/`http.ts` 首行引入，`dotenv` 已加入 `@sse/mcp` 依赖），stdio 与 HTTP MCP 都生效，无需 `--env-file`。

### 3. 切换中发现并修复的阻断（未提交）

- `/healthz` 在 `on` 模式恒返回 `503 degraded`，原因：`packages/api/src/services/health.ts` 把 `FILTER` 放在 `EXTRACT(...)` 上，PostgreSQL 报语法错误；shadow 模式不执行该分支，所以此前未暴露。
- 修复：把 `FILTER (WHERE processed_at IS NULL AND dead_letter = false)` 移到 `MIN(occurred_at)` 上。
- 验证：`pnpm --filter @sse/api test` 123 用例通过；重启后 `/healthz` 返回 `200 ok`。
- **当前状态**：本机与测试机该文件均为未提交修改（测试机 HEAD 仍为 `208075d`），需尽快提交，否则 `git reset --hard` 会丢失。

### 4. Cutover 后验证（12:14 UTC）

| 检查 | 结果 |
|---|---|
| `/ontology/status` | `engine=oxigraph`、`version=22`、`quads=840`、`subjects=148`、`pending=0`、`dead=0`、`lag=0`、`failuresLastHour=0` |
| `/healthz` | `200`、`status=ok`、`oldestPendingAgeSeconds=0` |
| `/ontology/graph` | 69 节点 / 95 关系 |
| 错误密码登录 | `401` |
| `POST /scim/Users` 无 token | `401` |
| `POST /webhook/mdm` 无 token | `401` |
| Web `/ontology` | `200` |
| 单副本 | 1 个 API ts-node 实例、1 个 HTTP MCP 实例 |

### 5. MCP 冒烟（16 PASS / 0 FAIL）

- `tools/list`：22 个工具，名称全部匹配。
- 本体读工具返回数据：`query_ontology`、`get_ontology_schema`、`find_anomalies`、`impact_analysis`、`query_sparql`、`explain_expense`、`get_entity_network`、`explain_decision`。
- 员工 key `query_sparql` → `FORBIDDEN`；无效 key `initialize` → HTTP `401`。
- 冒烟脚本从数据库读取现有 admin/employee key，运行时不打印密钥；脚本在测试机 `/tmp/mcp-smoke.mjs`（临时，未入库）。
- 未做写操作，未产生新业务数据。

### 6. 待办

1. `health.ts` 修复已提交（`e9f34e6`）；MCP 入口 dotenv 已提交（`494578b`），推送并同步测试机到 `494578b`。
2. MCP 复验：用**裸** `pnpm mcp:http`（不带 `--env-file`）重启后，日志出现 `injected env (37) from .env`，`/tmp/mcp-smoke.mjs` 16 PASS / 0 FAIL；`/healthz=200`、`quads=840`、`subjects=148`、`pending=0`、`dead=0`、`lag=0`。
3. 继续监控 `outbox.pending`/`deadLettered`/`lag`、`/healthz`、`counts.quads`；一个业务周期后可考虑 legacy 下线（cutover checklist §10，需再等一个干净发布）。
4. 生产部署同样需保证：单 API 副本、`TRUST_PROXY` 与 `X-Forwarded-For` 正确；MCP 入口现已自行加载 `.env`，但仍建议生产用编排器注入环境变量（dotenv 不覆盖已有值）。

## 十二、`.env` 清理与 JWT 轮换（2026-11-12 13:46 UTC）

- `.env` 中重复的 `ONTOLOGY_V2` 已去重，仅保留一行 `ONTOLOGY_V2=on`（第 23 行）。
- 示例占位 `JWT_SECRET` 已替换为 32 字节随机 hex（64 字符，**值不记录**）；旧 token 全部失效，用户需重新登录。
- 备份：`.env.bak-2026-11-12T13-46-50-909Z`；`.env` 与备份权限均为 `600`。
- 同时重启 API、stdio MCP、HTTP MCP 后验证：`/healthz=200`；`/ontology/status` 为 `engine=oxigraph`、`quads=840`、`subjects=148`、`pending=0`、`dead=0`、`lag=0`；`/ontology/graph` 69 节点 / 95 关系；MCP 冒烟 16 PASS / 0 FAIL。
- `DB_PASSWORD=sse_dev`、`MINIO_*=minioadmin`、`MCP_API_KEY=mcp_dev_key_001` 仍为测试机现有示例值，生产前必须替换。

## 十三、推理规则模块打通（2026-11-12 14:00 UTC）

提交：`010d160 feat(api): manage CONSTRUCT reasoning rules`、`cd5eadd feat(web): edit and preview CONSTRUCT reasoning rules`；测试机已同步到 `cd5eadd` 并重启 API。

### 1. 背景

- 5 条 `legacy-status-*` 规则的真实逻辑在 `construct_query`（SPARQL CONSTRUCT），`conditions/conclusion` 为 `{}`（旧版字段，仅 `ONTOLOGY_V2=0` 使用）。
- 原管理页只显示旧 JSON，且创建/更新不写 `construct_query`；通过 UI 新建的规则 `construct_query=NULL`，v2 RuleEngine 会忽略。

### 2. 变更

- `ReasoningRule` 类型与 `PgReasoningRuleRepo` 支持读写 `construct_query/severity/message`。
- admin API：create/update 支持这三列；新增 `POST /admin/reasoning-rules/preview`（`assertConstructQuery` 校验 + 只读执行，返回前 20 条样本，不落库）。
- `sparql-guard` 新增 `assertConstructQuery`（只允许只读 CONSTRUCT），并补充单测。
- legacy `/ontology/reason` 跳过带 `constructQuery` 的规则。
- Web 管理页：新增 CONSTRUCT 编辑框、severity/message、预览按钮、类型列；旧版 JSON 收进折叠区。

### 3. 验证

- 本地：`pnpm -r build` 通过；ontology 176、api 123、web 37 用例通过。
- 测试机 `cd5eadd`：`GET /admin/reasoning-rules` 返回 5 条且均含 `constructQuery`；paid 规则预览命中 5 条；SELECT 预览返回 400；新建/删除 CONSTRUCT 规则成功。
- 管理页（Playwright）：5 行类型均为 CONSTRUCT；编辑框显示完整 SPARQL；paid 规则预览显示“命中 5 条推断三元组”。
- 回归：`/healthz=200`、quads=840、subjects=148、pending=0、dead=0；MCP 冒烟 16 PASS / 0 FAIL。

### 4. 说明

- 新规则必须提供 `construct_query`（推荐）或旧版 `conditions`；CONSTRUCT 会在下一次投影周期清空并重建 `urn:sse:inferred`。
- 金额/类别审批匹配仍由 `matchRule` 决定；新增推理规则应做派生分类/标记，避免与审批链逻辑重复。

## 十四、缺发票规则上线（2026-11-12 14:20 UTC）

提交：`d0de9b9 feat(ontology): flag reports missing invoice attachments`、`376977e feat(web): style missing-invoice flag in graph`；测试机同步到 `376977e`，迁移 `020` 已应用。

### 1. 规则内容

- 名称 `missing-invoice-flag`，优先级 60，severity `warning`。
- 条件：报销单至少有一条明细，且**所有明细都没有** `hasInvoice`。
- 输出：`?r a sse:MissingInvoiceReport`；`?r sse:hasFlag ?flag`；`?flag a sse:MissingInvoiceFlag; sse:name "缺发票"; sse:description "有明细但没有任何发票附件"`。
- 标记节点 URI：`https://sse.local/flag/missing-invoice/<report-id>`。
- TTL 增加 `MissingInvoiceReport`、`MissingInvoiceFlag`、`hasFlag`；Web 图例增加三角形深红色“缺发票”。

### 2. 重要：规则何时生效

- RuleEngine 只在 projector 处理到 outbox 事件后运行（`ProjectorRunner.runOnce`：`processed > 0` 才 `runRules`）。
- 新增/修改规则后，若没有业务写入，可调用 `POST /ontology/reconcile`（重建并 materialize 规则）立即生效，或等待下一次业务写入。
- 本次用 reconcile 触发：job `done`，`quads 840→861`，`subjects 148→154`。

### 3. 验证

- 推断图：`MissingInvoiceFlag=3`、`MissingInvoiceReport=3`、`PaidReport=5`。
- 图谱：72 节点 / 98 边，新增 3 个标记节点 + 3 条 `hasFlag` 边。
- 管理页/图谱：图例含 `MissingInvoiceFlag (缺发票)`；类型筛选可选 `MissingInvoiceFlag`，显示 3 个节点；悬停 tooltip 类型/标签为“缺发票”。
- DB：`schema_migrations` 含 `020_missing_invoice_rule`；`reasoning_rules` 6 条；`/healthz=200`，pending=0，dead=0。

### 4. 说明

- 只标记“有明细但无任何发票”的单；没有明细的草稿不会被标记。
- 非管理员作用域下标记节点可能不显示（scope 只识别业务实体），管理员可见；若需员工也看到，需要把标记节点纳入 scope 逻辑（后续可选）。
