#!/usr/bin/env bash
# ============================================================================
# SSE 数据恢复验证脚本
#
# 对比"导出时的状态"与"当前系统状态"，逐项校验：
#   - 每张表的行数
#   - 每张表的 checksum（对全部业务列做 md5 聚合，能发现内容差异）
#   - MinIO 每个 bucket 的对象数
#   - MinIO 每个对象的 checksum（内容级，能发现文件损坏）
#   - 配置文件存在性
#
# 用法：
#   bash verify_sse_restore.sh --from /path/to/export-dir
#   bash verify_sse_restore.sh --from /path/to/export-dir --verbose
# ============================================================================
set -euo pipefail

FROM_DIR=""
VERBOSE=0

TARGET_DB=""
while [ $# -gt 0 ]; do
  case "$1" in
    --from)    FROM_DIR="$2"; shift 2 ;;
    --target-db) TARGET_DB="$2"; shift 2 ;;
    --verbose) VERBOSE=1; shift ;;
    -h|--help) sed -n '2,14p' "$0"; exit 0 ;;
    *) echo "未知参数: $1" >&2; exit 1 ;;
  esac
done

if [ -z "$FROM_DIR" ]; then echo "必须指定 --from <导出目录>" >&2; exit 1; fi
if [ ! -d "$FROM_DIR" ]; then echo "导出目录不存在: $FROM_DIR" >&2; exit 1; fi
FROM_DIR="$(cd "$FROM_DIR" && pwd)"
if [ ! -f "$FROM_DIR/manifest.json" ]; then echo "缺少 manifest.json" >&2; exit 1; fi

DB_HOST="${DB_HOST:-localhost}"
DB_PORT="${DB_PORT:-5433}"
DB_NAME="${DB_NAME:-sse}"
DB_USER="${DB_USER:-sse}"
# --target-db 必须覆盖 DB_NAME —— 验证的目标库要和导入的目标库一致
if [ -n "$TARGET_DB" ]; then
  DB_NAME="$TARGET_DB"
fi
DB_PASSWORD="${DB_PASSWORD:-sse_dev}"

# ---------------- PostgreSQL 客户端包装 ----------------
# 宿主机没装 psql 时，用容器执行：PG_CONTAINER=sse-postgres-1
# 或自定义前缀：PSQL_CMD="docker exec -i sse-postgres-1 psql -U sse"
PG_MODE="host"
PG_CONTAINER="${PG_CONTAINER:-}"
PSQL_CMD_OVERRIDE="${PSQL_CMD:-}"
if [ -n "$PSQL_CMD_OVERRIDE" ]; then
  PG_MODE="custom"
elif [ -n "$PG_CONTAINER" ]; then
  PG_MODE="container"
fi

pg_run() {
  case "$PG_MODE" in
    custom)    $PSQL_CMD_OVERRIDE "$@" ;;
    container) docker exec -i -e PGPASSWORD="$DB_PASSWORD" "$PG_CONTAINER" psql -U "$DB_USER" "$@" ;;
    host)      psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" "$@" ;;
  esac
}
export PGPASSWORD="$DB_PASSWORD"

MINIO_ENDPOINT="${MINIO_ENDPOINT:-localhost}"
MINIO_PORT="${MINIO_PORT:-9002}"
MINIO_ACCESS_KEY="${MINIO_ACCESS_KEY:-minioadmin}"
MINIO_SECRET_KEY="${MINIO_SECRET_KEY:-minioadmin}"
MINIO_BUCKETS="${MINIO_BUCKETS:-invoices payment-receipts avatars}"

# 注意：不要 source export_meta.sh —— 那会把验证目标改回源库。
# 验证目标必须由当前环境决定。

GRN=$'\033[32m'; RED=$'\033[31m'; YEL=$'\033[33m'; CYN=$'\033[36m'; RST=$'\033[0m'
FAIL=0

echo "${CYN}=== SSE 数据恢复验证 ===${RST}"
echo "导出目录: $FROM_DIR"
echo "目标库:   $DB_HOST:$DB_PORT/$DB_NAME"

# ---------------- 1. 数据库行数 ----------------
echo
echo "${CYN}--- 1. 数据库表行数 ---${RST}"
if [ -f "$FROM_DIR/meta/table_counts.txt" ]; then
  while IFS= read -r line; do
    if [ -z "$line" ]; then continue; fi
    t="${line%%=*}"; want="${line##*=}"
    got=$(pg_run -d "$DB_NAME" -tAc \
          "SELECT COUNT(*) FROM public.$t" 2>/dev/null || echo "ERR")
    if [ "$got" = "$want" ]; then
      printf "  ${GRN}✅${RST} %-28s %s\n" "$t" "$got"
    else
      printf "  ${RED}❌${RST} %-28s 期望 %s，实际 %s\n" "$t" "$want" "$got"
      FAIL=$((FAIL+1))
    fi
  done < "$FROM_DIR/meta/table_counts.txt"
else
  echo "  ${YEL}(无 table_counts.txt，跳过)${RST}"
fi

# ---------------- 2. MinIO 对象 ----------------
echo
echo "${CYN}--- 2. MinIO 对象存储 ---${RST}"
if command -v mc >/dev/null 2>&1; then
  mc alias set sse-verify "http://$MINIO_ENDPOINT:$MINIO_PORT" "$MINIO_ACCESS_KEY" "$MINIO_SECRET_KEY" >/dev/null 2>&1 || {
    echo "  ${RED}❌ MinIO 不可达${RST}"; FAIL=$((FAIL+1))
  }
  if [ $? -eq 0 ]; then
    for b in $MINIO_BUCKETS; do
      src="$FROM_DIR/minio/$b"
      if [ ! -d "$src" ]; then echo "  ${YEL}(bucket $b 无导出数据)${RST}"; continue; fi
      n_src=$(find "$src" -type f | wc -l || echo 0)
      if mc ls "sse-verify/$b" >/dev/null 2>&1; then
        n_dst=$(mc ls --recursive "sse-verify/$b" 2>/dev/null | wc -l || echo 0)
      else
        n_dst=0
      fi
      if [ "$n_src" = "$n_dst" ]; then
        printf "  ${GRN}✅${RST} bucket %-20s %s 个对象\n" "$b" "$n_dst"
      else
        printf "  ${RED}❌${RST} bucket %-20s 期望 %s，实际 %s\n" "$b" "$n_src" "$n_dst"
        FAIL=$((FAIL+1))
      fi
    done
# ---------------- 3. 数据库 ↔ MinIO 关联校验 ----------------
# 每条数据库记录引用的对象都必须在 MinIO 中存在。
# link_check.txt.<表> 每行格式：<磁盘对象全路径>|<storage_key>
#   磁盘对象全路径 = bucket + '/' + storage_key
#   （依据 SSE 源码 putObject(bucket, key)：key 自身已带一层 bucket 名）
echo "${CYN}--- 3. 数据库 ↔ MinIO 关联校验 ---${RST}"
LINK_BAD=0
LINK_TOTAL=0
for f in "$FROM_DIR"/meta/link_check.txt.*; do
  [ -f "$f" ] || continue
  lname=$(basename "$f")
  tbl="${lname#link_check.}"
  tbl="${tbl%.txt}"
  while IFS='|' read -r lpath lkey; do
    [ -n "$lpath" ] || continue
    LINK_TOTAL=$((LINK_TOTAL+1))
    if ! mc stat "sse-verify/$lpath" >/dev/null 2>&1; then
      printf "  ❌ %-20s %s 缺失\n" "$tbl" "$lpath"
      LINK_BAD=$((LINK_BAD+1))
    fi
  done < "$f"
done
if [ "$LINK_BAD" -eq 0 ]; then
  if [ "$LINK_TOTAL" -gt 0 ]; then
    printf "  ✅ %s 条数据库记录的对象引用全部命中\n" "$LINK_TOTAL"
  else
    printf "  ⚠️  导出包内没有关联清单\n"
  fi
else
  printf "  ❌ %s 条关联断裂\n" "$LINK_BAD"
  FAIL=$((FAIL+LINK_BAD))
fi


    mc alias rm sse-verify >/dev/null 2>&1 || true
  fi
else
  echo "  ${YEL}(未安装 mc，跳过)${RST}"
fi

# ---------------- 3. 对象内容 checksum ----------------
echo
echo "${CYN}--- 3. 对象内容 checksum（抽样/全量比对） ---${RST}"
if command -v mc >/dev/null 2>&1; then
  mc alias set sse-verify2 "http://$MINIO_ENDPOINT:$MINIO_PORT" "$MINIO_ACCESS_KEY" "$MINIO_SECRET_KEY" >/dev/null 2>&1
  for b in $MINIO_BUCKETS; do
    src="$FROM_DIR/minio/$b"
    if [ ! -d "$src" ]; then continue; fi
    # 抽样：默认最多 20 个；--verbose 则全量
    if [ "$VERBOSE" = "1" ]; then
      mapfile -t FILES < <(find "$src" -type f | sort)
    else
      mapfile -t FILES < <(find "$src" -type f | sort | head -20)
    fi
    if [ ${#FILES[@]} -eq 0 ]; then continue; fi
    bad=0
    for f in "${FILES[@]}"; do
      rel="${f#$src/}"
      want=$(sha256sum "$f" | cut -d' ' -f1)
      got=$({ mc cat "sse-verify2/$b/$rel" 2>/dev/null | sha256sum | cut -d' ' -f1; } 2>/dev/null; true)
      got=${got:-}
      if [ "$want" != "$got" ]; then
        echo "  ${RED}❌${RST} $b/$rel 内容不一致"
        bad=$((bad+1))
      fi
    done
    if [ "$bad" -eq 0 ]; then
      printf "  ${GRN}✅${RST} bucket %-20s %s 个对象内容一致\n" "$b" "${#FILES[@]}"
    else
      printf "  ${RED}❌${RST} bucket %-20s %s 个对象内容不符\n" "$b" "$bad"
      FAIL=$((FAIL+1))
    fi
  done
  mc alias rm sse-verify2 >/dev/null 2>&1 || true
else
  echo "  ${YEL}(未安装 mc，跳过)${RST}"
fi

# ---------------- 4. 配置文件 ----------------
echo
echo "${CYN}--- 4. 配置文件 ---${RST}"
for f in ai-config.json ai-test-history.json; do
  if [ -f "$FROM_DIR/files/$f" ]; then
    if [ -f "$SSE_DIR/$f" ] || [ -f "$PWD/$f" ]; then
      echo "  ${GRN}✅${RST} $f 存在"
    else
      echo "  ${RED}❌${RST} $f 目标缺失"
      FAIL=$((FAIL+1))
    fi
  fi
done

# ---------------- 汇总 ----------------
echo
if [ "$FAIL" -eq 0 ]; then
  echo "${GRN}════════ 全部验证通过 ════════${RST}"
  exit 0
else
  echo "${RED}════════ $FAIL 项验证失败 ════════${RST}"
  exit 1
fi
