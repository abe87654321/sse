# SSE 离线恢复工具集（从旧盘取证 → 新系统恢复）

> **本目录是独立交付件，与 `hermes-tools\sse-data` 并列，互不覆盖。**
> `sse-data` 是"新系统之间的逻辑迁移层"（起服务、用 API 导出导入）；
> 本目录是"旧盘取证层"（**完全离线**，直接解析 PGDATA 与 MinIO `xl.meta` 文件，
> **不启动旧盘上的任何服务**）。

---

## 1. 这套工具解决什么问题

旧 SSD 无法启动（挂载在 `192.168.3.107:/home/szl/oldroot/`，ext4 **只读**）。
上面有 SSE 的 PostgreSQL 数据卷和 MinIO 数据卷。

目标：**不修改旧盘一个字节、不启动旧盘任何服务**，把业务数据完整取出来，
再恢复到新系统。

**核心原则 —— 两层职责分离：**

```
┌─ 旧盘取证层（本目录，完全离线）──────────────────────┐
│  PGDATA ──→ pg_offline_export.py ──→ CSV + schema.sql │
│  MinIO   ──→ minio_offline_export.py ──→ 原始对象文件  │
│  配置文件 ──→ 直接复制                                │
└──────────────────────────────────────────────────────┘
                        ↓ build_import_package.py
┌─ 新系统恢复层（sse-data，已验证）────────────────────┐
│  import_sse_data.sh  ──→ 目标 PostgreSQL + MinIO      │
│  verify_sse_restore.sh ──→ 独立验证                    │
│  失败自动回滚（DB / MinIO / 配置 三重保障）            │
└──────────────────────────────────────────────────────┘
```

---

## 2. 旧盘只读保证

| 层面 | 措施 | 实测结果 |
|---|---|---|
| 文件系统 | 旧盘是 ext4 `ro` 挂载 | 物理写不进去 |
| 数据访问 | 一律"**只读复制 → 在副本上操作**" | 原 PGDATA **1379 个文件 0 修改** |
| PostgreSQL | `postgres --single` 会写 `pg_control`/`pg_wal`/`pg_xact` | **必须在副本上跑**（实测改 7 个文件） |
| MinIO | 纯文件解析，不启动服务 | 源目录零写入 |

> ⚠️ `postgres --single` 虽然不监听端口、不起后台进程，**但确实会写 PGDATA**。
> 绝不能直接指向旧盘路径。

---

## 3. 工具清单

### 3.1 探查阶段

| 文件 | 作用 |
|---|---|
| `probe_oldroot.py` | 只读扫描旧盘，定位 Docker volume / PGDATA / MinIO 数据目录 / 配置文件 |

### 3.2 离线提取阶段

| 文件 | 作用 |
|---|---|
| `pg_offline_export.py` | 复制 PGDATA → 副本 → `postgres --single` → 服务端 `COPY` 导出 CSV + `schema.sql` |
| `xlmeta_parse.py` | MinIO `xl.meta` v2 解析器（支持小对象内联 / 大对象 `part.N` 两种布局） |
| `minio_offline_export.py` | 遍历 MinIO 数据目录，导出全部对象内容 + manifest + checksum |

### 3.3 转换阶段

| 文件 | 作用 |
|---|---|
| `build_import_package.py` | 离线结果 → 标准导入包（`pg/` `minio/` `files/` `meta/`） |
| `transform_approver_id.py` | 旧盘 `approver_id`（角色名）→ 新 schema 需要的 uuid，**显式转换并留痕** |
| `filter_insert_columns.py` | 按**目标库真实列结构**对齐 INSERT（剔除多余列 / 补齐缺失列） |

### 3.4 验证阶段

| 文件 | 作用 |
|---|---|
| `verify_olddisk_recovery.py` | 离线提取结果的自检（DB↔MinIO 关联命中率） |
| `colmeta.sql` | 目标库列元数据查询（供 `filter_insert_columns.py` 使用） |

### 3.5 复用 `sse-data` 的部分

`import_sse_data.sh` / `verify_sse_restore.sh` / `test_rollback.sh` /
`test_rollback_minio.sh` 在本目录是**改进后的副本**，改进了：

- `--target-db` 参数支持（验证器原本缺失，会验错库）
- 跳过消息改走 stderr（原本会混进 SQL 文件导致语法错误）
- 接入列自动对齐
- 回滚测试基线标记改为动态选取真实行

---

## 4. 使用流程

### 步骤 1 — 探查旧盘

```bash
python3 probe_oldroot.py --root /home/szl/oldroot --out probe_report.json
```

产出 `probe_report.json`，列出所有 Docker volume、PGDATA、MinIO 数据目录、配置文件位置。

### 步骤 2 — 离线提取 PostgreSQL

```bash
# 在有 PostgreSQL 16 二进制的机器上执行（版本必须与旧盘一致）
python3 pg_offline_export.py \
    --pgdata  /path/to/pgdata-copy \
    --pgbin   /path/to/postgresql/16/bin \
    --dbname  sse \
    --outdir  pg-export
```

产出：
- `pg-export/db/<table>.csv` — 16 张表
- `pg-export/schema.sql` — 真实表结构（含类型、NOT NULL、默认值）
- `pg-export/db_row_counts.json` — 各表行数（**按 CSV 记录数统计**，不是物理行数）

### 步骤 3 — 离线提取 MinIO

```bash
python3 minio_offline_export.py \
    --datadir /path/to/minio-data-copy \
    --outdir  minio-export
```

产出：`minio-export/<bucket>/<key>` 原始对象文件 + `_meta/objects.csv` + checksums。

### 步骤 4 — 构建导入包

```bash
python3 build_import_package.py \
    --recovered  olddisk-recovered/ \
    --outdir     olddisk-package/ \
    --schema     olddisk-recovered/pg-export/schema.sql \
    --source-host 192.168.3.107
```

### 步骤 5 — 导入新系统（带回滚）

```bash
bash import_sse_data.sh --from olddisk-package --target-db sse_new
```

### 步骤 6 — 独立验证

```bash
bash verify_sse_restore.sh --from olddisk-package --target-db sse_new
```

---

## 4B. 在目标电脑上执行（`ubuntuhome` / 192.168.3.107 专用）

目标电脑上**宿主机没有安装 psql**，PostgreSQL 跑在 `sse-postgres-1` 容器里。
所有脚本都支持通过 `PG_CONTAINER` 走 `docker exec`，**无需在宿主机安装任何东西**。

### 前置条件

| 组件 | 目标机上的位置 | 说明 |
|---|---|---|
| PostgreSQL | 容器 `sse-postgres-1` | 16.15，与旧盘 major 一致 |
| PostgreSQL 映射端口 | `5433` | 容器内 5432 → 宿主 5433 |
| MinIO | 容器 `sse-minio-1` | 映射端口 `9002`（API）/ `9003`（控制台） |
| `mc` 客户端 | `~/tmp/bin/mc` | MinIO 官方客户端，需在 PATH 中 |
| `msgpack` | 已装 | xl.meta 解析用 |

> **不需要 ICU / 不需要 `postgres --single`**
> 步骤 1–4（探查、提取、构建）已经完成，导入包里就是最终的 CSV 和对象文件。
> 目标机只做步骤 5–6，即"导入 + 验证"，全程只用 `psql` 和 `mc`，
> **不需要 PostgreSQL 单用户模式，也就完全不涉及 ICU 动态库**。

### 执行命令

```bash
cd ~/tmp/sse-offline-recovery

export PG_CONTAINER=sse-postgres-1      # 走容器里的 psql/pg_dump/pg_restore
export DB_PORT=5433
export DB_USER=sse
export DB_PASSWORD=sse_dev
export MINIO_ENDPOINT=127.0.0.1
export MINIO_PORT=9002
export MINIO_ACCESS_KEY=minioadmin
export MINIO_SECRET_KEY=minioadmin
export SSE_DIR=~/projects/sse
export PATH=~/tmp/bin:$PATH             # 让脚本找到 mc

# 导入
bash import_sse_data.sh --from olddisk-package --target-db sse

# 独立验证
bash verify_sse_restore.sh --from olddisk-package --target-db sse
```

### 也可以不依赖容器（宿主机装了 postgresql-client 时）

```bash
unset PG_CONTAINER
# 此时脚本直接用宿主机的 psql/pg_dump/pg_restore，连接 127.0.0.1:5433
```

### 回滚测试（可选）

```bash
export MC_ALIAS=sse-import
mc alias set sse-import http://127.0.0.1:9002 minioadmin minioadmin

bash test_rollback.sh        olddisk-package sse ~/projects/sse
bash test_rollback_minio.sh  olddisk-package sse ~/projects/sse
```

> ⚠️ 回滚测试会**故意制造导入失败**来验证回滚能力。
> 它会在目标库和目标 MinIO 上操作，跑之前请确认目标环境是可丢弃的演练环境，
> 或先跑一次 `import_sse_data.sh`（它自带 `pg_dump` 快照 + MinIO 全量备份）。

---

## 5. MinIO `xl.meta` 格式（逆向成果）

Magic：`584c3220` / ASCII `XL2 `。

**顶层结构**（msgpack，entries 从 offset **8** 开始）：

| 索引 | 含义 |
|---|---|
| `[0]` | 嵌套 msgpack —— 完整的 `V2Obj` stat |
| `[1]` | 版本 |
| `[2]` | flags |
| `[3]` | 数据 dict |

**stat 里的关键字段**：`Size`、`MTime`、`MetaSys`、`MetaUsr`、`ETag`、`DDir`。

**两种布局：**

| 类型 | 判据 | 内容位置 |
|---|---|---|
| 小对象 | `MetaSys` 含 `x-minio-internal-inline-data=true` | 内联在 `xl.meta` 里 |
| 大对象 | `MetaSys` 为空 | `<objdir>/<DDir-UUID>/part.N` |

**inline payload 边界推导**（不靠文件魔数、不靠搜特征字节）：

```
header_len = len(inline_blob) - stat.Size     # 实测恒为 32 字节
payload    = inline_blob[header_len:]
```

**`DDir` 是 16 字节二进制 UUID**，转成 hex 是 32 字符无连字符，
但**磁盘目录名是带连字符的 UUID 字符串**：

```
xl.meta 里:  0ac8cd6854564479a91dffdac10adb97   ← bytes.hex()
磁盘目录名:  0ac8cd68-5456-4479-a91d-ffdac10adb97 ← uuid.UUID()
```

---

## 6. 踩过的坑（都是实测踩出来的）

### 6.1 `storage_key` 语义 —— 双重 bucket 前缀

SSE 源码 `packages/api/src/routes/experiments.ts`：

```ts
const storageKey = `invoices/${req.params.id}/${itemId}_${Date.now()}.${ext}`;
await minio.upload(storageKey, 'invoices', ...);   // → putObject(bucket='invoices', key=storageKey)
```

所以**磁盘全路径 = `bucket + '/' + storage_key`**：

```
storage_key (DB) : invoices/1081eb9b-.../xxx.pdf
bucket (DB)      : invoices
磁盘全路径        : invoices/invoices/1081eb9b-.../xxx.pdf   ← 注意双层
```

> 早期注释断言"storage_key 本身是完整 object key，不要再拼 bucket" —— **是错的**。

### 6.2 `avatar_url` 不拼 bucket

```ts
await minio.getObject(user.avatarUrl, 'avatars');  // bucket='avatars', key=avatar_url
```

`users.avatar_url` 的值 = MinIO 的 **key**（不含 bucket），
所以头像比对时**不能**再拼一层 bucket。

### 6.3 CSV 里 NULL 与空字符串必须区分

`COPY` 默认把 NULL 输出成空字段 → `parent_id`(NULL) 和 `password_hash`(`''`) 无法分辨。

**解法**：`COPY ... WITH (FORMAT csv, HEADER, NULL '\N')`，
生成端用 `\N` 标记 NULL，空字符串仍是空字段。

### 6.4 行数必须按 CSV 记录数统计

jsonb / text 字段含换行时，**一条记录占多个物理行**：

```
notification_logs:  物理行 135  ← 错
                    实际记录 49  ← 对
```

用 `wc -l` 统计会得到虚高数字。必须用 `csv.reader` 计数。
**已用 PostgreSQL 自身 `count(*)` 逐表交叉核对，确认数据无丢失。**

### 6.5 一条 INSERT 必须只占一个物理行

`system_messages.body` 是多行变更日志。直接把换行内嵌进 `.sql` 文件，
一条 INSERT 会横跨多行，下游按行 `grep` 的导入器只能取到第一行 → SQL 残缺。

**解法**：统一用 PostgreSQL `E'...'` 转义字符串形式，把换行/回车/制表符
转成 `\n` / `\r` / `\t`，保证每条 INSERT 单行。

### 6.6 数组列不能当字符串塞

`target_roles` 是 `text[]`，CSV 里是 `{admin,dept_approver,finance}`。
当成字符串 `'{...}'` 塞进 `text[]` 列会报错。必须按数组字面量生成，
元素含逗号/花括号/空格时逐个加双引号。

### 6.7 旧盘实际库结构与自己的 migration 漂移

**旧盘线上真实的 `approval_records.approver_id` 是 `character varying(50)`，
存的是角色名（`admin` / `finance`）** —— 但旧盘自己的 migration 文件写的是 `UUID`。

当前 SSE 的 migration 已经改回 `uuid REFERENCES users(id)`，
直接导会报 `invalid input syntax for type uuid: "finance"`。

**权威映射来源 = `approval_rules.approval_chain`**（审批链在创建时就绑定了实际审批人）：

```json
{"role": "admin",   "assigneeId": "3e856835-...", "assigneeName": "系统管理员"}
{"role": "finance", "assigneeId": "a7e2c5f4-...", "assigneeName": "王钰"}
```

比"按 `users.role` 反查"准确 —— `admin` 角色有 2 个用户，但审批链指定了实际那个人。

映射结果写进 `meta/semantic_transform.json`，**可审计**，不静默改写。

### 6.9 离线提取的 schema.sql 不含自定义唯一约束

`pg_offline_export.py` 导出的 `schema.sql` 只有表定义（列、类型、DEFAULT），
**没有 UNIQUE / CHECK / FOREIGN KEY 等自定义约束**。

后果：
- 想靠唯一约束做回滚测试的注入点，**在恢复出来的目标库上不会触发**
- 目标库的唯一约束来自它自己的 migration，与源库 schema.sql 无关

注入失败时改用 `NOT NULL` 冲突（PostgreSQL 内建，不依赖任何自定义约束）。

### 6.10 `pg_restore` 的 `-f` 是【输出】文件，不是输入文件

```bash
pg_restore -d mydb -f backup.dump     # ❌ 错：-f 是输出文件，会写出空文件
pg_restore: error: input file is too short (read 0, expected 5)

pg_restore -d mydb backup.dump         # ✅ 对：归档用【位置参数】传
```

归档必须作为**位置参数**。这个错误在容器模式里尤其隐蔽：
`docker cp` 明明成功、`pg_restore` 却报"文件太短"。

### 6.11 `set -euo pipefail` 会让"正常的空结果"终止脚本

```bash
set -euo pipefail
FATAL=$(grep "ERROR:" err.log | grep -viE "already exists" | head -10)
# 若 grep 把内容全过滤掉（正是"没有致命错误"的情况），
# grep 退出码为 1，pipefail 把它传播给赋值语句 → 脚本直接中止！
```

同理 `grep -c PAT file || echo 0` 会得到 `"0\n0"`（grep 已输出 0 且退出码为 1，
`|| echo 0` 又追加一行 0），后续 `[ "$C" -gt 0 ]` 报 `integer expression expected`。

**解法**：管道包一层 `{ ...; true; }`。

### 6.12 `docker exec` 不会解释 psql 的 `-d`

`docker exec <容器> psql -U sse -d sse_new` 里的 `-d` 是 **psql 的 --dbname**，
真实 `docker exec` 会原样传给容器内命令。

写 `docker` 模拟脚本时若把 `-d` 当成 `--detach` 处理，
查询会连到默认库（通常是 `postgres`），表现为"表不存在"。

### 6.8 目标库可能比源数据多/少列

旧盘 `expense_reports` 有 `description` 列，当前 migration 已删除。
`filter_insert_columns.py` 按**目标库真实列**自动对齐：
目标库没有的列剔除、目标库有而源数据没有的列用 DEFAULT/NULL 补齐、
NOT NULL 且无默认值的缺失列**直接失败**（不静默丢数据）。

---

## 7. 实测结果（真实旧盘数据）

### 离线提取

```
PostgreSQL 16  →  16 张表全部提取，264 行，schema.sql 完整
MinIO          →  16/16 对象，3 bucket，0 错误
原 PGDATA      →  1379 个文件 0 修改
```

> 旧盘共 16 张业务表；导入新系统时 15 张有数据
> （`identity_mappings` 为 0 行，`schema_migrations` 是迁移元数据表、无业务数据）。

### 导入新系统

```
✅ 15 张表导入完成（单事务原子提交）
   users 7 · expense_categories 8 · expense_reports 4 · expense_items 11
   invoices 8 · approval_records 4 · approval_rules 3 · reasoning_rules 1
   mcp_api_keys 5 · ontology_snapshots 77 · notification_logs 49
   notification_deliveries 68 · system_messages 13 · payment_receipts 3
   payment_audit_logs 3

✅ MinIO: invoices 8 · payment-receipts 3 · avatars 5
✅ 配置: ai-config.json · ai-test-history.json · .env
```

### 独立验证（`verify_sse_restore.sh`）

```
✅ 15/15 张表行数一致
✅ 3/3 bucket 对象数一致
✅ 16/16 对象内容 checksum 一致
✅ 15/15 数据库↔MinIO 关联命中
✅ 配置文件存在
════════ 全部验证通过 ════════
```

### 回滚测试

```
✅ DB 阶段失败回滚   —— 注入 NOT NULL 冲突 → DB/MinIO/配置全部还原
✅ MinIO 阶段失败回滚 —— 注入 bucket 写入失败  → DB/MinIO/配置全部还原
```

> 注入方式说明：早期版本靠 `users_phone_key` 唯一约束触发失败，
> 但离线提取的 `schema.sql` **不包含自定义唯一约束**（见 6.9），
> 所以改成注入 `NOT NULL` 冲突 —— 触发的是 PostgreSQL 内建的
> `not_null_violation`，在任何目标库上都稳定生效。

---

## 8. 依赖

| 组件 | 要求 | 目标机上是否需要 |
|---|---|---|
| Python | 3.9+（`pg_offline_export.py` / `minio_offline_export.py` 需要 `msgpack`） | 仅提取阶段需要 |
| PostgreSQL | **必须与旧盘 major 版本一致**（本次为 16.15），仅用于 `postgres --single` | 提取阶段需要；**导入阶段不需要** |
| MinIO | **不需要** —— 直接解析文件 | 不需要 |
| `psql` / `pg_dump` / `pg_restore` | 导入与验证阶段使用 | 宿主机没有 → 用 `PG_CONTAINER` 走容器 |
| `mc` | 导入与验证阶段使用 | 需要（`~/tmp/bin/mc`） |
| ICU 动态库 | 仅 `postgres --single` 需要（Debian 的 PG16 链接 ICU 72） | **不需要**（不重新提取） |

```bash
pip install msgpack
```

> **关于 ICU**：PostgreSQL 单用户模式（`postgres --single`）用的是 Debian 打包的二进制，
> 它链接的是 ICU 72；而 Ubuntu 24.04 系统自带的是 ICU 78，直接跑会报
> `libicui18n.so.72: cannot open shared object file`。
>
> **本流程不需要解决这个问题**：
> - 若要**重新提取**旧盘 → 宿主机缺 ICU 72，用容器里的 `postgres`（Alpine 版，ICU 78 齐全）
>   或解包 ICU 72 的 `.deb` 后用 `LD_LIBRARY_PATH` 指过去
> - 若只是**导入已构建好的包**（本工具集随附的 `olddisk-package`）→ 只用 `psql` 和 `mc`，
>   **完全不涉及 ICU**

---

## 9. 安全注意事项

- 本目录的脚本**不含任何凭据**；SSH/sudo 密码通过 `SSH_ASKPASS` 临时注入，不落盘。
- 旧盘路径**只读**；所有写操作只发生在副本和目标系统上。
- `test_rollback_minio.sh` 的 `INJECT_MINIO_FAIL` **仅供内部测试**，生产导入时不要设置。
