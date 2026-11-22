# SSE 开发过程记录（2026-11-21）

> 本次会话处理 `docs/2026-11-12-sse-multi-role-analysis.md` P1 第 5 项：
> 报销单内容不可变快照。
>
> 设计文档：`docs/superpowers/specs/2026-11-21-report-snapshot-design.md`
> 实现计划：`docs/superpowers/plans/2026-11-21-report-snapshot.md`
> TDD 证据：`docs/testing/report-snapshot.tdd.md`

---

## 一、落地内容

| 层 | 变更 |
|---|---|
| 迁移 | `packages/db/src/migrations/023_report_snapshots.sql`：append-only `report_snapshots` 表、SHA-256 内容哈希、无外键、`BEFORE UPDATE OR DELETE` 触发器、非草稿单据一次性 `backfill` |
| shared | `ReportSnapshot*` / `SnapshotType` 等类型 |
| core | `buildReportSnapshotPayload` 纯函数；`SqlExecutor` 端口；`IReportSnapshotRepo`；审批写入方法增加可选事务客户端 |
| db | `PgReportSnapshotRepo`（capture/find/list/query + 读取时哈希复算）；`updateStatus`/`create`/`updateResult` 支持事务客户端 |
| api | 提交、通过、驳回、付款在事务内捕获快照；`GET /expenses/:id/snapshots`、`GET /expenses/:id/snapshots/:snapshotId`；`GET /admin/snapshots`、`GET /admin/snapshots/:id`；非财务/管理员读取快照时隐藏回单核对详情（与报销详情口径一致） |
| web | 报销详情“内容快照”卡片、快照查看弹窗、管理端“内容快照”页面与导航 |

## 二、触发点与事务

| 快照类型 | 触发点 | 事务边界 |
|---|---|---|
| `submit` | 提交报销单 | 首步审批记录 + 状态更新 + 快照 |
| `approve` | 每步通过 | 审批记录 + 状态推进 + 快照（含确认标记） |
| `reject` | 每步驳回 | 审批记录 + 状态驳回 + 快照 |
| `pay` | 标记打款 | `markPaid` + 付款审计 + 快照 |
| `backfill` | 迁移一次性回填 | 迁移事务 |

快照写入失败会回滚整个业务动作，避免“有审批无快照”。

## 三、验证结果

```text
pnpm -r test
  web           46 passed
  core          59 passed
  db            41 passed
  auth          30 passed
  ai           100 passed
  notifications 29 passed
  ontology     176 passed
  api          180 passed
  mcp           56 passed
  合计         717 passed

pnpm -r build
  11 个包全部完成（web/core/ocr/ai/auth/db/notifications/ontology/api/mcp/shared）
```

说明：

- 本机未安装 Docker，`docker compose` 不可用，因此**未在本机对真实 PostgreSQL 执行迁移 023**；
  迁移 SQL 已通过静态守卫测试（`migration-023.test.ts`），部署前请在测试机执行一次真实迁移。
- `packages/ontology` 与 `packages/api` 测试输出中的 `console.error` 是既有日志行为，不是失败。

## 四、部署与复测

```bash
pnpm --filter @sse/db migrate

docker compose exec -T postgres psql -U sse -d sse \
  -c "SELECT snapshot_type, legacy, COUNT(*) FROM report_snapshots GROUP BY 1,2 ORDER BY 1;"

# 预期被触发器拒绝（先确认表内没有需要保留的测试数据再执行）
docker compose exec -T postgres psql -U sse -d sse \
  -c "DELETE FROM report_snapshots WHERE false;" 
```

验证要点：

1. 提交后出现 `submit` 快照；
2. 每步通过/驳回后出现对应 `approve`/`reject` 快照；
3. 付款后出现 `pay` 快照，包含付款信息与回单；
4. 非草稿历史单据有 `backfill` 且 `legacy=true`；
5. 直接 `UPDATE`/`DELETE report_snapshots` 被触发器拒绝；
6. 报销详情页与管理端“内容快照”可查看，哈希校验显示通过。

## 五、关键提交

| 提交 | 内容 |
|---|---|
| `42d1194` | shared 类型与 core 端口 |
| `c7c7f3b` | core 快照 payload 构建器 |
| `6556650` | 迁移 023 |
| `482ac6d` | `PgReportSnapshotRepo` |
| `754c8e6` | 审批写入事务客户端 |
| `aafe7e5` | API 捕获与查询接口 |
| `760d7ae` | Web 展示 |

## 六、后续

- 部署前在测试机应用迁移 023 并按第四节复测。
- 本次审查代理（`typescript-reviewer`/`security-reviewer`）因本机 opencode 子代理模型配置指向不存在的
  `vllm/qwen3.6-27b` 未能启动；已改为人工审查，并修复了“非财务/管理员读取付款快照时暴露回单核对详情”的问题。
  该问题与 SSE 业务代码无关，agent 配置已另行修正。

## 七、P1 清单进度

| 优先级 | 项 | 状态 |
|---|---|---|
| P1-5 | 报销单内容快照：提交、每步审批、付款时保存不可变 JSON 快照 | ✅ 已完成（本次会话） |
| P1-6 | 发票核对历史版本，不覆盖旧结果 | ✅ 已完成（本次会话） |
| P1-7 | 导出补齐明细/审批链/付款/发票字段；增加 XLSX 与导出审计 | ✅ 已完成（本次会话） |
| P1-8 | 修复统计过滤条件，确保类别/部门/月度与总览口径一致 | ✅ 已完成（本次会话） |
| P1-9 | 实现真实部门 CRUD，或移除无效入口 | 待处理 |
| P1-10 | MCP Key 管理界面 + 哈希存储 + 过期/吊销/最后使用时间 | 待处理 |
| P1-11 | 导航按角色过滤，消除 403/空页面 | 待处理 |
| P1-12 | 增加只读审计员角色与审计查询页面 | 待处理 |

**下一次会话建议：** 从 P1-7（导出补齐）或 P1-11（导航按角色过滤）开始。
P1-11 改动最小，适合作为热身项；P1-7 可在现有导出与审计事件基础上继续扩展。

---

## 八、P1-6：发票与回单核对历史版本

> 设计：`docs/superpowers/specs/2026-11-21-invoice-verification-history-design.md`
> 计划：`docs/superpowers/plans/2026-11-21-invoice-verification-history.md`
> TDD 证据：`docs/testing/invoice-verification-history.tdd.md`

### 落地内容

- 迁移 `024_verification_history.sql`：`verification_runs` + `verification_run_items` append-only、SHA-256、无外键、失效事件、历史回填。
- core：`IVerificationHistoryRepo`、`redactVerificationHistory`。
- db：`PgVerificationHistoryRepo`；发票/回单仓储支持事务客户端。
- api：发票核对、明细修改、发票上传、回单上传、回单核对写入历史；新增 `GET /expenses/:id/verification-history`；详情重复发票脱敏。
- web：报销详情“核对历史”卡片。

### 验证

```text
pnpm -r test
  web           56 passed
  core          63 passed
  db            56 passed
  auth          30 passed
  ai           100 passed
  notifications 29 passed
  ontology     176 passed
  api          193 passed
  mcp           56 passed
  合计         759 passed
  （9 个有测试的包；ocr/shared 无测试）

pnpm -r build
  11 个包全部完成（shared/web/core/ocr/ai/auth/db/notifications/ontology/api/mcp）
```

### 部署与复测

```bash
pnpm --filter @sse/db migrate

docker compose exec -T postgres psql -U sse -d sse \
  -c "SELECT kind, event_type, legacy, COUNT(*) FROM verification_runs GROUP BY 1,2,3 ORDER BY 1,2,3;"
```

复测要点：

1. 核对一次 → 新增 run 与逐张 items；
2. 重复核对 → 旧 run 保留；
3. 改明细/换发票 → 当前变 pending，出现失效事件；
4. 回单上传/核对 → 同理；
5. 回填数据 `legacy=true`；
6. `UPDATE/DELETE` 两张历史表被拒绝；
7. 员工看不到重复发票明细。

### P1 清单进度

| 优先级 | 项 | 状态 |
|---|---|---|
| P1-6 | 发票核对历史版本，不覆盖旧结果 | ✅ 已完成 |
| P1-7 | 导出补齐明细/审批链/付款/发票字段；增加 XLSX 与导出审计 | ✅ 已完成（本次会话） |
| P1-8 | 修复统计过滤条件，确保类别/部门/月度与总览口径一致 | ✅ 已完成（本次会话） |
| P1-9 | 实现真实部门 CRUD，或移除无效入口 | 待处理 |
| P1-10 | MCP Key 管理界面 + 哈希存储 + 过期/吊销/最后使用时间 | 待处理 |
| P1-11 | 导航按角色过滤，消除 403/空页面 | 待处理 |
| P1-12 | 增加只读审计员角色与审计查询页面 | 待处理 |

---

## 九、会话收尾（P1-6）

- 分支 `feat/p1-6-verification-history` 已本地 fast-forward 合并到 `master`。
- 最终 HEAD：`1c02429`；已推送到 `origin/master`（`37ccfd4..1c02429`）。
- 全量验证：`pnpm -r test` 759 passed；`pnpm -r build` 11/11 个包完成。
- 测试机更新顺序：
  ```bash
  git checkout master && git pull --ff-only
  git rev-parse --short HEAD          # 1c02429
  pnpm install
  pnpm -r build
  pnpm --filter @sse/db migrate
  # 重启服务后按第八节复测
  ```
- 迁移 `023`（P1-5 快照）与 `024`（P1-6 核对历史）需在测试机真实 PostgreSQL 执行并复测；本机未执行真实迁移。
- 未改动的原有未跟踪文件：`docs/handover-docs/**`、`docs/2026-11-12-sse-multi-role-analysis.md`。
- 已知后续项：快照详情与 MCP `get_expense_detail` 的重复发票引用仍可能对员工暴露，已记录在 TDD 证据的 known gaps。
- 下一次会话建议：从 P1-7 或 P1-11 开始。

---

## 十、P1-8：统计口径一致性

> TDD 证据：`docs/testing/statistics-consistency.tdd.md`

### 落地内容

- 新增 core 共享统计契约：`resolveStatisticsFilter`、`buildStatisticsPredicate`、`statisticsScopeLabel`、`SPENDING_STATUSES`，API 与 MCP 复用同一套过滤/状态口径。
- 统一“支出”口径为 `approved + paid`；总览金额/单数、类别、部门、月度全部使用同一状态集合；驳回/待审批/草稿单独计数。
- `dateTo` 改为半开区间 `created_at < (dateTo::date + INTERVAL '1 day')`，不再漏掉截止日当天数据。
- 类别统计显示 `未分类`；部门统计改用 `LEFT JOIN users` 并显示 `未分配`，保证部门合计可与总览对账。
- MCP `get_statistics` 与 REST 对齐：相同 scope/日期/状态口径，新增 `scope`、状态计数、`by_month`。
- 前端“统计分析”显示 `统计口径：已通过 + 已付款`。

### 验证

```text
pnpm -r test
  web           58 passed
  core          70 passed
  db            59 passed
  auth          30 passed
  ai           100 passed
  notifications 29 passed
  ontology     176 passed
  api          201 passed
  mcp           59 passed
  合计         782 passed

pnpm -r build
  11/11 个包完成
```

### 已知边界

- 月度趋势固定取最近 12 个月，因此有更早数据时其合计小于总览属预期。
- 月度分组与日期比较都依赖 PostgreSQL 会话时区；跨时区部署仍需在测试机复核。
- 未新增真实数据库对账测试；通过“同一谓词 + 同一状态集合”保证口径一致，并记录在 TDD 证据的 known gaps。

---

## 十一、P1-7：导出补齐与全量备份/恢复

> 计划：`docs/superpowers/plans/2026-11-21-p1-7-export-backup-restore.md`
> TDD 证据：`docs/testing/p1-7-export-backup.tdd.md`
> 运行手册：`docs/2026-11-22-p1-7-runbook.md`

### 落地内容

- `packages/backup`：纯 Node/TS 全量备份/恢复。
  - PostgreSQL 每表 JSONL（`row_to_json` + REPEATABLE READ 快照）。
  - MinIO 对象按原始 key 导出，SHA-256 校验。
  - 配置文件白名单，`.env` 默认排除。
  - 本地 `BACKUP_DIR` + MinIO `backups` bucket。
  - manifest、checksums、tar.gz、保留策略、advisory lock。
- 恢复：新建演练库 + MinIO 前缀；先跑 migration；临时移除外键 → 导入 → 重建外键；独立验证表行数/对象 checksum/DB↔对象关联；失败自动删除演练库和前缀。
- 演练记录：`restores/<restoreId>.json`；管理端一键清除，确认短语 `CLEANUP <targetDb>`，写 `backup.drill_cleanup` 审计。
- API：`/admin/backups` 创建/列表/下载/校验/上传/删除；`/:id/restore`；`/drills` 与 `/drills/:restoreId/cleanup`。
- Web：`/admin/backups` 页面（管理员）+ 统计页 Excel/CSV/JSON 导出入口。
- P1-7 导出：`/statistics/export` 支持 CSV/JSON/XLSX；XLSX 5 个 sheet；导出写 `statistics.export` 审计。

### 验证

```text
pnpm -r test
  web           62 passed
  core          70 passed
  db            60 passed
  auth          30 passed
  ai           100 passed
  notifications 29 passed
  backup        22 passed
  ontology     176 passed
  api          211 passed
  mcp           59 passed
  合计         819 passed

pnpm -r build
  12/12 个包完成
```

### 已知边界

- 本机未安装 Docker/真实 PostgreSQL/MinIO，未执行真实备份 → 演练恢复 → 清除的端到端验证；部署前需按运行手册在测试机跑通。
- 备份包未加密；`--include-secrets` 生成的包属于敏感数据。
- 未实现增量备份、WAL PITR、浏览器上传备份包。
