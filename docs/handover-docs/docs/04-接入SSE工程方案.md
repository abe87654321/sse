# 接入 SSE 的工程方案

> 日期：2026-11-09 | 文档类型：工程方案
> 读者：主力开发环境的接手开发者
> 配套阅读：[01-设计说明.md](01-设计说明.md) · [06-踩坑与已知问题.md](06-踩坑与已知问题.md)

---

## 1. 现状与目标

### 1.1 现状

这套能力目前是**独立交付件**，不在 SSE monorepo 里：

```
/opt/data/tools/sse-data/                 ← 本地
\\192.168.3.102\Graph_500G\hermes-tools\sse-offline-recovery\   ← 102 共享目录
/home/szl/tmp/sse-offline-recovery/        ← 目标机工作副本
```

形态是**若干 shell / python 脚本**，靠环境变量配置。

### 1.2 目标

并入 SSE monorepo，成为一个**有 CLI、有类型、有测试**的工程能力：

```
packages/backup/          ← 新增包
```

### 1.3 为什么值得并入

| 现状问题 | 并入后 |
|---|---|
| 脚本散落在 `/opt/data/tools/`，不在版本控制里 | 进 monorepo，走 code review |
| 靠环境变量隐式配置，容易配错 | 统一 config + 显式 flag |
| 无类型检查 | TypeScript，编译期发现错误 |
| 手工跑脚本 | `pnpm sse-backup <subcommand>` |
| 与 SSE 的 schema 漂移无感知 | 复用 `@sse/db` 的 migration 信息 |

---

## 2. SSE 代码库现状（接手前必读）

### 2.1 monorepo 结构

```
sse/
├── package.json                 pnpm@9.15.0，node>=18
├── pnpm-workspace.yaml           packages: packages/*
├── docker-compose.yml
├── docs/                         设计文档（本套文档应放这里）
├── test/                         集成测试（jest）
└── packages/
    ├── api/        @sse/api      Express 4.18
    ├── web/        @sse/web
    ├── db/         @sse/db       pg 8.11 + 自研 migration 器
    ├── core/       @sse/core      领域模型 + IFileStorage 接口
    ├── shared/     @sse/shared    类型共享
    ├── auth/  ai/  mcp/  notifications/  ocr/  ontology/
```

### 2.2 `@sse/db` —— 最相关的包

```
packages/db/src/
├── connection.ts           Pool 连接
├── migrate.ts              migration 执行器（up/down）
├── migration-planner.ts    migration 版本规划
├── index.ts
├── migrations/
│   ├── 001_initial.sql
│   ├── 002_notifications.sql
│   ├── 003_identity_mappings.sql
│   ├── 004_ontology_snapshots.sql
│   ├── 005_user_deleted_at.sql
│   ├── 006_payment.sql
│   ├── 007_reasoning_rules.sql
│   ├── 008_user_avatar.sql
│   ├── 009_mcp_api_keys.sql
│   ├── 010_invoice_verification.sql
│   ├── 011_payment_receipts_audit.sql
│   ├── 012_notification_system_message_link.sql
│   └── 013_notification_pref_defaults.sql
└── repositories/           pg-* 仓储实现
```

**migration 机制**：SQL 文件按 `NNN_name.sql` 命名，
`migrate.ts` 记录已应用版本到 `schema_migrations` 表。

> **对本套能力的意义**：备份包恢复后，**目标库的 schema 应该已经是最新的**
> （migration 由目标系统自己管）。备份包里的 `schema.sql` 只用于
> "目标库还没有这些表" 的场景。列对齐必须以**目标库实际结构**为准，
> 而目标库结构由 `@sse/db` 的 migration 决定。

### 2.3 `@sse/core` 的 `IFileStorage` —— 存储抽象

```ts
// packages/api/src/storage/minio-storage.ts
export class MinioStorage implements IFileStorage {
  async upload(key: string, bucket: string, data: Buffer, contentType: string): Promise<void>
  async getSignedUrl(key: string, bucket: string, expiresInSeconds?: number): Promise<string>
  async getObject(key: string, bucket: string): Promise<Buffer>
  calculateChecksum(data: Buffer): string
}
```

**对本套能力的意义**：对象层已有抽象，接入时**不要绕过 `IFileStorage`**。
但注意：`IFileStorage` 只有运行时接口，**没有"离线目录"实现** ——
恢复层需要一个能从文件系统读对象的实现：

```ts
// 建议新增
export interface IObjectSource {
  list(bucket: string): Promise<string[]>
  read(bucket: string, key: string): Promise<Buffer>
}
export class FileSystemObjectSource implements IObjectSource { … }
```

### 2.4 已有文档风格

`docs/` 下 60+ 篇文档，命名规范：

```
docs/YYYY-MM-DD-<topic>-design.md      设计文档
docs/YYYY-MM-DD-<topic>-plan.md        实施计划
docs/YYYY-MM-DD-<topic>.md              过程记录
docs/superpowers/plans/…                实施计划
docs/superpowers/specs/…                设计规格
```

**风格特征**（照此写）：

- 中文正文，标题中英混排（`## 1. 概述` / `### 2.1 设计`）
- 开头用引用块标注日期、范围、相关文件
- 用表格承载对照信息
- 大量"为什么"而非只讲"是什么"
- 踩坑单独成节

> **本套文档的落位建议**：见第 7 节。

---

## 3. 目标结构

### 3.1 目录布局

```
packages/
└── backup/                       ← 新增
    ├── package.json
    ├── tsconfig.json
    ├── src/
    │   ├── index.ts
    │   ├── config.ts             配置解析（env + flag）
    │   ├── cli.ts                统一 CLI 入口
    │   │
    │   ├── extract/              ── L1 取证层 ──
    │   │   ├── probe.ts          探查旧盘
    │   │   ├── pg.ts             PGDATA → CSV
    │   │   ├── minio.ts          MinIO 数据目录 → 对象
    │   │   └── xlmeta.ts         xl.meta v2 解析（TS 重写）
    │   │
    │   ├── package/              ── L2 打包层 ──
    │   │   ├── builder.ts        CSV → 单行 INSERT → 备份包
    │   │   ├── sql-literal.ts    E'...' 转义 / 数组字面量
    │   │   ├── semantics.ts      语义转换（角色 → UUID）
    │   │   └── column-align.ts   按目标库真实列对齐
    │   │
    │   ├── restore/              ── L3 恢复层 ──
    │   │   ├── importer.ts       快照 → 单事务导入
    │   │   ├── minio-restore.ts  对象还原
    │   │   ├── rollback.ts       回滚
    │   │   └── verify.ts         独立验证
    │   │
    │   └── types.ts              共享类型
    │
    └── __tests__/
        ├── sql-literal.test.ts
        ├── column-align.test.ts
        ├── xlmeta.test.ts
        └── semantics.test.ts
```

### 3.2 为什么按 extract/package/restore 分目录

与 [01-设计说明.md](01-设计说明.md) 的三层分离一致。
每个目录对应一个可独立测试的职责边界。

### 3.3 依赖选择

| 需求 | 建议 | 理由 |
|---|---|---|
| CLI 框架 | `commander` | 与 Express 生态一致，参数解析清晰 |
| PG 客户端 | `pg`（复用 `@sse/db` 的依赖） | monorepo 已有 |
| msgpack | `msgpack`（或 `@msgpack/msgpack`） | xl.meta 解析必需 |
| 文件校验 | Node 内置 `crypto` | 无需额外依赖 |
| SQL 解析 | **不引入** | 只做正则级别的列清单处理，够用 |

> **不要引入重型 SQL parser** —— 备份包的 SQL 是我们自己生成的，
> 格式可控（一条 INSERT 一行），正则足够。

---

## 4. CLI 设计

### 4.1 命令面

```bash
pnpm sse-backup <subcommand> [options]
```

| 子命令 | 作用 | 对应现有脚本 |
|---|---|---|
| `probe` | 探查旧盘结构 | `probe_oldroot.py` |
| `extract:pg` | PGDATA → CSV | `pg_offline_export.py` |
| `extract:minio` | MinIO 数据目录 → 对象 | `minio_offline_export.py` |
| `package` | 清洗 → 备份包 | `build_import_package.py` |
| `restore` | 备份包 → 目标系统 | `import_sse_data.sh` |
| `verify` | 独立验证 | `verify_sse_restore.sh` |
| `test:rollback` | 回滚能力测试 | `test_rollback.sh` / `test_rollback_minio.sh` |

### 4.2 命令示例

```bash
# 探查
pnpm sse-backup probe --root /mnt/old/oldroot --out probe_report.json

# 提取
pnpm sse-backup extract:pg \
  --pgdata /mnt/old/oldroot/var/lib/docker/volumes/sse_pgdata/_data \
  --pgbin  /usr/lib/postgresql/16/bin \
  --dbname sse \
  --out    ./recovery/pg-export

pnpm sse-backup extract:minio \
  --datadir /mnt/old/oldroot/var/lib/docker/volumes/sse_miniodata/_data \
  --out     ./recovery/minio-export

# 打包
pnpm sse-backup package \
  --recovered ./recovery \
  --out      ./recovery/pkg \
  --schema   ./recovery/pg-export/schema.sql

# 恢复
pnpm sse-backup restore --from ./recovery/pkg --target-db sse

# 验证
pnpm sse-backup verify --from ./recovery/pkg --target-db sse
```

### 4.3 配置来源（优先级从高到低）

```
命令行 flag  >  环境变量  >  .env  >  内置默认值
```

现有脚本的环境变量名保持兼容，便于平滑迁移：

```
PG_CONTAINER  DB_HOST  DB_PORT  DB_NAME  DB_USER  DB_PASSWORD
MINIO_ENDPOINT  MINIO_PORT  MINIO_ACCESS_KEY  MINIO_SECRET_KEY
SSE_DIR  MC_ALIAS
```

### 4.4 退出码约定

| 码 | 含义 |
|---|---|
| 0 | 成功 |
| 1 | 一般失败 |
| 2 | 参数错误 |
| 3 | 校验失败（checksum 不符 / 验证未通过） |
| 4 | 回滚成功（导入失败但已还原） |

> 退出码 4 单独区分，让 CI 能识别"失败但已安全还原"。

---

## 5. 分阶段实施路径

### 阶段 1：包装（不改逻辑，纯搬家）

**目标**：脚本进 monorepo，行为完全不变。

```
1. 新建 packages/backup/，配好 package.json / tsconfig
2. 把 shell 脚本原样放入 packages/backup/scripts/（先不改）
3. TS 侧只写一个薄 CLI 包装：读参数 → 调 shell → 转发 exit code
4. 迁移现有的 Python 工具为 TS（xlmeta / sql-literal / column-align 优先）
5. 跑通现有测试套件，全部转绿
```

**产出**：`pnpm sse-backup` 可用，但内部还是老脚本。

**风险**：低。行为可逐条比对。

### 阶段 2：核心逻辑 TS 化

**目标**：把最容易出错的逻辑用 TS 重写并加单测。

优先顺序（按风险从高到低）：

| 模块 | 优先级 | 理由 |
|---|---|---|
| `sql-literal.ts` | **最高** | 转义错误 = SQL 残缺 = 数据损坏 |
| `column-align.ts` | **最高** | 列错位 = 数据写到错误的列 |
| `xlmeta.ts` | 高 | 解析错误 = 对象取不回来 |
| `semantics.ts` | 中 | 映射错误 = 数据错值 |
| `importer.ts` | 中 | 事务逻辑已在 shell 里验证过 |

**关键**：TS 重写时**保留 Python 版本作为对照实现**，
用同一批真实数据跑两者，比对输出逐字节一致。

### 阶段 3：与 `@sse/db` 集成

**目标**：消除"目标库列结构"的硬编码。

```ts
// packages/backup/src/restore/column-align.ts
import { Pool } from 'pg';

// 直接查目标库真实结构，不依赖备份包里的 schema.sql
async function getTargetColumns(pool: Pool, tables: string[]): Promise<ColumnMeta[]> { … }
```

**收益**：备份包不再假设目标结构，同一个包能导入不同版本的 SSE。

**顺带收益**：可以用 `@sse/db` 的 `schema_migrations` 表判断目标库版本，
给用户更明确的提示（"目标库 migration 版本 013，包来自 012 时代的结构"）。

### 阶段 4：调度与增量

| 能力 | 说明 |
|---|---|
| 定时全量备份 | cron 调 `sse-backup extract:*` + `package`，推送到对象存储 |
| 保留策略 | 按天数/份数清理历史包 |
| 增量导出 | 基于 WAL 归档的 PITR（需先在目标系统开 `archive_mode`） |

---

## 6. 与 SSE 现有能力的协作点

| SSE 能力 | 协作方式 |
|---|---|
| `@sse/db` migration | 列对齐改用目标库真实结构；`schema_migrations` 用于版本提示 |
| `IFileStorage` | 恢复层实现 `IObjectSource`，从备份包目录读对象 |
| `docker-compose.yml` | 备份/恢复工具可作为 compose 里的 profile，复用 PG/MinIO 容器 |
| `@sse/shared` 类型 | 备份包 manifest 的类型定义放这里 |
| `docs/` 目录 | 本套文档放 `docs/backup/`（见第 7 节） |

### 6.1 compose profile 建议

```yaml
# docker-compose.yml 追加
profiles:
  - backup

  sse-backup:
    image: postgres:16-alpine      # 需要 psql/pg_dump/pg_restore
    profiles: [backup]
    environment:
      PG_CONTAINER: sse-postgres-1
      DB_PORT: "5433"
    volumes:
      - ./recovery:/recovery
    depends_on: [sse-postgres-1]
```

> 恢复层需要的 `pg_dump`/`pg_restore` 版本必须与目标 PG major 一致，
> 所以镜像标签要跟目标数据库联动。

---

## 7. 文档落位建议

本套文档共 8 篇，建议放：

```
docs/backup/
├── README.md                        ← 00-总览.md
├── 2026-11-09-backup-design.md      ← 01-设计说明.md
├── 2026-11-09-backup-export-design.md   ← 02-导出功能设计.md
├── 2026-11-09-backup-restore-design.md  ← 03-恢复功能设计.md
├── 2026-11-09-backup-integration-plan.md ← 04-接入SSE工程方案.md
├── 2026-11-09-backup-runbook.md     ← 05-运维手册.md
├── 2026-11-09-backup-pitfalls.md    ← 06-踩坑与已知问题.md
└── 2026-11-09-backup-test-acceptance.md ← 07-测试与验收.md
```

**并入 monorepo 时**：把 `docs/backup/` 整体放进 SSE 的 `docs/`，
文件名按 SSE 现有命名规范（`YYYY-MM-DD-<topic>-design.md`）调整。

---

## 8. 迁移检查清单

并入 SSE 时逐项确认：

- [ ] `packages/backup/` 创建，`pnpm -r build` 通过
- [ ] `pnpm sse-backup --help` 可用，6 个子命令都在
- [ ] 现有 shell 脚本移入 `packages/backup/scripts/`，且**内容未改**
- [ ] Python 工具 TS 化后，用真实备份包比对输出**逐字节一致**
- [ ] `colmeta.sql` 的查询改成直接用 `pg` 库查目标库
- [ ] 单测覆盖：`sql-literal` / `column-align` / `xlmeta` / `semantics`
- [ ] 现有回滚测试（DB 阶段 + MinIO 阶段）**改用新 CLI 跑通**
- [ ] 文档放入 `docs/backup/`，交叉链接有效
- [ ] README 的「Documentation」章节加上入口
- [ ] 旧交付目录（102 / `/opt/data/tools/sse-data`）**保留不删**，作为对照实现

---

## 9. 已知待办

| 项 | 说明 |
|---|---|
| 增量导出 | 需要目标系统开 `archive_mode`，是独立工程 |
| 备份包签名 | 用 GPG 或 minisign 签名，防篡改（当前只有 checksum，检出损坏但不检出恶意替换） |
| 凭据外置 | 备份包的 `files/` 不带凭据，改由密钥管理注入 |
| 跨 major 升级 | 建议引导用户用官方 `pg_upgrade`，不自己实现 |
| 并行导出 | 大库时多表并行导出（当前串行） |

---

## 10. 相关文档

- [01-设计说明.md](01-设计说明.md) —— 架构与决策
- [05-运维手册.md](05-运维手册.md) —— 运行与排障
- [06-踩坑与已知问题.md](06-踩坑与已知问题.md) —— **动手前必读**
- [07-测试与验收.md](07-测试与验收.md) —— 测试与验收标准
