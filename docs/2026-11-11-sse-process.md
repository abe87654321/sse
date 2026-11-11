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
- **`.env` `$` 值**：Docker Compose 会插值 `$`；用单引号或 `$$`，bcrypt hash 不要放 `.env`。
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
