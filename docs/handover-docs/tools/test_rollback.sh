#!/usr/bin/env bash
# 回滚测试：人为制造导入失败，验证目标库与 MinIO 都回到导入前状态
#
# 注入方式：把导出包里某张表的 INSERT 改成一个违反约束的值
# （例如把 users.role 改成超长字符串触发 varchar 长度错误）
set -uo pipefail

# ---------------- 参数 ----------------
# 用法: bash test_rollback.sh [源导出包] [目标库] [目标 SSE 目录]
# 环境变量：
#   PG_CONTAINER —— 若宿主机无 psql，指定 postgres 容器名走 docker exec
#   DB_HOST/DB_PORT/DB_USER —— 直连模式下的连接参数
#   MINIO_ENDPOINT/MINIO_PORT/MINIO_ACCESS_KEY/MINIO_SECRET_KEY
#   MC_ALIAS —— mc 里目标 MinIO 的别名（默认 sse-dst）
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
BROKEN=/tmp/export_broken
rm -rf "$BROKEN"
cp -r "$SRC_PKG" "$BROKEN"
rm -rf "$BROKEN/.rollback-"*
echo "源导出包: $SRC_PKG"
echo "目标库:   $TARGET_DB"
echo "目标目录: $SSE_TARGET_DIR"

echo "=== 注入故障：让某个 NOT NULL 列出现 NULL ==="
# 注入方式：把 users 表一条记录里的 NOT NULL 列改成 NULL。
# 触发的是 PostgreSQL 内建的 not_null_violation（23502），
# 不依赖任何自定义唯一约束 —— 离线提取的 schema.sql 里不含自定义约束，
# 用唯一约束做注入在恢复出来的目标库上不会触发。
# users 是导入顺序里的第一张表，后面还有十几张表，
# 因此能验证"前面的表已写入、后面的失败"时是否真的整体回滚。
python3 - "$BROKEN/pg/table_users.sql" <<'PYEOF'
import re, sys
p = sys.argv[1]
s = open(p, encoding="utf-8").read()

# users 表的 NOT NULL 列里挑一个 text 型的（name/phone/department/role/status）
# 在 VALUES 里把该列的值换成 NULL
m = re.search(r"INSERT INTO public\.users\s*(?:\([^)]*\))?\s*VALUES\s*\((.*?)\);", s, re.S)
if not m:
    print("  ❌ 未找到 users 的 INSERT 语句"); sys.exit(1)

cols_part = s[s.find("INSERT INTO public.users"):s.find("VALUES", s.find("INSERT INTO public.users"))]
cols = re.findall(r'"([^"]+)"', cols_part)
vals = m.group(1)

# 用逗号切分 VALUES 里的字段（注意引号内的逗号）
parts, buf, inq, esc = [], "", False, False
for ch in vals:
    if esc:
        buf += ch; esc = False; continue
    if ch == "\\":
        buf += ch; esc = True; continue
    if ch == "'":
        inq = not inq; buf += ch; continue
    if ch == "," and not inq:
        parts.append(buf); buf = ""; continue
    buf += ch
parts.append(buf)

# 找 phone 列的索引（NOT NULL 且是 text）
target = None
for i, c in enumerate(cols):
    if c == "phone":
        target = i
        break
if target is None:
    print("  ❌ 未找到 phone 列"); sys.exit(1)

# 把该字段替换成 NULL（保留两侧空格）
old_val = parts[target]
parts[target] = " NULL "
new_vals = ",".join(parts)
new_stmt = f"INSERT INTO public.users ({', '.join(chr(34)+c+chr(34) for c in cols)}) VALUES ({new_vals});"
s = s[:m.start()] + new_stmt + s[m.end():]
open(p, "w", encoding="utf-8").write(s)
print(f"  已注入: phone 列 -> NULL (NOT NULL 冲突)")
PYEOF

# 重新计算 checksum，否则导入脚本的完整性校验会先拒绝
( cd "$BROKEN" && find . -type f ! -path './meta/checksums.sha256' -print0 \
    | sort -z | xargs -0 sha256sum > meta/checksums.sha256 )

echo
echo "=== 注入前目标状态（快照） ==="
BEFORE_USERS=$($PSQL -d "$TARGET_DB" -tAc "SELECT COUNT(*) FROM users")
BEFORE_RULES=$($PSQL -d "$TARGET_DB" -tAc "SELECT COUNT(*) FROM reasoning_rules")
BEFORE_MINIO=$(mc ls --recursive "$MC_ALIAS" 2>/dev/null | wc -l || echo 0)
echo "  users=$BEFORE_USERS  reasoning_rules=$BEFORE_RULES  minio对象=$BEFORE_MINIO"
echo "  目标库当前通知日志: $($PSQL -d "$TARGET_DB" -tAc 'SELECT COUNT(*) FROM notification_logs')"

echo
echo "=== 执行导入（预期失败并触发回滚） ==="
DB_HOST=127.0.0.1 DB_PORT=55433 DB_USER=sse DB_PASSWORD=sse_dev \
MINIO_ENDPOINT=127.0.0.1 MINIO_PORT=59102 MINIO_ACCESS_KEY=minioadmin MINIO_SECRET_KEY=minioadmin \
SSE_DIR="$SSE_TARGET_DIR" \
bash /opt/data/tools/sse-data/import_sse_data.sh --from "$BROKEN" --target-db "$TARGET_DB" 2>&1 | tail -35
IMPORT_EXIT=${PIPESTATUS[0]}
echo "  导入退出码: $IMPORT_EXIT"

echo
echo "=== 注入后目标状态（应与注入前一致） ==="
AFTER_USERS=$($PSQL -d "$TARGET_DB" -tAc "SELECT COUNT(*) FROM users")
AFTER_RULES=$($PSQL -d "$TARGET_DB" -tAc "SELECT COUNT(*) FROM reasoning_rules")
AFTER_MINIO=$(mc ls --recursive "$MC_ALIAS" 2>/dev/null | wc -l || echo 0)
echo "  users=$AFTER_USERS  reasoning_rules=$AFTER_RULES  minio对象=$AFTER_MINIO"

echo
echo "=== 判定 ==="
FAIL=0
# 基线为空说明目标库本身就没数据，测试无从判断 —— 必须判失败，不能假通过。
if [ -z "$BEFORE_USERS" ] || [ "$BEFORE_USERS" = "0" ]; then
  echo "  ❌ 基线无效：目标库 users 为空，无法验证回滚"
  FAIL=1
fi
if [ -z "$AFTER_USERS" ]; then
  echo "  ❌ 回滚后 users 表不存在或查询失败"
  FAIL=1
fi
[ "$BEFORE_USERS" = "$AFTER_USERS" ] || { echo "  ❌ users 行数变了"; FAIL=1; }
[ "$BEFORE_RULES" = "$AFTER_RULES" ] || { echo "  ❌ reasoning_rules 行数变了"; FAIL=1; }
[ "$BEFORE_MINIO" = "$AFTER_MINIO" ] || { echo "  ❌ MinIO 对象数变了"; FAIL=1; }
[ "$IMPORT_EXIT" != "0" ] || { echo "  ❌ 导入本应失败却成功了"; FAIL=1; }

if [ "$FAIL" = "0" ]; then
  echo "  ✅ 回滚成功：数据库与 MinIO 均回到导入前状态"
  exit 0
else
  echo "  ❌ 回滚失败"
  exit 1
fi
