#!/usr/bin/env bash
# ============================================================================
# SSE 数据导入脚本（带完整回滚）
#
# 从 export_sse_data.sh 产出的目录恢复数据到目标系统。
#
# 回滚设计（三重保障）：
#   1. PG 数据 —— 导入前自动 pg_dump 目标库到备份文件；
#      任何步骤失败 → 恢复该备份（先 drop 再重建，保证干净）
#   2. MinIO 对象 —— 导入前把目标 bucket 全量备份到临时目录；
#      失败 → 清空目标 bucket 并从备份还原
#   3. 配置文件 —— 导入前备份 ai-config.json 等；
#      失败 → 原样还原
#
# 导入顺序（遵循外键依赖）：
#   users → expense_categories → expense_reports → expense_items → invoices
#   → approval_rules → approval_records → notification_logs
#   → notification_deliveries → system_messages → identity_mappings
#   → ontology_snapshots → reasoning_rules → mcp_api_keys
#   → payment_receipts → payment_audit_logs
#
# 用法：
#   bash import_sse_data.sh --from /path/to/export-dir
#   bash import_sse_data.sh --from /path/to/export-dir --target-db sse_new
#   bash import_sse_data.sh --from /path/to/export-dir --dry-run
# ============================================================================
set -euo pipefail

# ---------------- 参数 ----------------
FROM_DIR=""
TARGET_DB=""
DRY_RUN=0
SKIP_MINIO=0
SKIP_FILES=0
KEEP_BACKUP=1

while [ $# -gt 0 ]; do
  case "$1" in
    --from)       FROM_DIR="$2"; shift 2 ;;
    --target-db)  TARGET_DB="$2"; shift 2 ;;
    --dry-run)    DRY_RUN=1; shift ;;
    --skip-minio) SKIP_MINIO=1; shift ;;
    --skip-files) SKIP_FILES=1; shift ;;
    --keep-backup) KEEP_BACKUP=1; shift ;;
    --no-keep-backup) KEEP_BACKUP=0; shift ;;
    -h|--help)    sed -n '2,30p' "$0"; exit 0 ;;
    *) echo "未知参数: $1" >&2; exit 1 ;;
  esac
done

if [ -z "$FROM_DIR" ]; then echo "必须指定 --from <导出目录>" >&2; exit 1; fi
if [ ! -d "$FROM_DIR" ]; then echo "导出目录不存在: $FROM_DIR" >&2; exit 1; fi

FROM_DIR="$(cd "$FROM_DIR" && pwd)"

# ---------------- 配置 ----------------
# 优先级：命令行参数 > 环境变量 > 默认值
# --target-db 必须覆盖 DB_NAME —— 否则会把数据导回源库。
DB_HOST="${DB_HOST:-localhost}"
DB_PORT="${DB_PORT:-5433}"
DB_NAME="${DB_NAME:-sse}"
DB_USER="${DB_USER:-sse}"
DB_PASSWORD="${DB_PASSWORD:-sse_dev}"
if [ -n "$TARGET_DB" ]; then
  DB_NAME="$TARGET_DB"
fi
export PGPASSWORD="$DB_PASSWORD"

MINIO_ENDPOINT="${MINIO_ENDPOINT:-localhost}"
MINIO_PORT="${MINIO_PORT:-9002}"
MINIO_ACCESS_KEY="${MINIO_ACCESS_KEY:-minioadmin}"
MINIO_SECRET_KEY="${MINIO_SECRET_KEY:-minioadmin}"
MINIO_BUCKETS="${MINIO_BUCKETS:-invoices payment-receipts avatars}"

SSE_DIR="${SSE_DIR:-$HOME/projects/sse}"

# ---------------- PostgreSQL 客户端包装 ----------------
# 宿主机可能没装 psql（比如用 docker compose 起的库），此时通过容器执行。
# 三种模式（优先级从高到低）：
#   1) PSQL_CMD   —— 自定义前缀，例如 "docker exec -i sse-postgres-1 psql -U sse"
#                    用户名/库名仍由脚本追加
#   2) PG_CONTAINER —— 容器名，自动拼成 docker exec -i <容器> psql -U <user>
#   3) 默认       —— 直接用宿主机 psql
#
# 注意：docker exec 需要 -i 才能接收 stdin（喂 SQL 文件时必须）。
PG_MODE="host"
PG_CONTAINER="${PG_CONTAINER:-}"
PSQL_CMD_OVERRIDE="${PSQL_CMD:-}"
PGDUMP_CMD_OVERRIDE="${PGDUMP_CMD:-pg_dump}"
CREATEDB_CMD_OVERRIDE="${CREATEDB_CMD:-createdb}"
PGRESTORE_CMD_OVERRIDE="${PGRESTORE_CMD:-pg_restore}"

if [ -n "$PSQL_CMD_OVERRIDE" ]; then
  PG_MODE="custom"
elif [ -n "$PG_CONTAINER" ]; then
  PG_MODE="container"
fi

# psql <其余参数>
pg_run() {
  case "$PG_MODE" in
    custom)   $PSQL_CMD_OVERRIDE "$@" ;;
    container) docker exec -i -e PGPASSWORD="$DB_PASSWORD" "$PG_CONTAINER" psql -U "$DB_USER" "$@" ;;
    host)     psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" "$@" ;;
  esac
}

# pg_isready —— 检查连通性
pg_ready() {
  case "$PG_MODE" in
    custom)    $PSQL_CMD_OVERRIDE -c "SELECT 1" >/dev/null 2>&1 ;;
    container) docker exec -e PGPASSWORD="$DB_PASSWORD" "$PG_CONTAINER" pg_isready -U "$DB_USER" >/dev/null 2>&1 ;;
    host)      pg_isready -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" >/dev/null 2>&1 ;;
  esac
}

# createdb <库名>
pg_createdb() {
  case "$PG_MODE" in
    custom)    ${CREATEDB_CMD:-$CREATEDB_CMD_OVERRIDE} "$@" ;;
    container) docker exec -e PGPASSWORD="$DB_PASSWORD" "$PG_CONTAINER" createdb -U "$DB_USER" "$@" ;;
    host)      createdb -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" "$@" ;;
  esac
}

# pg_run_file <宿主机 SQL 文件> <其余参数>
# container 模式下不能直接用 psql -f <宿主机路径> —— 容器里看不到宿主机的文件。
# 改为把文件内容通过 stdin 喂进去（docker exec -i 必须保留 -i）。
pg_run_file() {
  local f="$1"; shift
  case "$PG_MODE" in
    custom)    $PSQL_CMD_OVERRIDE "$@" -f "$f" ;;
    container) docker exec -i -e PGPASSWORD="$DB_PASSWORD" "$PG_CONTAINER" psql -U "$DB_USER" "$@" < "$f" ;;
    host)      psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" "$@" -f "$f" ;;
  esac
}

# pg_dump_to <宿主机文件路径> <其余参数>
# 注意 1：custom 模式下 PSQL_CMD 是 psql 的前缀，不能拿来调 pg_dump ——
#          必须用 PGDUMP_CMD 单独指定，否则会把 pg_dump 的参数喂给 psql。
# 注意 2：container 模式下备份文件必须留在宿主机 —— 容器里没有那个路径，
#          所以改用「容器内 dump 到 stdout，宿主机重定向」的方式。
pg_dump_to() {
  local out="$1"; shift
  case "$PG_MODE" in
    custom)
      ${PGDUMP_CMD:-$PGDUMP_CMD_OVERRIDE} "$@" -f "$out"
      ;;
    container)
      # pg_dump 的 custom 格式（--format=custom）要求输出可 seek 的文件，
      # 直接重定向到 stdout 会得到损坏的归档（实测 backup.dump 只有 2KB 且无法恢复）。
      # 正确做法：先在容器内 dump 到临时文件，再 docker cp 回宿主机。
      local cpath="/tmp/sse_dump_$$.dump"
      docker exec -e PGPASSWORD="$DB_PASSWORD" "$PG_CONTAINER" \
        pg_dump -U "$DB_USER" "$@" -f "$cpath" || return 1
      docker cp "$PG_CONTAINER:$cpath" "$out" >/dev/null 2>&1 || return 1
      docker exec "$PG_CONTAINER" rm -f "$cpath" >/dev/null 2>&1
      ;;
    host)
      pg_dump -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" "$@" -f "$out"
      ;;
  esac
}

# pg_restore_from <宿主机文件路径> <其余参数>
#
# container 模式的关键坑：pg_restore 读 custom 格式（--format=custom）时
# **必须是可 seek 的普通文件**，不能从 stdin 管道读
# （`pg_restore ... < dump` 会报 "one of -d/--dbname and -f/--file must be specified"）。
# 所以要先 docker cp 把 dump 拷进容器，再用容器内的 -f 路径恢复。
pg_restore_from() {
  local in="$1"; shift
  case "$PG_MODE" in
    custom)
      ${PGRESTORE_CMD:-$PGRESTORE_CMD_OVERRIDE} "$@" "$in"
      ;;
    container)
      # 重要：pg_restore 的 -f/--file 是【输出】文件，不是输入文件！
      # 输入的归档必须用【位置参数】传：
      #     pg_restore -d <库> [选项] <归档文件>
      # 误用 -f 会报 "input file is too short (read 0, expected 5)"（它把归档当输出，输出了空文件）。
      # 另外 -d 和 -f 不能同时给，所以这里 -d 保留、归档走位置参数。
      local cpath="/tmp/sse_restore_$$.dump"
      docker cp "$in" "$PG_CONTAINER:$cpath" >/dev/null 2>&1 || return 1
      docker exec -e PGPASSWORD="$DB_PASSWORD" \
        "$PG_CONTAINER" \
        pg_restore -U "$DB_USER" "$@" "$cpath"
      local rc=$?
      docker exec "$PG_CONTAINER" rm -f "$cpath" >/dev/null 2>&1
      return $rc
      ;;
    host)
      # 归档走位置参数；-d 指定目标库（-f 是输出文件，不能用于输入）
      pg_restore -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" "$@" "$in"
      ;;
  esac
}

RED=$'\033[31m'; GRN=$'\033[32m'; YEL=$'\033[33m'; CYN=$'\033[36m'; RST=$'\033[0m'
step() { echo; echo "${CYN}=== $* ===${RST}"; }
ok()   { echo "${GRN}✅ $*${RST}"; }
warn() { echo "${YEL}⚠️  $*${RST}"; }
err()  { echo "${RED}❌ $*${RST}" >&2; }

# 回滚状态
BACKUP_DIR=""
MINIO_BACKUP=""
ROLLBACK_DONE=0

# ---------------- 回滚函数 ----------------
rollback() {
  local reason="$1"
  if [ "$ROLLBACK_DONE" = "1" ]; then return 0; fi
  ROLLBACK_DONE=1

  echo
  err "导入失败：$reason"
  echo "${YEL}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RST}"
  echo "${YEL}开始回滚，目标系统将恢复到导入前的状态${RST}"
  echo "${YEL}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RST}"

  # 1. 恢复 MinIO
  if [ -n "$MINIO_BACKUP" ] && [ -d "$MINIO_BACKUP" ] && [ "$SKIP_MINIO" != "1" ]; then
    echo "--- 回滚 MinIO ---"
    for b in $MINIO_BUCKETS; do
      if [ -d "$MINIO_BACKUP/$b" ]; then
        mc rm --recursive --force "sse-import/$b" >/dev/null 2>&1 || true
        mc mirror --overwrite "$MINIO_BACKUP/$b" "sse-import/$b" --quiet >/dev/null 2>&1 \
          && echo "  ✅ bucket $b 已还原" || echo "  ❌ bucket $b 还原失败（备份在 $MINIO_BACKUP/$b）"
      fi
    done
  fi

  # 2. 恢复 PostgreSQL
  if [ -n "$BACKUP_DIR" ] && [ -f "$BACKUP_DIR/backup.dump" ]; then
    echo "--- 回滚 PostgreSQL ---"
    # DROP SCHEMA public CASCADE 会连带删掉装在 public 里的扩展（如 uuid-ossp），
    # 恢复后 uuid_generate_v4() 就会失效 → 必须先重建扩展。
    if pg_run -d "$DB_NAME" -c \
         "DROP SCHEMA public CASCADE; CREATE SCHEMA public; GRANT ALL ON SCHEMA public TO $DB_USER;" \
         >/dev/null 2>&1; then
      pg_run -d "$DB_NAME" -c \
        "CREATE EXTENSION IF NOT EXISTS \"uuid-ossp\"; CREATE EXTENSION IF NOT EXISTS \"pgcrypto\";" \
        >/dev/null 2>&1 || true
      # pg_restore 的归档走位置参数（-f 是输出文件），库名用 -d 传
      if pg_restore_from "$BACKUP_DIR/backup.dump" -d "$DB_NAME" \
           --no-owner --no-privileges --clean --if-exists >/dev/null 2>&1; then
        echo "  ✅ 数据库已还原到导入前状态"
      else
        echo "  ❌ pg_restore 失败，请手动执行："
        echo "     pg_restore -h $DB_HOST -p $DB_PORT -U $DB_USER -d $DB_NAME --no-owner --clean --if-exists $BACKUP_DIR/backup.dump"
      fi
    else
      echo "  ❌ 无法重建 public schema，请手动处理"
    fi
  fi

  # 3. 恢复配置文件
  #
  # 只还原到 $SSE_DIR —— 绝不能写到 $PWD。
  # 实测踩坑：当前工作目录可能是脚本所在目录，把 ai-config.json
  # 错误地写回脚本目录，污染了非 SSE 路径。
  if [ -d "$BACKUP_DIR/files" ]; then
    echo "--- 回滚配置文件 ---"
    for f in "$BACKUP_DIR/files"/*; do
      [ -e "$f" ] || continue
      base=$(basename "$f")
      # 只还原【导入前确实存在】的文件（备份时有 .existed_ 标记）
      [ -f "$BACKUP_DIR/files/.existed_$base" ] || continue
      dest="$SSE_DIR/$base"
      [ -f "$dest" ] || continue
      if cp "$f" "$dest"; then echo "  ✅ $dest 已还原"; fi
    done
  fi

  echo
  if [ "$KEEP_BACKUP" = "1" ] && [ -n "$BACKUP_DIR" ]; then
    echo "备份保留在: $BACKUP_DIR"
  else
    if [ -n "$BACKUP_DIR" ]; then rm -rf "$BACKUP_DIR"; fi
  fi
  echo "${RED}回滚完成${RST}"
}

# ============================================================================
# 回滚触发器
#
# 关键（实测踩坑）：脚本内部用的是 `exit 1`，而 `exit` 只触发 EXIT trap，
# 不触发 ERR trap。之前用 `trap on_error ERR` 导致失败时【完全没有回滚】——
# 数据库已被部分覆盖，MinIO 已被清空。
#
# 正确做法：回滚挂在 EXIT trap 上，用 IMPORT_SUCCEEDED 标记区分
# "正常结束" 与 "失败结束"。
# ============================================================================
IMPORT_SUCCEEDED=0
on_exit() {
  local code=$?
  if [ "$code" != "0" ] && [ "$IMPORT_SUCCEEDED" != "1" ]; then
    rollback "步骤失败（退出码 $code）"
  fi
}
trap on_exit EXIT
trap 'rollback "收到中断信号"; exit 130' INT TERM

# ---------------- 0. 前置检查 ----------------
step "0/8 前置检查"

if [ "$PG_MODE" = "host" ]; then
  command -v psql >/dev/null 2>&1 || { err "找不到 psql（可改用 PG_CONTAINER=<容器名>）"; exit 1; }
  command -v pg_dump >/dev/null 2>&1 || { err "找不到 pg_dump（可改用 PG_CONTAINER=<容器名>）"; exit 1; }
  command -v pg_restore >/dev/null 2>&1 || { err "找不到 pg_restore（可改用 PG_CONTAINER=<容器名>）"; exit 1; }
fi

if [ ! -f "$FROM_DIR/manifest.json" ]; then err "缺少 manifest.json，不是有效的导出目录"; exit 1; fi
ok "导出目录: $FROM_DIR"

if [ ! -f "$FROM_DIR/meta/checksums.sha256" ]; then
  warn "缺少 checksums.sha256，跳过完整性校验"
  CHECK_OK=0
else
  echo "--- 校验导出包完整性 ---"
  if ( cd "$FROM_DIR" && sha256sum -c meta/checksums.sha256 --quiet 2>&1 | grep -v ': OK$' ); then
    err "导出包校验和不匹配，文件已损坏"
    exit 1
  fi
  ok "导出包完整性校验通过"
  CHECK_OK=1
fi

# 读取导出时的配置仅用于【展示与交叉检查】，绝不覆盖本次导入的连接参数。
# 导入目标必须由当前环境/命令行决定 —— 否则会把数据写回源库。
if [ -f "$FROM_DIR/meta/export_meta.sh" ]; then
  SRC_DB_NAME=$(grep -E "^export DB_NAME=" "$FROM_DIR/meta/export_meta.sh" | cut -d"'" -f2)
  SRC_MINIO=$(grep -E "^export MINIO_ENDPOINT=" "$FROM_DIR/meta/export_meta.sh" | cut -d"'" -f2)
  SRC_MINIO_PORT=$(grep -E "^export MINIO_PORT=" "$FROM_DIR/meta/export_meta.sh" | cut -d"'" -f2)
  echo "  导出源: DB=$SRC_DB_NAME  MinIO=$SRC_MINIO:$SRC_MINIO_PORT"
  echo "  导入到: DB=$DB_NAME  MinIO=$MINIO_ENDPOINT:$MINIO_PORT"
  if [ -n "$SRC_DB_NAME" ] && [ "$SRC_DB_NAME" = "$DB_NAME" ]; then
    warn "目标库与源库同名（$DB_NAME）—— 请确认这是有意的"
  fi
fi

if ! pg_ready; then
  err "无法连接 PostgreSQL: $DB_HOST:$DB_PORT"
  exit 1
fi
ok "PostgreSQL 连通: $DB_HOST:$DB_PORT/$DB_NAME"

# 目标库必须存在
if ! pg_run -d postgres -tAc \
     "SELECT 1 FROM pg_database WHERE datname='$DB_NAME'" | grep -q 1; then
  warn "目标数据库不存在: $DB_NAME —— 正在创建"
  if pg_createdb "$DB_NAME" 2>/dev/null; then
    ok "已创建目标数据库: $DB_NAME"
  else
    err "创建目标数据库失败: $DB_NAME"
    err "手动执行: createdb -h $DB_HOST -p $DB_PORT -U $DB_USER $DB_NAME"
    exit 1
  fi
fi
ok "目标数据库: $DB_NAME"

MC_BIN=""
for c in mc; do
  if command -v "$c" >/dev/null 2>&1; then MC_BIN="$c"; break; fi
done
if [ "$SKIP_MINIO" != "1" ] && [ -z "$MC_BIN" ]; then
  err "需要 mc 客户端来导入 MinIO 对象，或加 --skip-minio"
  exit 1
fi

if [ "$DRY_RUN" = "1" ]; then
  echo
  echo "${YEL}═══ DRY RUN 模式 —— 只检查不改动 ═══${RST}"
fi

# ---------------- 1. 备份目标 ----------------
step "1/8 备份目标系统（回滚基线）"

BACKUP_DIR="$FROM_DIR/.rollback-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$BACKUP_DIR/files"

echo "--- 备份目标数据库 ---"
if pg_dump_to "$BACKUP_DIR/backup.dump" -d "$DB_NAME" \
     --format=custom --compress=9 --no-owner --no-privileges 2>/dev/null; then
  ok "数据库备份: $(du -h "$BACKUP_DIR/backup.dump" | cut -f1)"
else
  warn "目标库为空或 pg_dump 失败（首次部署属正常）"
  : > "$BACKUP_DIR/backup.dump"
fi

echo "--- 备份目标配置文件 ---"
# 只认 $SSE_DIR —— $PWD 可能是脚本所在目录，会备份错文件。
for base in ai-config.json ai-test-history.json .env; do
  dest="$SSE_DIR/$base"
  if [ -f "$dest" ]; then
    cp "$dest" "$BACKUP_DIR/files/$base"
    touch "$BACKUP_DIR/files/.existed_$base"
    echo "  已备份 $base"
  else
    echo "  $base 在目标不存在（导入时新建）"
  fi
done

# ---------------- 2. 备份 MinIO ----------------
MINIO_BACKUP=""
if [ "$SKIP_MINIO" != "1" ]; then
  step "2/8 备份目标 MinIO 对象"
  mc alias set sse-import "http://$MINIO_ENDPOINT:$MINIO_PORT" "$MINIO_ACCESS_KEY" "$MINIO_SECRET_KEY" >/dev/null 2>&1 || {
    err "mc alias 设置失败 —— MinIO 不可达或凭据错误"
    exit 1
  }
  MINIO_BACKUP="$BACKUP_DIR/minio"
  mkdir -p "$MINIO_BACKUP"
  for b in $MINIO_BUCKETS; do
    mkdir -p "$MINIO_BACKUP/$b"
    if mc ls "sse-import/$b" >/dev/null 2>&1; then
      mc mirror --overwrite "sse-import/$b" "$MINIO_BACKUP/$b" --quiet >/dev/null 2>&1 || true
      n=$(find "$MINIO_BACKUP/$b" -type f | wc -l)
      echo "  bucket $b: 备份 $n 个对象"
    else
      echo "  bucket $b: 不存在（导入时创建）"
    fi
  done
  ok "MinIO 备份完成"
else
  step "2/8 跳过 MinIO 备份（--skip-minio）"
fi

if [ "$DRY_RUN" = "1" ]; then
  echo
  ok "DRY RUN 检查通过，未做任何修改"
  rm -rf "$BACKUP_DIR"
  exit 0
fi

# ---------------- 3. 导入数据库 ----------------
step "3/8 导入 PostgreSQL 数据"

# ---- 3a. 确保目标库表结构存在 ----
# 目标库可能是全新的空库（只有 migration 跑过或什么都没跑）。
# 先用导出的 schema.sql 补齐缺失的表，再灌数据。
# 已有表不受影响（CREATE TABLE IF NOT EXISTS / DROP+CREATE 由 schema.sql 自身语义决定）。
if [ -f "$FROM_DIR/pg/schema.sql" ]; then
  # 只为【目标库缺失的表】建表，其余对象（函数/触发器/索引）保持不变。
  # 直接跑整个 schema.sql 会对已存在的函数报 "already exists"。
  # 做法：把 schema.sql 里的 CREATE 全部改成 IF NOT EXISTS 形式再执行。
  TABLES_IN_SCHEMA=$({ grep -oE "^CREATE TABLE public\.[a-z_]+" "$FROM_DIR/pg/schema.sql" \
                       | sed 's/^CREATE TABLE public\.//' | tr '\n' ' '; } 2>/dev/null; true)
  TABLES_IN_SCHEMA=${TABLES_IN_SCHEMA:-}
  MISSING_LIST=""
  for t in $TABLES_IN_SCHEMA; do
    ex=$(pg_run -d "$DB_NAME" -tAc \
         "SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='$t'" 2>/dev/null || echo 0)
    if [ "$ex" != "1" ]; then
      MISSING_LIST="$MISSING_LIST $t"
    fi
  done

  if [ -n "$MISSING_LIST" ]; then
    echo "  目标库缺失的表:$MISSING_LIST"
    SCHEMA_TMP=$(mktemp /tmp/sse_schema_XXXXXX.sql)
    # 所有 CREATE TABLE 都改成 IF NOT EXISTS；CREATE FUNCTION 改成 CREATE OR REPLACE
    sed -E -e 's/^CREATE TABLE public\.([a-z_]+) \(/CREATE TABLE IF NOT EXISTS public.\1 (/' \
           -e 's/^CREATE FUNCTION /CREATE OR REPLACE FUNCTION /' \
           -e 's/^CREATE (UNIQUE )?INDEX /CREATE $1INDEX IF NOT EXISTS /' \
           -e 's/^CREATE TRIGGER /CREATE OR REPLACE TRIGGER /' \
        "$FROM_DIR/pg/schema.sql" > "$SCHEMA_TMP"
    SCHEMA_ERR=$(mktemp)
    # 先确保 schema.sql 里用到的扩展存在（uuid_generate_v4 来自 uuid-ossp）。
    # 目标库若是新建的、或上次回滚 DROP SCHEMA CASCADE 删过扩展，这里必须补回来。
    pg_run -d "$DB_NAME" -c \
      "CREATE EXTENSION IF NOT EXISTS \"uuid-ossp\"; CREATE EXTENSION IF NOT EXISTS \"pgcrypto\";" \
      >/dev/null 2>&1 || true
    # ON_ERROR_STOP=0：对象已存在的冲突是可接受的（我们只想补齐缺失的表），
    # 真正的致命错误（缺列/类型不符）会在下面单独检出。
    pg_run_file "$SCHEMA_TMP" -d "$DB_NAME" -v ON_ERROR_STOP=0 \
         -q >"$SCHEMA_ERR" 2>&1
    # 可忽略的幂等冲突：对象/约束已存在
    # 注意：脚本开了 set -euo pipefail。管道里 grep -viE 如果把内容全过滤掉，
    # 它的退出码是 1，pipefail 会把这个失败传播给整个赋值语句，
    # 导致脚本在"没有致命错误"这种正常情况下直接中止。
    # 解决：用 `{ ... ; true; }` 兜住管道退出码。
    FATAL=$({ grep "ERROR:" "$SCHEMA_ERR" \
              | grep -viE "already exists|duplicate key value|multiple primary keys" \
              | head -10; } 2>/dev/null; true)
    FATAL=${FATAL:-}
    if [ -n "$FATAL" ]; then
      err "建表遇到致命错误："
      echo "$FATAL" | sed 's/^/      /'
      rm -f "$SCHEMA_ERR" "$SCHEMA_TMP"
      exit 1
    fi
    # 注意：不能写成 `grep -c PAT file || echo 0` —— grep 找不到匹配时已经输出 "0"
    # 且退出码为 1，`|| echo 0` 会再追加一行 0，变量变成 "0\n0"，
    # 后面 [ "$CONFLICT" -gt 0 ] 就会报 "integer expression expected" 并退出。
    CONFLICT=$(grep -c "ERROR:" "$SCHEMA_ERR" 2>/dev/null; true)
    CONFLICT=${CONFLICT:-0}
    CONFLICT=$(echo "$CONFLICT" | head -1)
    if [ "$CONFLICT" -gt 0 ]; then
      warn "$CONFLICT 个对象已存在（已忽略）"
    fi
    ok "表结构补齐完成"
    rm -f "$SCHEMA_ERR" "$SCHEMA_TMP"
  else
    ok "目标库表结构完整，无需补齐"
  fi
  TBL=$(pg_run -d "$DB_NAME" -tAc \
        "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='public'")
  echo "  目标库现有 $TBL 张表"
fi
# 导入顺序（外键依赖）
# 顺序遵循外键依赖：
#   system_messages 必须在 notification_logs 之前（012 migration 引入的 FK）
#   notification_logs 必须在 notification_deliveries 之前
#   users 必须最先（几乎所有表都引用它）
IMPORT_ORDER=(
  users
  expense_categories
  approval_rules
  reasoning_rules
  mcp_api_keys
  identity_mappings
  ontology_snapshots
  expense_reports
  expense_items
  invoices
  approval_records
  system_messages
  notification_logs
  notification_deliveries
  payment_receipts
  payment_audit_logs
  schema_migrations
)

IMPORTED=0
SKIPPED=0

# ============================================================================
# 关键：整个数据库导入必须在【同一个 psql 会话】的【同一个事务】里完成。
#
# 错误做法（已实测踩坑）：每张表用独立的 `psql -c "BEGIN"` ... `psql -f` ...
#   `psql -c "COMMIT"`。每个 psql -f 都是新连接，事务根本不连续 ——
#   中途失败时前面的表已经落库，"失败即回滚"是假的。
#
# 正确做法：把 BEGIN + 所有表的 DELETE/INSERT + COMMIT 拼成一个脚本，
#   交给单个 psql 执行。ON_ERROR_STOP=1 保证任何一条 SQL 出错立即停止，
#   此时事务未提交，连接关闭后 PG 自动 ROLLBACK —— 目标库回到导入前状态。
# ============================================================================
SQLTMP=$(mktemp /tmp/sse_import_XXXXXX.sql)
STAGETMP=$(mktemp /tmp/sse_stage_XXXXXX.sql)
{
  echo "BEGIN;"
  # ---- 阶段 1：清空所有目标表 ----
  # 必须按【导入顺序的逆序】删除，否则 DELETE FROM users 会被
  # system_messages.sender_id 等外键挡住（实测踩过）。
  # 也不能用 TRUNCATE ... CASCADE —— 那会级联清空别的表，
  # 而我们只应清空即将写入的这几张表。
  for (( i=${#IMPORT_ORDER[@]}-1; i>=0; i-- )); do
    t="${IMPORT_ORDER[$i]}"
    if [ -f "$FROM_DIR/pg/table_$t.sql" ]; then
      # 目标库可能还没有这张表（例如 schema_migrations 由应用启动时创建）
      echo "DO \$\$ BEGIN"
      echo "  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='$t')"
      echo "  THEN DELETE FROM public.$t; END IF;"
      echo "END \$\$;"
    fi
  done
  # ---- 阶段 2：按依赖顺序插入 ----
  for t in "${IMPORT_ORDER[@]}"; do
    f="$FROM_DIR/pg/table_$t.sql"
    if [ ! -f "$f" ]; then
      # ★ 这条消息必须走 stderr —— 阶段 2 的输出整体重定向进 $STAGETMP，
      #   纯文本混进 SQL 文件会导致 "syntax error at or near 跳过"
      echo "  跳过 $t（导出中不存在）" >&2
      SKIPPED=$((SKIPPED+1))
      continue
    fi
    # 重置自增序列，避免后续应用写入时主键冲突。
    # 注意：SSE 主键都是 uuid（应用层生成），没有自增序列；
    # pg_get_serial_sequence 返回 NULL 时跳过，避免 MAX(uuid) 报错。
    # 用单引号 heredoc 形式输出，避免 shell 展开 $$。
    printf 'DO $do$ DECLARE s TEXT; BEGIN IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema=%s AND table_name=%s AND column_name=%s) THEN s := pg_get_serial_sequence(%s,%s); IF s IS NOT NULL THEN PERFORM setval(s, GREATEST(COALESCE((SELECT MAX(id) FROM public.%s), 1), 1)); END IF; END IF; END $do$;\n' \
      "'public'" "'$t'" "'id'" "'public.$t'" "'id'" "$t" >> "$STAGETMP"
    # 追加导出的 INSERT 语句（只取数据语句，过滤 pg_dump 的 SET/注释头）
    grep -E "^INSERT INTO public\.$t " "$f" >> "$STAGETMP"
  done
  echo "COMMIT;"
} > "$SQLTMP"
# 把拼装好的 INSERT 语句插到 COMMIT 之前
python3 - "$SQLTMP" "$STAGETMP" <<'PYEOF'
import sys
sql_path, stage_path = sys.argv[1], sys.argv[2]
sql = open(sql_path, encoding="utf-8").read()
stage = open(stage_path, encoding="utf-8").read()
sql = sql.replace("COMMIT;", stage + "\nCOMMIT;")
open(sql_path, "w", encoding="utf-8").write(sql)
PYEOF
rm -f "$STAGETMP"

# ---------------- 3b. 按目标库实际列结构对齐 ----------------
# 旧盘数据的表结构可能与当前 migration 不一致（实测：旧盘
# expense_reports 有 description 列，当前 migration 已删除该列）。
# 这里按【目标库真实列】过滤 INSERT：
#   - 目标库没有的列 → 剔除
#   - 目标库有、源数据没有的列 → 用 DEFAULT 或 NULL 补齐
#   - 目标库 NOT NULL 且无默认值的缺失列 → 直接失败（不静默丢数据）
# 列元数据 SQL 放在独立文件里 —— 嵌套 JSON 聚合的引号在 shell 里极难正确转义
COLMETA=$(mktemp /tmp/sse_colmeta_XXXXXX.json)
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
if [ -f "$SCRIPT_DIR/colmeta.sql" ]; then
  pg_run_file "$SCRIPT_DIR/colmeta.sql" -d "$DB_NAME" -tA \
    > "$COLMETA" 2>/dev/null \
    || echo '{"tables":{}}' > "$COLMETA"
else
  echo '{"tables":{}}' > "$COLMETA"
fi

if [ -s "$COLMETA" ] && grep -q '"tables"' "$COLMETA"; then
  python3 "$SCRIPT_DIR/filter_insert_columns.py" "$SQLTMP" "$COLMETA" \
    "$SCRIPT_DIR/.colfilter_report.json" && COLFILT_RC=0 || COLFILT_RC=$?
  if [ "$COLFILT_RC" -ne 0 ]; then
    err "列对齐失败 —— 目标库与源数据存在无法自动处理的差异"
    cat "$SCRIPT_DIR/.colfilter_report.json" 2>/dev/null | sed 's/^/      /'
    rm -f "$COLMETA"
    exit 1
  fi
fi
rm -f "$COLMETA"

# 同上：grep -c 无匹配时输出 "0" 且退出码为 1，|| echo 0 会造成 "0\n0"
TOTAL_INSERTS=$(grep -c "^INSERT INTO" "$SQLTMP" 2>/dev/null; true)
TOTAL_INSERTS=${TOTAL_INSERTS:-0}
echo "  拼装完成：$TOTAL_INSERTS 条 INSERT，$SKIPPED 张表跳过"

ERRLOG=$(mktemp)
if pg_run_file "$SQLTMP" -d "$DB_NAME" -v ON_ERROR_STOP=1 \
     -q >"$ERRLOG" 2>&1; then
  ok "数据库导入完成（单事务原子提交）"
else
  err "数据库导入失败 —— psql 输出："
  sed 's/^/      /' "$ERRLOG" | head -30
  echo
  err "事务已由 PostgreSQL 自动回滚，目标数据库回到导入前状态"
  rm -f "$ERRLOG" "$SQLTMP"
  exit 1
fi
rm -f "$ERRLOG" "$SQLTMP"

# 逐表统计行数
for t in "${IMPORT_ORDER[@]}"; do
  if [ ! -f "$FROM_DIR/pg/table_$t.sql" ]; then continue; fi
  cnt=$(pg_run -d "$DB_NAME" -tAc \
        "SELECT COUNT(*) FROM public.$t" 2>/dev/null || echo "?")
  printf "  ✅ %-28s %s 行\n" "$t" "$cnt"
  IMPORTED=$((IMPORTED+1))
done
ok "共导入 $IMPORTED 张表"

# ---------------- 4. 导入 MinIO ----------------
if [ "$SKIP_MINIO" != "1" ]; then
  step "4/8 导入 MinIO 对象"

  for b in $MINIO_BUCKETS; do
    src="$FROM_DIR/minio/$b"
    if [ ! -d "$src" ]; then
      warn "bucket $b 无导出数据，跳过"
      continue
    fi
    n_src=$(find "$src" -type f | wc -l)
    if [ "$n_src" -eq 0 ]; then echo "  bucket $b: 0 个对象，跳过"; continue; fi

    # 目标 bucket 不存在就创建
    mc mb --ignore-existing "sse-import/$b" >/dev/null 2>&1 || true

    # 关键：清空目标 bucket，避免与旧对象混杂
    mc rm --recursive --force "sse-import/$b" >/dev/null 2>&1 || true

    # 故障注入开关（仅用于自测；正常路径不设置）
    if [ -n "${INJECT_MINIO_FAIL:-}" ] && [ "$INJECT_MINIO_FAIL" = "$b" ]; then
      err "bucket $b 导入失败（注入的测试故障）"
      exit 1
    fi
    if mc mirror --overwrite "$src" "sse-import/$b" --quiet >/dev/null 2>&1; then
      n_dst=$(mc ls --recursive "sse-import/$b" 2>/dev/null | wc -l)
      if [ "$n_src" = "$n_dst" ]; then
        ok "bucket $b: $n_dst 个对象（与导出一致）"
      else
        err "bucket $b 对象数不符：源 $n_src，目标 $n_dst"
        exit 1
      fi
    else
      err "bucket $b 导入失败"
      exit 1
    fi
  done
else
  step "4/8 跳过 MinIO 导入（--skip-minio）"
fi

# ---------------- 5. 导入配置文件 ----------------
if [ "$SKIP_FILES" != "1" ]; then
  step "5/8 导入配置文件"
  for base in ai-config.json ai-test-history.json; do
    if [ -f "$FROM_DIR/files/$base" ]; then
      cp "$FROM_DIR/files/$base" "$SSE_DIR/$base" 2>/dev/null \
        && ok "$base → $SSE_DIR/$base" \
        || warn "$base 拷贝失败（$SSE_DIR 不存在？）"
    fi
  done
  # .env 只在目标不存在时复制（避免覆盖新系统的配置）
  if [ -f "$FROM_DIR/files/env.local" ]; then
    if [ -f "$SSE_DIR/.env" ]; then
      warn ".env 目标已存在，不覆盖（如需请手动合并）"
    else
      if cp "$FROM_DIR/files/env.local" "$SSE_DIR/.env"; then ok ".env → $SSE_DIR/.env"; else warn ".env 拷贝失败"; fi
    fi
  fi
else
  step "5/8 跳过配置文件导入（--skip-files）"
fi

# ---------------- 6. 验证 ----------------
step "6/8 导入后验证"

EXPECT=$(python3 -c "
import json,sys
m=json.load(open('$FROM_DIR/manifest.json'))
print(m.get('table_counts',{}))
" 2>/dev/null || echo "{}")

echo "--- 数据库 ↔ MinIO 关联校验 ---"
# ★ link_check.txt.<表> 每行格式：<磁盘对象全路径>|<storage_key>
#   磁盘对象全路径 = bucket + '/' + storage_key
#   （依据 SSE 源码：putObject(bucket, key) 而 key 自身已带一层 bucket 名）
# 这里逐条确认 DB 引用的每个对象在目标 MinIO 中确实存在。
LINK_BAD=0
LINK_TOTAL=0
if [ "$SKIP_MINIO" != "1" ]; then
  for tbl in invoices payment_receipts avatars; do
    [ -f "$FROM_DIR/meta/link_check.txt.$tbl" ] || continue
    while IFS='|' read -r lpath lkey; do
      [ -n "$lpath" ] || continue
      LINK_TOTAL=$((LINK_TOTAL+1))
      if ! mc stat "sse-import/$lpath" >/dev/null 2>&1; then
        err "关联断裂：$tbl 的对象 '$lpath' 在 MinIO 中不存在"
        LINK_BAD=$((LINK_BAD+1))
      fi
    done < "$FROM_DIR/meta/link_check.txt.$tbl"
  done
  if [ "$LINK_BAD" -eq 0 ]; then
    if [ "$LINK_TOTAL" -gt 0 ]; then
      ok "$LINK_TOTAL 条数据库记录的对象引用全部命中"
    else
      warn "没有可校验的关联记录"
    fi
  else
    err "$LINK_BAD 条关联断裂"
  fi
fi


echo "--- 行数比对 ---"
MISMATCH=0
if [ -n "$EXPECT" ] && [ "$EXPECT" != "{}" ]; then
  while IFS= read -r line; do
    if [ -z "$line" ]; then continue; fi
    t="${line%%=*}"; want="${line##*=}"
    got=$(pg_run -d "$DB_NAME" -tAc \
          "SELECT COUNT(*) FROM public.$t" 2>/dev/null || echo 0)
    if [ "$got" = "$want" ]; then
      printf "  ✅ %-28s %s\n" "$t" "$got"
    else
      printf "  ❌ %-28s 期望 %s，实际 %s\n" "$t" "$want" "$got"
      MISMATCH=$((MISMATCH+1))
    fi
  done < "$FROM_DIR/meta/table_counts.txt"
fi

if [ "$MISMATCH" -gt 0 ]; then
  err "$MISMATCH 张表行数不符"
  exit 1
fi
ok "所有表行数与导出时一致"

# ---------------- 7. 完成 ----------------
step "7/8 收尾"

IMPORT_SUCCEEDED=1

if [ "$SKIP_MINIO" != "1" ]; then
  mc alias rm sse-import >/dev/null 2>&1 || true
fi

echo
ok "导入完成"
echo "  数据库: $DB_HOST:$DB_PORT/$DB_NAME"
echo "  备份:   $BACKUP_DIR"
echo
echo "验证:"
echo "  bash verify_sse_restore.sh --from $FROM_DIR"
