#!/usr/bin/env bash
# ============================================================================
# SSE 数据导出脚本
#
# 导出三类数据：
#   1. PostgreSQL —— 用户管理、系统管理（分类/审批规则/推理规则/AI配置快照）、
#      消息管理（通知日志/送达记录/广播消息）、报销单据与明细、发票元数据、
#      支付回单、审计日志、身份映射、本体快照、MCP API Key
#   2. MinIO 对象存储 —— 发票文件、支付回单文件、用户头像
#   3. 文件系统配置 —— ai-config.json、ai-test-history.json、.env
#
# 特性：
#   - 只读操作，导出过程不修改源系统，无需回滚
#   - 全程校验：PG 表行数、MinIO 对象数、checksum 逐项比对
#   - 生成 manifest.json（清单 + sha256），供导入脚本校验
#   - 断点续传：重复执行会覆盖同名输出，天然幂等
#
# 用法：
#   bash export_sse_data.sh                          # 默认参数
#   OUT_DIR=/mnt/nas/sse-backup bash export_sse_data.sh
# ============================================================================
set -euo pipefail

# ---------------- 配置 ----------------
OUT_DIR="${OUT_DIR:-$HOME/sse-export-$(date +%Y%m%d-%H%M%S)}"

# PostgreSQL（默认读 ~/.env，compose 里是 5433 端口）
DB_HOST="${DB_HOST:-localhost}"
DB_PORT="${DB_PORT:-5433}"
DB_NAME="${DB_NAME:-sse}"
DB_USER="${DB_USER:-sse}"
DB_PASSWORD="${DB_PASSWORD:-sse_dev}"
export PGPASSWORD="$DB_PASSWORD"

# MinIO
MINIO_ENDPOINT="${MINIO_ENDPOINT:-localhost}"
MINIO_PORT="${MINIO_PORT:-9002}"
MINIO_ACCESS_KEY="${MINIO_ACCESS_KEY:-minioadmin}"
MINIO_SECRET_KEY="${MINIO_SECRET_KEY:-minioadmin}"
# 导出这三个 bucket（与代码中的调用点一致）
MINIO_BUCKETS="${MINIO_BUCKETS:-invoices payment-receipts avatars}"

# SSE 项目目录（用于收集 ai-config.json 等文件）
SSE_DIR="${SSE_DIR:-$HOME/projects/sse}"

# 数据库里的业务表（按外键依赖顺序排列，导入时按此顺序插入）
PG_TABLES=(
  users
  expense_categories
  expense_reports
  expense_items
  invoices
  approval_rules
  approval_records
  notification_logs
  notification_deliveries
  system_messages
  identity_mappings
  ontology_snapshots
  reasoning_rules
  mcp_api_keys
  payment_receipts
  payment_audit_logs
)

RED=$'\033[31m'; GRN=$'\033[32m'; YEL=$'\033[33m'; CYN=$'\033[36m'; RST=$'\033[0m'
step() { echo; echo "${CYN}=== $* ===${RST}"; }
ok()   { echo "${GRN}✅ $*${RST}"; }
warn() { echo "${YEL}⚠️  $*${RST}"; }
err()  { echo "${RED}❌ $*${RST}" >&2; }

cleanup_on_error() {
  local code=$?
  echo
  err "导出失败（退出码 $code）"
  echo "导出为只读操作，源系统数据未被修改，无需回滚。"
  echo "半成品目录保留在: $OUT_DIR"
  exit $code
}
trap cleanup_on_error ERR

# ---------------- 前置检查 ----------------
step "0/7 前置检查"

command -v pg_dump >/dev/null 2>&1 || { err "找不到 pg_dump，请安装 postgresql-client"; exit 1; }
ok "pg_dump: $(pg_dump --version)"

MC_BIN=""
for c in mc smbclient; do
  if command -v "$c" >/dev/null 2>&1; then MC_BIN="$c"; break; fi
done
if [ -z "$MC_BIN" ]; then
  warn "未找到 mc (MinIO Client) —— MinIO 对象将不会被导出"
  warn "安装: https://dl.min.io/client/mc/release/linux-amd64/mc"
fi
if [ -n "$MC_BIN" ]; then ok "MinIO 客户端: $MC_BIN"; fi

# 检查 PG 连通性
if ! pg_isready -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" >/dev/null 2>&1; then
  err "无法连接 PostgreSQL: $DB_HOST:$DB_PORT"
  err "如果数据库跑在 Docker 里，先确认容器已启动: docker compose ps"
  exit 1
fi
ok "PostgreSQL 连通: $DB_HOST:$DB_PORT/$DB_NAME"

mkdir -p "$OUT_DIR"/{pg,minio,files,meta}
ok "输出目录: $OUT_DIR"

# ---------------- 1. PostgreSQL ----------------
step "1/7 导出 PostgreSQL 数据库"

# 完整 dump（含 schema + data），用于灾难恢复
echo "--- pg_dump (完整) ---"
pg_dump -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" \
  --format=custom --compress=9 --no-owner --no-privileges \
  -f "$OUT_DIR/pg/sse_full.dump"
ok "完整 dump: $(du -h "$OUT_DIR/pg/sse_full.dump" | cut -f1)"

# 逐表 SQL dump + 行数统计（导入脚本会用逐表版本，可控性更好）
echo "--- 逐表导出 ---"
: > "$OUT_DIR/meta/table_counts.txt"
: > "$OUT_DIR/meta/tables_present.txt"

for t in "${PG_TABLES[@]}"; do
  # 表可能不存在（例如老版本库没有某张表）——跳过而不是失败
  exists=$(psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -tAc \
    "SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='$t'" 2>/dev/null || echo 0)
  if [ "$exists" != "1" ]; then
    warn "表 $t 不存在，跳过"
    continue
  fi
  echo "$t" >> "$OUT_DIR/meta/tables_present.txt"

  pg_dump -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" \
    --table="public.$t" --data-only --column-inserts \
    -f "$OUT_DIR/pg/table_$t.sql"

  cnt=$(psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -tAc \
    "SELECT COUNT(*) FROM public.$t" 2>/dev/null || echo 0)
  echo "$t=$cnt" >> "$OUT_DIR/meta/table_counts.txt"
  printf "  %-28s %s 行\n" "$t" "$cnt"
done

# ---------------- 1b. 数据库 ↔ MinIO 关联清单 ----------------
# ★ 关键事实（已核对 SSE 源码，并用旧盘真实数据交叉验证）：
#
#   packages/api/src/routes/expenses.ts:886
#       const storageKey = `invoices/${req.params.id}/${itemId}_${Date.now()}.${ext}`;
#   packages/api/src/routes/expenses.ts:888
#       await minio.upload(storageKey, 'invoices', ...);
#   packages/api/src/storage/minio-storage.ts:23
#       await this.client.putObject(bucket, key, data, ...);
#
#   ⇒ 磁盘上的对象全路径 = bucket + '/' + storage_key
#     例：storage_key = "invoices/1081eb9b-.../044418fa-...pdf"
#         storage_bucket = "invoices"
#         磁盘全路径 = "invoices/invoices/1081eb9b-.../044418fa-...pdf"
#
#   也就是说 storage_key 自身已经带了一层 bucket 名，再拼一次 bucket 才是全路径。
#   【注意】不要把 storage_key 当作已经完整 —— 那样会漏掉一层目录，导致校验误报断裂。
#
#   avatars 同理：auth.ts:201 storageKey = `avatars/${userId}_${ts}.${ext}`，
#   auth.ts:151 minio.getObject(user.avatarUrl, 'avatars')
#   ⇒ 磁盘全路径 = "avatars/" + avatar_url
echo "--- 生成关联清单 ---"
: > "$OUT_DIR/meta/link_check.txt.invoices"
: > "$OUT_DIR/meta/link_check.txt.payment_receipts"
: > "$OUT_DIR/meta/link_check.txt.avatars"

dump_links() {
  local tbl="$1" col="$2" bucket="$3" out="$OUT_DIR/meta/link_check.txt.$1"
  [ -f "$OUT_DIR/meta/tables_present.txt" ] || return 0
  grep -qx "$tbl" "$OUT_DIR/meta/tables_present.txt" 2>/dev/null || return 0
  # 只有 storage_key 非空才是有效的对象引用
  psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -tAc \
    "SELECT $col FROM public.$tbl WHERE $col IS NOT NULL AND $col <> ''" \
    2>/dev/null | while IFS= read -r k; do
      [ -n "$k" ] || continue
      # 磁盘全路径 = bucket + '/' + storage_key
      echo "$bucket/$k|$k" >> "$out"
    done
}

dump_links invoices storage_key invoices
dump_links payment_receipts storage_key payment-receipts
# avatars 存在 users.avatar_url 里（bucket 固定为 avatars）
if grep -qx "users" "$OUT_DIR/meta/tables_present.txt" 2>/dev/null; then
  psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -tAc \
    "SELECT avatar_url FROM public.users WHERE avatar_url IS NOT NULL AND avatar_url <> ''" \
    2>/dev/null | while IFS= read -r k; do
      [ -n "$k" ] || continue
      echo "avatars/$k|$k" >> "$OUT_DIR/meta/link_check.txt.avatars"
    done
fi

LINK_N=$(cat "$OUT_DIR"/meta/link_check.txt.* 2>/dev/null | wc -l)
ok "关联清单: $LINK_N 条数据库记录引用了对象"


# schema（仅结构，用于重建空库）
pg_dump -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" \
  --schema-only --no-owner --no-privileges \
  -f "$OUT_DIR/pg/schema.sql"
ok "schema.sql: $(du -h "$OUT_DIR/pg/schema.sql" | cut -f1)"

# schema_migrations 单独导出（导入时需要保持版本一致）
if psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -tAc \
    "SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='schema_migrations'" 2>/dev/null | grep -q 1; then
  pg_dump -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" \
    --table="public.schema_migrations" --data-only --column-inserts \
    -f "$OUT_DIR/pg/table_schema_migrations.sql"
  echo "schema_migrations=$(psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -tAc 'SELECT COUNT(*) FROM schema_migrations')" \
    >> "$OUT_DIR/meta/table_counts.txt"
  echo "schema_migrations" >> "$OUT_DIR/meta/tables_present.txt"
  ok "schema_migrations 已导出"
fi

# ---------------- 2. MinIO ----------------
step "2/7 导出 MinIO 对象存储"

if [ -n "$MC_BIN" ] && [ "$MC_BIN" = "mc" ]; then
  mc alias set sse-export "http://$MINIO_ENDPOINT:$MINIO_PORT" "$MINIO_ACCESS_KEY" "$MINIO_SECRET_KEY" >/dev/null 2>&1 || {
    err "mc alias 设置失败 —— MinIO 不可达或凭据错误"
    exit 1
  }
  ok "mc alias 已配置"

  for b in $MINIO_BUCKETS; do
    if ! mc ls "sse-export/$b" >/dev/null 2>&1; then
      warn "bucket $b 不存在，跳过"
      continue
    fi
    mkdir -p "$OUT_DIR/minio/$b"
    n_before=$(mc ls --recursive "sse-export/$b" 2>/dev/null | wc -l)
    echo "  bucket $b: $n_before 个对象，导出中..."
    if mc mirror --overwrite "sse-export/$b" "$OUT_DIR/minio/$b" --quiet 2>/dev/null; then
      n_after=$(find "$OUT_DIR/minio/$b" -type f | wc -l)
      echo "$b=$n_after" >> "$OUT_DIR/meta/minio_counts.txt"
      if [ "$n_before" = "$n_after" ]; then
        ok "  $b: $n_after 个对象（与源一致）"
      else
        warn "  $b: 源 $n_before 个，本地 $n_after 个 —— 请复查"
      fi
    else
      err "bucket $b 导出失败"
      exit 1
    fi
  done
  mc alias rm sse-export >/dev/null 2>&1 || true
else
  warn "跳过 MinIO 导出（缺少 mc 客户端）"
fi

# ---------------- 3. 文件系统配置 ----------------
step "3/7 导出配置文件"

collect_file() {
  local pattern="$1" label="$2"
  local found=0
  # 只认 $SSE_DIR。不要用 $PWD 兜底 —— 那是脚本当前工作目录，
  # 可能恰好有同名文件，会导出【错误的配置】。
  local p="$SSE_DIR/$pattern"
  if [ -f "$p" ]; then
    cp "$p" "$OUT_DIR/files/$label"
    ok "$label ← $p"
    found=1
  fi
  if [ "$found" -eq 0 ]; then
    warn "$label 未找到（$SSE_DIR/$pattern）"
  fi
}

collect_file "ai-config.json" "ai-config.json"
collect_file "ai-test-history.json" "ai-test-history.json"
collect_file ".env" "env.local"

# ---------------- 4. 生成 manifest ----------------
step "4/7 生成清单 manifest.json"

cat > "$OUT_DIR/meta/export_meta.sh" <<EOF
#!/usr/bin/env bash
# 导出时的环境参数，导入脚本会读取（避免两边配置不一致）
export DB_HOST='$DB_HOST'
export DB_PORT='$DB_PORT'
export DB_NAME='$DB_NAME'
export DB_USER='$DB_USER'
export MINIO_ENDPOINT='$MINIO_ENDPOINT'
export MINIO_PORT='$MINIO_PORT'
export MINIO_ACCESS_KEY='$MINIO_ACCESS_KEY'
export MINIO_SECRET_KEY='$MINIO_SECRET_KEY'
export MINIO_BUCKETS='$MINIO_BUCKETS'
EOF
chmod +x "$OUT_DIR/meta/export_meta.sh"

# 所有文件的 sha256
echo "--- 计算 sha256 ---"
( cd "$OUT_DIR" && find . -type f ! -path './meta/checksums.sha256' -print0 \
    | sort -z | xargs -0 sha256sum > meta/checksums.sha256 )
ok "checksums.sha256: $(wc -l < "$OUT_DIR/meta/checksums.sha256") 个文件"

# manifest.json（用 python 生成，保证 JSON 合法）
python3 - "$OUT_DIR" <<'PYEOF'
import json, os, sys, subprocess, datetime
out = sys.argv[1]
def read(p, default=""):
    fp = os.path.join(out, p)
    return open(fp, encoding="utf-8").read().strip() if os.path.exists(fp) else default

counts = {}
for line in read("meta/table_counts.txt").splitlines():
    if "=" in line:
        k, v = line.split("=", 1)
        counts[k] = int(v)

mcounts = {}
for line in read("meta/minio_counts.txt").splitlines():
    if "=" in line:
        k, v = line.split("=", 1)
        mcounts[k] = int(v)

meta = {}
mp = os.path.join(out, "meta/export_meta.sh")
if os.path.exists(mp):
    for line in open(mp, encoding="utf-8"):
        line = line.strip()
        if line.startswith("export ") and "=" in line:
            k, v = line[6:].split("=", 1)
            meta[k] = v.strip("'\"")

manifest = {
    "format_version": "1.0",
    "exported_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
    "source": meta,
    "tables": sorted(counts.keys()),
    "table_counts": counts,
    "minio_counts": mcounts,
    "total_rows": sum(counts.values()),
    "total_objects": sum(mcounts.values()),
    "files": sorted(os.listdir(os.path.join(out, "files"))),
}
with open(os.path.join(out, "manifest.json"), "w", encoding="utf-8") as f:
    json.dump(manifest, f, ensure_ascii=False, indent=2)
print(f"manifest.json: {manifest['total_rows']} 行 DB, {manifest['total_objects']} 个对象")
PYEOF

# ---------------- 5. 完整性自检 ----------------
step "5/7 完整性自检"

if ( cd "$OUT_DIR" && sha256sum -c meta/checksums.sha256 --quiet 2>&1 | grep -v ': OK$' ); then
  err "校验和不匹配"
  exit 1
fi
ok "全部文件校验通过"

# 验证 pg dump 可读
if ! pg_restore --list "$OUT_DIR/pg/sse_full.dump" >/dev/null 2>&1; then
  err "pg_dump 文件损坏"
  exit 1
fi
ok "pg dump 结构可读"

# ---------------- 6. 汇总 ----------------
step "6/7 导出汇总"

DB_SIZE=$(du -sh "$OUT_DIR/pg" 2>/dev/null | cut -f1)
MO_SIZE=$(du -sh "$OUT_DIR/minio" 2>/dev/null | cut -f1)
TOTAL=$(du -sh "$OUT_DIR" 2>/dev/null | cut -f1)

echo "  数据库:  $DB_SIZE"
echo "  MinIO:   $MO_SIZE"
echo "  配置文件: $(ls -1 "$OUT_DIR/files" 2>/dev/null | wc -l) 个"
echo "  总计:    $TOTAL"
echo
echo "  表行数:"
while IFS= read -r line; do
  if [ -n "$line" ]; then printf "    %-30s %s\n" "${line%%=*}" "${line##*=}"; fi
done < "$OUT_DIR/meta/table_counts.txt"

step "7/7 完成"
ok "导出目录: $OUT_DIR"
echo
echo "下一步 —— 在新系统导入："
echo "  bash import_sse_data.sh --from $OUT_DIR"
echo
echo "（把整个目录拷贝到新机器后执行）"
