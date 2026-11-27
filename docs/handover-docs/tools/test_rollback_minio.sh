#!/usr/bin/env bash
# 回滚测试 2：MinIO 导入阶段失败时，验证 MinIO 与数据库都回滚
#
# 注入方式：把目标 MinIO 指向一个不可写/不存在的 bucket 路径，
# 让 mirror 阶段失败；同时先往目标库塞一条"导入前就该有的"数据，
# 验证数据库也一并回滚。
set -uo pipefail

# ---------------- 参数 ----------------
# 用法: bash test_rollback_minio.sh [源导出包] [目标库] [目标 SSE 目录]
# 环境变量同 test_rollback.sh（PG_CONTAINER / DB_* / MINIO_* / MC_ALIAS）
SRC_PKG="${1:-/tmp/export1}"
TARGET_DB="${2:-sse_new}"
SSE_TARGET_DIR="${3:-/tmp/ssedst}"

DB_HOST="${DB_HOST:-127.0.0.1}"
DB_PORT="${DB_PORT:-55433}"
DB_USER="${DB_USER:-sse}"
DB_PASSWORD="${DB_PASSWORD:-sse_dev}"
PG_CONTAINER="${PG_CONTAINER:-}"
MC_ALIAS="${MC_ALIAS:-sse-dst}"

export PGPASSWORD="$DB_PASSWORD"

if [ -n "$PG_CONTAINER" ]; then
  PSQL="docker exec -i -e PGPASSWORD=$DB_PASSWORD $PG_CONTAINER psql -U $DB_USER"
else
  PGBIN="${PGBIN:-/tmp/aptdl/pgsql/usr/lib/postgresql/17/bin}"
  if [ ! -x "$PGBIN/psql" ]; then PGBIN="$(dirname "$(command -v psql)")"; fi
  PSQL="$PGBIN/psql -h $DB_HOST -p $DB_PORT -U $DB_USER"
fi
echo "源导出包: $SRC_PKG"
echo "目标库:   $TARGET_DB"

echo "=== 准备：目标库写入一条导入前就存在的记录 ==="
# 用一个不参与导入表的表作为"基线标记"。
# ★ 基线行 id 必须【动态选取】目标库里真实存在的行 ——
#   固定 id 只能适配特定夹具，换成旧盘真实数据就会落空。
BASE_ID=$($PSQL -d "$TARGET_DB" -tAc \
  "SELECT id FROM expense_categories ORDER BY id LIMIT 1")
if [ -z "$BASE_ID" ]; then
  echo "  ❌ 目标库 expense_categories 为空，无法建立基线标记"
  exit 1
fi
$PSQL -d "$TARGET_DB" -q -c \
  "UPDATE expense_categories SET name='基线标记-'||name WHERE id='$BASE_ID'"
BASE_CAT=$($PSQL -d "$TARGET_DB" -tAc \
  "SELECT name FROM expense_categories WHERE id='$BASE_ID'")
echo "  基线标记 id: $BASE_ID"
echo "  基线标记: $BASE_CAT"

# 在目标 MinIO 放一个对象
echo "PRECIOUS" > /tmp/precious.txt
mc cp /tmp/precious.txt "$MC_ALIAS"/invoices/PRECIOUS_MUST_SURVIVE.txt >/dev/null 2>&1
BEFORE_MINIO=$(mc ls --recursive "$MC_ALIAS" 2>/dev/null | wc -l || echo 0)
echo "  目标 MinIO 导入前对象数: $BEFORE_MINIO"

echo
echo "=== 执行导入（MinIO 阶段预期失败） ==="
# 关键：MinIO 备份要能成功（连得上），但导入写操作要失败。
# 做法：先用正确端口建 alias（备份阶段用），再把 alias 指向一个只读端点，
# 让 mirror 写入阶段失败。
# 简化方案：直接在导出包里制造一个无法上传的对象 —— 把对象名改成
# 非法字符（MinIO 对象名不能包含某些序列），让 mc mirror 报错。
BROKEN2="$SRC_PKG"

DB_HOST=127.0.0.1 DB_PORT=55433 DB_USER=sse DB_PASSWORD=sse_dev \
MINIO_ENDPOINT=127.0.0.1 MINIO_PORT=59102 MINIO_ACCESS_KEY=minioadmin MINIO_SECRET_KEY=minioadmin \
SSE_DIR="$SSE_TARGET_DIR" INJECT_MINIO_FAIL=invoices \
bash /opt/data/tools/sse-data/import_sse_data.sh --from "$BROKEN2" --target-db "$TARGET_DB" 2>&1 | tail -30
IMPORT_EXIT=${PIPESTATUS[0]}
echo "  导入退出码: $IMPORT_EXIT"

echo
echo "=== 判定 ==="
FAIL=0
AFTER_MINIO=$(mc ls --recursive "$MC_ALIAS" 2>/dev/null | wc -l || echo 0)
AFTER_CAT=$($PSQL -d "$TARGET_DB" -tAc \
  "SELECT name FROM expense_categories WHERE id='$BASE_ID'")

echo "  MinIO 对象数: $BEFORE_MINIO -> $AFTER_MINIO"
echo "  基线标记:     $BASE_CAT -> $AFTER_CAT"

[ "$BEFORE_MINIO" = "$AFTER_MINIO" ] || { echo "  ❌ MinIO 对象数变了（应回滚）"; FAIL=1; }
[ "$BASE_CAT" = "$AFTER_CAT" ] || { echo "  ❌ 数据库基线标记变了（应回滚）: $BASE_CAT -> $AFTER_CAT"; FAIL=1; }
# 注意：脚本的设计是"清空目标 bucket 再导入"，所以 PRECIOUS 对象
# 在导入【成功】时也会被删除 —— 那是预期行为（保证与源一致）。
# 导入【失败】时应由回滚把备份恢复回来。
[ "$IMPORT_EXIT" != "0" ] || { echo "  ❌ 导入本应失败却成功了"; FAIL=1; }

if [ "$FAIL" = "0" ]; then
  echo "  ✅ MinIO 阶段失败回滚成功：MinIO 与数据库均保持导入前状态"
  exit 0
else
  echo "  ❌ 回滚失败"
  exit 1
fi
