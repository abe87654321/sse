# TDD Evidence Report: P1-7 Export + Backup/Restore

## 1. Source

- Plan: `docs/superpowers/plans/2026-11-21-p1-7-export-backup-restore.md`
- Handover docs: `docs/handover-docs/`（冷启动恢复能力、回滚与验证约束）
- Process record: `docs/2026-11-21-sse-process.md`

## 2. Delivered

### 2.1 P1-7 报销导出

- `/statistics/export` 支持 `json`、`csv`、`xlsx`。
- 数据集包含报销单、费用明细、发票、审批链、付款/回单字段。
- XLSX 输出 5 个 sheet：报销单、费用明细、发票、审批链、付款。
- CSV 输出带 BOM 的扁平表，明细/发票/审批链/付款以 JSON 列承载。
- 导出写 `audit_events`：format、筛选条件、各层行数、字节数、SHA-256。
- 统计页对 finance/admin 显示 Excel/CSV/JSON 导出按钮。

### 2.2 全量备份

- 新增 `packages/backup`，纯 Node/TS 实现：
  - PostgreSQL 每表一个 JSONL（`row_to_json`，REPEATABLE READ 快照）。
  - MinIO 对象按原始 key 导出并计算 SHA-256。
  - 配置文件白名单：`ai-config.json`、`ai-test-history.json`；`.env` 需 `--include-secrets`。
  - 生成 `manifest.json`、`meta/checksums.sha256`、`<id>.tar.gz`。
  - 支持本地 `BACKUP_DIR` 与 MinIO `backups` bucket。
- CLI：`create`、`list`、`verify`、`restore`、`drills`、`drill:clean`。

### 2.3 演练恢复与一键清除

- 恢复到新建演练库 + MinIO 前缀，不触碰当前库/对象。
- 恢复流程：创建库 → 执行目标库 migration → 临时移除外键 → JSONL 导入 → 重建外键 → 上传演练对象 → 恢复配置到 `restores/<restoreId>/files/` → 独立验证。
- 失败自动删除演练库、清理演练前缀。
- 每次成功恢复写 `restores/<restoreId>.json`。
- 管理端“演练库”列表支持一键清除，确认短语 `CLEANUP <targetDb>`；清除写 `backup.drill_cleanup` 审计。
- API 恢复/清除需 `BACKUP_RESTORE_ENABLED=true` + 管理员 + 确认短语。

## 3. Task report

| Task | 内容 | RED | GREEN |
|---|---|---|---|
| 1 | 包脚手架、配置、checksums、archive | `Cannot find module '../index'` | 4 tests passed |
| 2 | 本地/MinIO 存储、保留策略、解析器 | `Cannot find module '../storage/local-store'` | 2 tests passed |
| 3 | PostgreSQL JSONL 导出 | `Cannot find module '../db/export'` | 2 tests passed |
| 4 | MinIO/配置导出 | `Cannot find module '../minio/export'` | 2 tests passed |
| 5 | 备份编排、advisory lock、CLI | `Cannot find module '../backup'` | 1 test passed |
| 6 | 独立校验器 | `Cannot find module '../verify'` | 1 test passed |
| 7 | `applyMigrations` 可复用 | `applyMigrations is not a function` | db 全量 60 passed |
| 8 | 演练库创建/删除 | `Cannot find module '../db/target'` | 2 tests passed |
| 9 | JSONL 导入、列对齐、外键 | `Cannot find module '../db/import'` | 3 tests passed |
| 10 | 恢复编排与 CLI restore | `Cannot find module '../restore'` | 1 test passed |
| 10.5 | 演练记录与一键清除 | `Cannot find module '../drill-cleanup'` | 2 tests passed |
| 11-12 | API 任务队列、备份/恢复/清除路由 | `Cannot find module '../services/backup-jobs'` | 5 tests passed |
| 13 | 管理端备份/恢复/清除页面 | `Failed to resolve import "../AdminBackups.vue"` | 3 tests passed |
| 14 | 导出数据集与 CSV/JSON/XLSX | `Cannot find module '../services/report-export'` | 4 tests passed |
| 15 | 导出路由、审计、前端入口 | 旧导出仍返回旧结构 | api 9 + web 3 passed |
| 16 | 全量验证 | —— | 822 tests / 12 packages build |

## 4. Full verification

```text
pnpm -r test
  web           63 passed
  core          70 passed
  db            60 passed
  auth          30 passed
  ai           100 passed
  notifications 29 passed
  backup        24 passed
  ontology     176 passed
  api          211 passed
  mcp           59 passed
  合计         822 passed

pnpm -r build
  12/12 个包完成
```

## 5. Known gaps

- 本机未安装 Docker/真实 PostgreSQL/MinIO，未在本机执行真实备份 → 演练恢复 → 清除的端到端验证。测试机已确认页面创建备份成功；恢复触发的 API 崩溃已修复（`05b6342`），但恢复本身是否成功仍需查看 job.error 并按 runbook 完成一次完整演练。
- 备份包未加密；`.env` 默认排除。包含敏感配置时 manifest 标记 `containsSecrets`。
- 月度/时间口径与备份时间无关；备份使用数据库事务快照，MinIO 采用逐对象读取并校验大小/SHA-256。
- 恢复验证会逐对象下载并计算 SHA-256；生产大包时需评估耗时与带宽。
- 未实现增量备份、WAL PITR、浏览器上传备份包。
