# SSE 数据导出 / 导入 / 验证 工具包

> 适用项目：GitHub `abe87654321/sse`（分析基于 commit `064e7b6`）
> 用途：把旧 SSD 上 SSE 系统的 PostgreSQL 数据、MinIO 对象、文件配置，
> **连同它们之间的关联关系**，完整迁移到新系统。
> 核心保证：**任何一步失败，目标系统都会自动回滚到导入前的状态。**

---

## 目录

1. [这套工具解决什么问题](#1-这套工具解决什么问题)
2. [SSE 数据存储全貌](#2-sse-数据存储全貌)
3. [文件清单](#3-文件清单)
4. [旧盘侧：如何取出数据（关键前置）](#4-旧盘侧如何取出数据关键前置)
5. [使用流程](#5-使用流程)
6. [回滚机制详解](#6-回滚机制详解)
7. [验证清单](#7-验证清单)
8. [实测记录](#8-实测记录)
9. [已知限制](#9-已知限制)
10. [故障排查](#10-故障排查)

---

## 1. 这套工具解决什么问题

SSE 的数据**不是只在一个 Postgres 库里**。真实构成：

```
┌─────────────────────────────────────────────┐
│  PostgreSQL —— 16 张业务表                   │
│  用户 / 系统 / 消息 / 推理规则 / 报销 / 支付  │
└─────────────────────────────────────────────┘
                    ↕ storage_key
┌─────────────────────────────────────────────┐
│  MinIO —— 3 个 bucket                        │
│  invoices / payment-receipts / avatars       │
└─────────────────────────────────────────────┘
                    ↕ 同目录
┌─────────────────────────────────────────────┐
│  文件系统 —— 3 个配置文件                     │
│  ai-config.json / ai-test-history.json / .env│
└─────────────────────────────────────────────┘
```

**最容易丢的**：
- `ai-config.json` / `ai-test-history.json` **不在数据库里**，在进程工作目录。
  只导数据库会丢 AI 引擎配置和测试历史。
- **关联关系**：`invoices.storage_key` 指向 MinIO 里的具体对象。
  单独恢复数据库会出现「记录在、文件没了」的断链。

本工具包三者一起处理，并在导入后**逐条验证 DB 引用能否命中 MinIO 对象**。

---

## 2. SSE 数据存储全貌

### 2.1 PostgreSQL（16 张业务表 + 1 张 migration 表）

| 业务域 | 表 | 关键字段 |
|---|---|---|
| **用户管理** | `users` | `notify_prefs` (JSONB)、`avatar_url`、`deleted_at`、`password_hash` |
| **系统管理** | `expense_categories` | 费用类别字典 |
| | `approval_rules` | 审批规则 |
| | `reasoning_rules` | 推理规则（`conditions`/`conclusion` 均为 JSONB） |
| | `ontology_snapshots` | 本体快照 |
| | `mcp_api_keys` | MCP API Key |
| **消息管理** | `notification_logs` | 通知日志（FK → `system_messages`） |
| | `notification_deliveries` | 送达明细 |
| | `system_messages` | 系统消息 |
| **报销业务** | `expense_reports` | 报销单 |
| | `expense_items` | 报销明细 |
| | `invoices` | 发票（`storage_key`/`storage_bucket`/`checksum`） |
| | `approval_records` | 审批流水 |
| **支付** | `payment_receipts` | 支付回单（`storage_key`/`storage_bucket`） |
| | `payment_audit_logs` | 支付审计日志 |
| **其他** | `identity_mappings` | 身份映射 |
| | `schema_migrations` | migration 版本追踪（13 条） |

**FK 依赖链**（决定了导入/清空的顺序，工具已内置正确顺序）：

```
users ──┬─→ system_messages ──→ notification_logs ──→ notification_deliveries
        └─→ expense_reports ──→ expense_items ──→ invoices ──→ approval_records
                                          └─→ payment_receipts ──→ payment_audit_logs
```

### 2.2 MinIO（3 个 bucket）

| bucket | 用途 | key 格式 |
|---|---|---|
| `invoices` | 发票原件 | `invoices/<itemId>_<timestamp>.<ext>` |
| `payment-receipts` | 支付回单 | `payment-receipts/<reportId>/<timestamp>.<ext>` |
| `avatars` | 用户头像 | `avatars/<userId>_<timestamp>.<ext>` |

> **关键事实（已核对源码）**
> SSE 源码 `packages/api/src/routes/expenses.ts:886` 与 `packages/api/src/routes/auth.ts:201`
> 显示 `storageKey` 生成方式为 `` `invoices/${id}/${itemId}_${Date.now()}.${ext}` ``，
> 即 **`storage_key` 本身就是完整的 object key，已经包含 bucket 前缀**。
>
> 所以校验关联时必须直接用 `storage_key` 当对象路径，
> **不要再拼接 bucket 名**（`storage_bucket + '/' + storage_key` 是错的）。
> 工具包已按正确方式实现。

### 2.3 文件系统配置（最容易漏）

| 文件 | 内容 | 位置 |
|---|---|---|
| `ai-config.json` | OCR / AI 填充引擎配置 | `process.cwd()` |
| `ai-test-history.json` | AI 测试历史 | `process.cwd()` |
| `.env` | 连接凭据 | 项目根目录 |

---

## 3. 文件清单

```
sse-data/
├── export_sse_data.sh        # 导出（只读，不修改源系统）
├── import_sse_data.sh        # 导入（原子 + 三重回滚）
├── verify_sse_restore.sh     # 独立验证
├── testdata.sql              # 测试夹具数据（16 表全覆盖）
├── test_rollback.sh          # 回滚测试：DB 阶段失败
├── test_rollback_minio.sh    # 回滚测试：MinIO 阶段失败
└── README.md                 # 本文件
```

### 依赖

```bash
# PostgreSQL 客户端（pg_dump / psql / pg_restore）
postgresql-client >= 12

# MinIO 客户端
mc   # https://dl.min.io/client/mc/release/linux-amd64/mc
```

校验：

```bash
psql --version
mc --version
```

---

## 4. 旧盘侧：如何取出数据（关键前置）

> ⚠️ **旧系统起不来时，必须先在旧盘上起临时实例**，否则无法安全导出。
> 直接拷贝 `PGDATA` 目录到新版本 PostgreSQL 是**不安全**的（跨 major 版本不兼容）。

### 4.1 定位旧盘上的数据目录

```bash
# 挂载旧盘后（示例挂载点 ~/oldroot）
export OLD=/home/szl/oldroot

# PostgreSQL 数据目录：找 PG_VERSION 文件
find $OLD -name PG_VERSION -maxdepth 8 2>/dev/null
# → $OLD/var/lib/docker/volumes/<pg-volume>/_data/PG_VERSION
#   其内容就是 major 版本号，例如 "16"

# MinIO 数据目录：找 MinIO 的内部目录特征
find $OLD -type d -name '.minio.sys' 2>/dev/null
# → $OLD/var/lib/docker/volumes/<minio-volume>/_data/.minio.sys
```

### 4.2 起临时 PostgreSQL（major 版本必须与旧盘一致）

```bash
# 用【与旧盘相同 major 版本】的 PostgreSQL 镜像
docker run -d --name pg-tmp \
  -p 55432:5432 \
  -v $OLD/var/lib/docker/volumes/<pg-volume>/_data:/var/lib/postgresql/data \
  -e POSTGRES_PASSWORD=tmp \
  postgres:<旧盘的 major 版本>
```

等它起来，确认库和表都在：

```bash
docker exec -it pg-tmp psql -U postgres -c '\l'
docker exec -it pg-tmp psql -U postgres -d sse -c '\dt'
```

> 如果旧盘是 `POSTGRES_DB=sse`，容器起来后库名就是 `sse`。
> 如果不是，用 `-e POSTGRES_DB=sse` 指定。
> **不要修改旧盘上的数据**，只读挂载最保险（`:ro`）。

### 4.3 起临时 MinIO

```bash
docker run -d --name minio-tmp \
  -p 59000:9000 -p 59001:9001 \
  -v $OLD/var/lib/docker/volumes/<minio-volume>/_data:/data \
  -e MINIO_ROOT_USER=minioadmin \
  -e MINIO_ROOT_PASSWORD=minioadmin \
  sse-minio:local server /data --console-address ":9001"
```

> ⚠️ 用**你之前恢复出来的 `sse-minio:local` 镜像**（见
> `hermes-tools/Dockerfile.minio-from-binary`）。
> 镜像包随仓库放在 `images/minio/`，导入方式见
> `docs/2026-11-09-sse-deployment.md` §2.3.1。
> 新版 MinIO（2025-09 之后）对旧数据目录的兼容性要实测，
> 若报错可改用旧盘 overlay2 里那个原始二进制直接跑。

确认三个 bucket 都在：

```bash
mc alias set old http://127.0.0.1:59000 minioadmin minioadmin
mc ls old
# 应看到 avatars / invoices / payment-receipts
```

### 4.4 确认数据规模（导出前先看一眼）

```bash
# 数据库
docker exec -it pg-tmp psql -U postgres -d sse -c '\dt'
docker exec -it pg-tmp psql -U postgres -d sse -c \
  "SELECT relname, n_live_tup FROM pg_stat_user_tables ORDER BY n_live_tup DESC;"

# 对象
mc ls --recursive old/invoices | wc -l
mc ls --recursive old/payment-receipts | wc -l
mc ls --recursive old/avatars | wc -l
```

---

## 5. 使用流程

### 5.1 导出（旧盘侧）

```bash
export OUT_DIR=/path/to/sse-export
export SSE_DIR=/path/to/sse-project-root     # 存放 ai-config.json 等的目录

export DB_HOST=127.0.0.1
export DB_PORT=55432
export DB_NAME=sse
export DB_USER=postgres
export DB_PASSWORD=tmp

export MINIO_ENDPOINT=127.0.0.1
export MINIO_PORT=59000
export MINIO_ACCESS_KEY=minioadmin
export MINIO_SECRET_KEY=minioadmin

bash export_sse_data.sh
```

产物结构：

```
sse-export/
├── pg/
│   ├── schema.sql                    # 表结构（用于在空库重建）
│   ├── full_dump.sql                 # 完整逻辑备份（pg_dump -Fc 文本版）
│   └── table_<name>.sql              # 逐表 --column-inserts（导入实际使用）
├── minio/
│   ├── invoices/...
│   ├── payment-receipts/...
│   └── avatars/...
├── files/
│   ├── ai-config.json
│   ├── ai-test-history.json
│   └── env.local                     # .env 的备份（改名存放）
├── meta/
│   ├── table_counts.txt              # 每表行数（导入后校验用）
│   ├── tables_present.txt            # 实际导出了哪些表
│   ├── link_check.txt.<table>        # ★ DB ↔ MinIO 关联清单
│   ├── export_meta.sh                # 源端配置快照（仅供参考，不被导入脚本采用）
│   └── checksums.sha256              # 全量文件校验和
└── manifest.json
```

> **导出是严格只读的** —— 不修改源 PostgreSQL、源 MinIO、源配置文件。

### 5.2 传输到新系统

整个 `sse-export/` 目录拷过去即可（建议 `tar.gz`）。

### 5.3 导入（新系统侧）

```bash
export SSE_DIR=/path/to/sse-project-root

export DB_HOST=127.0.0.1
export DB_PORT=5433
export DB_USER=sse
export DB_PASSWORD=<你的密码>

export MINIO_ENDPOINT=127.0.0.1
export MINIO_PORT=9002
export MINIO_ACCESS_KEY=<你的 key>
export MINIO_SECRET_KEY=<你的 secret>

bash import_sse_data.sh --from /path/to/sse-export --target-db sse
```

流程（8 步）：

```
0/8  前置检查（目录完整性、checksums 校验、连通性、目标库名）
1/8  备份目标系统 ← 回滚基线
2/8  备份目标 MinIO 对象
3/8  导入 PostgreSQL（单事务原子提交）
4/8  导入 MinIO 对象
5/8  导入配置文件
6/8  导入后验证（行数 + 关联校验）
7/8  收尾
```

### 5.4 验证

```bash
bash verify_sse_restore.sh --from /path/to/sse-export
```

四层校验：

1. 每张表行数 vs `meta/table_counts.txt`
2. 每个 bucket 对象数 vs 导出目录
3. **DB ↔ MinIO 关联校验**：每条 DB 记录的 `storage_key` 是否在 MinIO 中存在
4. 每个对象的**内容级 sha256**（能发现文件损坏，不只是数量对）

---

## 6. 回滚机制详解

### 6.1 三重保障

| 层 | 机制 | 覆盖 |
|---|---|---|
| **PostgreSQL** | 导入前 `pg_dump` 快照；导入在**单个 psql 会话的单事务**内完成 | 全部 17 张表 |
| **MinIO** | 导入前把 3 个 bucket 全量备份到 `.rollback-*/minio/`；失败时清空并还原 | 全部对象 |
| **配置文件** | 导入前备份 `ai-config.json` / `ai-test-history.json` / `.env` | 3 个文件 |

### 6.2 触发时机

```bash
trap on_exit EXIT        # 任何非零退出 → 触发回滚
trap '...' INT TERM     # Ctrl-C / SIGTERM → 触发回滚
```

正常完成时 `IMPORT_SUCCEEDED=1`，**不触发回滚**。

> ⚠️ **实测踩过的坑（已修复）**
> 最初用的是 `trap on_error ERR`，而脚本内部走的是 `exit 1`。
> **`exit` 只触发 EXIT trap，不触发 ERR trap** —— 结果失败时完全没有回滚，
> 数据库被覆盖、MinIO 被清空。
> 现在回滚挂在 EXIT trap 上，用 `IMPORT_SUCCEEDED` 区分成功/失败。

### 6.3 失败时输出长这样

```
❌ 导入失败：步骤失败（退出码 1）
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
开始回滚，目标系统将恢复到导入前的状态
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
--- 回滚 MinIO ---
  ✅ bucket invoices 已还原
  ✅ bucket payment-receipts 已还原
  ✅ bucket avatars 已还原
--- 回滚 PostgreSQL ---
  ✅ 数据库已还原到导入前状态
--- 回滚配置文件 ---
  ✅ /path/to/sse/ai-config.json 已还原
  ✅ /path/to/sse/ai-test-history.json 已还原

备份保留在: /path/to/sse-export/.rollback-20261109-111300
回滚完成
```

备份默认保留（便于事后排查）。确认不需要后可删。

### 6.4 手动回滚

```bash
# 找到回滚备份目录
ls -d /path/to/sse-export/.rollback-*

# 恢复数据库
pg_restore -h HOST -p PORT -U USER -d TARGET --clean --if-exists \
  /path/to/sse-export/.rollback-*/backup.dump

# 恢复 MinIO
mc rm --recursive --force new/invoices new/payment-receipts new/avatars
mc mirror --overwrite /path/to/sse-export/.rollback-*/minio/invoices new/invoices
mc mirror --overwrite /path/to/sse-export/.rollback-*/minio/payment-receipts new/payment-receipts
mc mirror --overwrite /path/to/sse-export/.rollback-*/minio/avatars new/avatars

# 恢复配置文件
cp /path/to/sse-export/.rollback-*/files/ai-config.json /path/to/sse/
```

---

## 7. 验证清单

迁移完成后逐项确认：

- [ ] `verify_sse_restore.sh` 输出「全部验证通过」
- [ ] 17 张表行数与旧盘一致
- [ ] 3 个 bucket 对象数与旧盘一致
- [ ] 每个对象内容 sha256 一致（不只是数量）
- [ ] DB ↔ MinIO 关联校验全部命中
- [ ] `ai-config.json` / `ai-test-history.json` 内容正确
- [ ] 应用能登录（用户表 + `password_hash` 迁移正常）
- [ ] 随机抽查 3 张发票，Web 端能打开（presigned URL 正常）
- [ ] 抽查 1 个头像能显示
- [ ] 消息中心能看到历史通知

---

## 8. 实测记录

测试环境：**真实 PostgreSQL 17.11** + **真实 MinIO**（非 mock），
源库 16 张表全部有数据、源 MinIO 5 个对象、3 个配置文件。

### 8.1 成功路径

```
导出:  60 行 DB / 5 个对象 / 3 个配置文件 / 236K
导入:  17 张表全部一致
       3 个 bucket 对象数全对
       5 条关联全部命中
验证:  行数 ✅ ×17
       对象数 ✅ ×3
       关联校验 ✅ 5/5
       内容 checksum ✅ ×5
       全部验证通过
```

### 8.2 回滚用例 1 —— DB 阶段失败

注入：把某个用户的 `phone` 改成与另一用户重复（违反 `users_phone_key`）

```
❌ duplicate key value violates unique constraint "users_phone_key"
❌ 事务已由 PostgreSQL 自动回滚，目标数据库回到导入前状态
✅ 回滚成功：数据库与 MinIO 均回到导入前状态
```

### 8.3 回滚用例 2 —— MinIO 阶段失败

注入：设置环境变量 `INJECT_MINIO_FAIL=invoices`，在 `mc mirror` 前触发失败。

> ⚠️ `INJECT_MINIO_FAIL` 是**仅供自测的故障注入开关**，正常迁移时**不要设置**。
> 它存在的唯一目的是能在不破坏数据的情况下验证回滚逻辑。

```
❌ bucket invoices 导入失败
--- 回滚 MinIO ---     ✅ 3 个 bucket 全部还原
--- 回滚 PostgreSQL --- ✅ 数据库已还原
--- 回滚配置文件 ---    ✅ 已还原
✅ MinIO 阶段失败回滚成功
```

### 8.4 测试中发现并修复的缺陷

这些是**不真跑就交付一定会漏**的问题：

| # | 缺陷 | 后果 | 修复 |
|---|---|---|---|
| 1 | `trap on_error ERR` | `exit 1` 不触发 ERR trap → **完全没有回滚** | 改 `trap on_exit EXIT` + `IMPORT_SUCCEEDED` |
| 2 | 每表独立 `psql` 调用 | 每次 `-f` 是新连接，**事务不连续** → 伪回滚 | 拼成单脚本交单个 psql |
| 3 | `source export_meta.sh` | 导入目标被改回**源库** → 数据写回旧系统 | 只读展示 + 交叉检查 |
| 4 | `--target-db` 不生效 | 同上 | 优先级：命令行 > 环境变量 > 默认值 |
| 5 | `TRUNCATE ... CASCADE` | 级联清空其他表 | 改为按 FK 逆序 `DELETE` |
| 6 | 导入顺序违反 FK | `notification_logs` 引用 `system_messages`，顺序颠倒 | 修正 `IMPORT_ORDER` |
| 7 | `MAX(uuid)` | uuid 主键无 max 函数 | 条件判断（有序列且有 id 列才执行） |
| 8 | `[ ... ] && cmd` 在 `set -e` 下 | 条件为假时脚本**静默退出** | 全量改 `if` 形式 |
| 9 | `rollback` 内 `[ "$X" = "1" ] && return 0` | **第一次回滚就直接退出**，回滚不执行 | 已修 |
| 10 | `schema.sql` 直接执行 | 已有表/函数/索引报冲突 | 改写为 `IF NOT EXISTS` / `OR REPLACE` |
| 11 | `schema_migrations` 无 `id` 列 | 序列重置报错 | 加列存在性判断 |
| 12 | 回滚/备份遍历 `$PWD` | 配置文件被误写到**脚本所在目录**，污染非 SSE 路径 | 只认 `$SSE_DIR` |
| 13 | 导出时 `$PWD` 兜底 | 可能导出**错误的配置文件** | 只认 `$SSE_DIR` |
| 14 | 无关联校验 | DB 与 MinIO 断链无法发现 | 新增 `link_check.txt` + 双向校验 |

---

## 9. 已知限制

### 9.1 需要人工确认的

- **旧盘 PostgreSQL 的 major 版本**：必须用相同 major 版本起临时实例。
  跨 major 版本直接用 `PGDATA` 会失败。
- **旧盘 MinIO 的版本兼容性**：恢复出的 `sse-minio:local` 是
  `RELEASE.2025-09-07T16-13-09Z`（镜像包见仓库 `images/minio/`）。若旧盘数据目录来自更早版本，
  可能需要用更早的二进制。
- **extension 依赖**：本工具用**逻辑导出**，不复制 extension 二进制。
  若目标库缺少源库用到的 extension，需先装好。

### 9.2 本工具不覆盖的

- **Redis / 队列 / 缓存**：SSE 若有 job 队列（如 OCR 异步任务），
  其中的待处理任务不在这三个存储里。
- **SSE 之外的应用数据**：只针对 `sse` 项目。
- **用户密码**：迁移的是 `password_hash` 原文，能直接登录；
  但**不会**在日志/文档中输出任何凭据。

### 9.3 测试专用开关

| 环境变量 | 作用 | 何时用 |
|---|---|---|
| `INJECT_MINIO_FAIL=<bucket>` | 在该 bucket 上传前强制失败 | **仅自测**。正常迁移绝不要设置 |
| `INJECT_MINIO_FAIL` 在 `import_sse_data.sh` 中 | 同上 | 同上 |

`test_rollback.sh` / `test_rollback_minio.sh` 会自动设置这些变量。

### 9.4 行为约定

- 导入会**清空目标 bucket** 再上传（保证与源一致）。
  目标系统里源端没有的同名对象会被删除 —— 这是预期行为。
- 导入会**清空目标表**再插入（同一事务内）。
- `.env` 若目标已存在，默认**不覆盖**（日志会提示），避免冲掉新系统的凭据。

---

## 10. 故障排查

| 症状 | 原因 | 处理 |
|---|---|---|
| `无法连接 PostgreSQL` | 端口/密码错 | 检查 `DB_PORT`/`DB_PASSWORD` |
| `导出包完整性校验通过` 失败 | 传输过程中文件损坏 | 重新拷贝，核对 `meta/checksums.sha256` |
| `目标库缺失的表: xxx` | 目标库太老 | 正常，脚本会自动补建 |
| `建表遇到致命错误` | 目标库版本差异太大 | 看报错里的表/列名，手动处理 |
| `mc alias 设置失败` | MinIO 不可达或凭据错 | 检查 `MINIO_PORT`/`MINIO_*` |
| `duplicate key ... unique constraint` | 目标表没清干净 | 脚本已按 FK 逆序 DELETE；如仍报错检查是否有外部触发器 |
| `function max(uuid) does not exist` | 旧版脚本 | 用本版本（已修） |
| `关联断裂` | 对象没上传成功 | 看 `.rollback-*` 里的备份；检查 MinIO 权限 |
| 导入后应用报找不到表 | 目标库不是同一个 | 确认 `--target-db` 与 `DB_NAME` 一致 |

### 诊断用命令

```bash
# 导出包里有什么
cat sse-export/meta/tables_present.txt
cat sse-export/meta/table_counts.txt
cat sse-export/meta/link_check.txt.invoices

# 目标库实际状态
psql -d sse -c '\dt'
psql -d sse -c "SELECT COUNT(*) FROM users"

# 对象实际状态
mc ls --recursive new/invoices

# 校验文件完整性
cd sse-export && sha256sum -c meta/checksums.sha256
```

---

## 附：环境速查

```bash
# MinIO 镜像来自仓库 images/minio/（导入见 docs/2026-11-09-sse-deployment.md §2.3.1）

# 旧盘临时实例
docker run -d --name pg-tmp -p 55432:5432 \
  -v $OLD/.../_data:/var/lib/postgresql/data \
  -e POSTGRES_PASSWORD=tmp -e POSTGRES_DB=sse postgres:16

docker run -d --name minio-tmp -p 59000:9000 -p 59001:9001 \
  -v $OLD/.../_data:/data \
  -e MINIO_ROOT_USER=minioadmin -e MINIO_ROOT_PASSWORD=minioadmin \
  sse-minio:local server /data --console-address ":9001"

# 新系统目标（SSE compose 默认端口）
export DB_HOST=127.0.0.1 DB_PORT=5433 DB_NAME=sse
export MINIO_ENDPOINT=127.0.0.1 MINIO_PORT=9002
```

---

*文档基于实测生成。所有"✅"均来自真实执行输出，非推断。*
