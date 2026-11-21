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
| api | 提交、通过、驳回、付款在事务内捕获快照；`GET /expenses/:id/snapshots`、`GET /expenses/:id/snapshots/:snapshotId`；`GET /admin/snapshots`、`GET /admin/snapshots/:id` |
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
  api          178 passed
  mcp           56 passed
  合计         715 passed

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
- 下一项 P1 可从 6（核对历史版本）、7（导出补齐）、8（统计口径）中选择。
