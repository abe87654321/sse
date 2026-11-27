#!/usr/bin/env python3
"""
旧盘离线恢复结果 → SSE 导入包 转换器
=====================================

把【完全离线】从旧盘提取出来的原始数据：
    olddisk-recovered/pg-export/db/<table>.csv     (PostgreSQL CSV 导出)
    olddisk-recovered/minio-export/<bucket>/<key>   (MinIO 对象内容)
    olddisk-recovered/configs/*                    (配置文件)
转换成 import_sse_data.sh 认识的导出包格式：
    <out>/pg/table_<table>.sql     INSERT 语句
    <out>/pg/schema.sql            建表语句
    <out>/minio/<bucket>/...       对象文件
    <out>/files/...                配置文件
    <out>/meta/...                 清单、关联清单、checksums
    <out>/manifest.json            包元信息

★ 关键：列类型必须从【目标 schema】拿，而不是从 CSV 猜。
  因为 CSV 里 NULL 和空字符串都可能是空字段，只有 schema 能区分
  NOT NULL 列（不能是 NULL）和可空列。

用法:
    python3 build_import_package.py \
        --recovered /opt/data/tools/sse-data/olddisk-recovered \
        --outdir    /opt/data/tools/sse-data/olddisk-package \
        --schema    /opt/data/tools/sse-data/olddisk-package/pg/schema.sql \
        --source-host 192.168.3.107
"""
import argparse
import csv
import hashlib
import json
import os
import re
import shutil
import sys

# 导入顺序：被依赖的表先插，父表后插
IMPORT_ORDER = [
    "expense_categories",
    "reasoning_rules",
    "approval_rules",
    "mcp_api_keys",
    "ontology_snapshots",
    "notification_logs",
    "notification_deliveries",
    "system_messages",
    "payment_audit_logs",
    "users",
    "expense_reports",
    "expense_items",
    "payment_receipts",
    "invoices",
    "approval_records",
    "identity_mappings",
    "schema_migrations",
]

MINIO_BUCKETS = ["invoices", "payment-receipts", "avatars"]


# ---------------- schema 解析 ----------------
def parse_schema(sql_path):
    """
    从 pg_dump 的 schema.sql 里解析出每张表的列定义。

    返回 {table: [{"name":..., "type":..., "notnull":bool, "default":str|None}, ...]}
    """
    if not os.path.exists(sql_path):
        raise SystemExit(f"找不到 schema 文件: {sql_path}")

    text = open(sql_path, encoding="utf-8").read()
    tables = {}

    # 匹配 CREATE TABLE public.<name> (...);
    for m in re.finditer(
        r"CREATE TABLE public\.(\w+)\s*\((.*?)\n\);", text, re.S
    ):
        tname = m.group(1)
        body = m.group(2)
        cols = []
        for line in body.split("\n"):
            line = line.strip()
            if not line or line.startswith("--"):
                continue
            # 去掉行尾逗号
            line = line.rstrip(",")
            cm = re.match(r'^("?[\w]+"?)\s+(.+)$', line)
            if not cm:
                continue
            cname = cm.group(1).strip('"')
            rest = cm.group(2).strip()
            # 排除表级约束（PRIMARY KEY (...)、CONSTRAINT ...）
            if re.match(r"^(CONSTRAINT|PRIMARY|FOREIGN|UNIQUE|CHECK|EXCLUDE)", rest, re.I):
                continue
            notnull = " NOT NULL" in rest.upper()
            default = None
            dm = re.search(r"DEFAULT\s+('(?:[^']|'')*'|[^\s,]+)", rest, re.I)
            if dm:
                default = dm.group(1)
            # 类型 = rest 去掉 NOT NULL / DEFAULT 部分
            ctype = re.split(r"\s+(?:NOT\s+NULL|NULL|DEFAULT)\b", rest, flags=re.I)[0].strip()
            cols.append({
                "name": cname,
                "type": ctype,
                "notnull": notnull,
                "default": default,
            })
        tables[tname] = cols
    return tables


# ---------------- CSV → SQL ----------------
def csv_to_sql(csv_path, table, cols):
    """
    把一张表的 CSV 转成 INSERT 语句。

    CSV 里的反斜杠 N 表示 NULL（导出器用 NULL 标记），其余空字段是空字符串。
    """
    if not os.path.exists(csv_path):
        return None, 0

    with open(csv_path, encoding="utf-8", newline="") as f:
        reader = csv.reader(f)
        try:
            header = next(reader)
        except StopIteration:
            return None, 0

        # CSV 列序 → schema 列名映射
        colmap = []
        for h in header:
            found = next((c for c in cols if c["name"] == h), None)
            colmap.append(found)

        rows = list(reader)

    if not rows:
        return None, 0

    colnames = ", ".join(f'"{c["name"]}"' for c in colmap if c)
    out = []
    for r in rows:
        vals = []
        for i, c in enumerate(colmap):
            raw = r[i] if i < len(r) else ""
            typ = (c or {}).get("type", "") or ""
            if raw == "\\N":
                # NULL —— 但如果该列是 NOT NULL 且无默认值，就不能是 NULL
                if c and c["notnull"]:
                    if c["default"]:
                        vals.append(sql_lit(c["default"]))
                    else:
                        vals.append("''")
                else:
                    vals.append("NULL")
            elif typ.endswith("[]"):
                # 数组列：CSV 里是 PostgreSQL 的 {a,b,c} 字面量形式。
                # 不能当字符串塞进去（'{' 会被当成普通 text），
                # 也不能整体加引号（里面的引号需要各自转义）。
                vals.append(sql_array(raw))
            else:
                vals.append(sql_lit(raw))
        out.append(
            f"INSERT INTO public.{table} ({colnames}) VALUES ({', '.join(vals)});"
        )
    return "\n".join(out), len(rows)


def sql_lit(s):
    """
    把字符串转成 SQL 字面量。

    ★ 关键：必须保证【一条 INSERT 记录只占一个物理行】。
      真实数据里 system_messages.body 含换行（变更日志是多行文本），
      如果直接内嵌换行，生成的 .sql 文件一条 INSERT 会横跨多行，
      下游按行 grep 的导入器只能取到第一行 → SQL 残缺 → 语法错误。

      因此统一用 PostgreSQL 的 E'' 转义字符串形式，把换行/回车/制表符
      转成 \n / \r / \t，反斜杠转成 \\，单引号转成 ''。
    """
    if s is None:
        return "NULL"
    s = s.replace("\\", "\\\\")        # 反斜杠先转
    s = s.replace("'", "''")                # 单引号
    s = s.replace("\n", "\\n").replace("\r", "\\r").replace("\t", "\\t")
    return f"E'{s}'"


def sql_array(raw):
    """
    把 PostgreSQL 的数组字面量 {a,b,c} 转成安全的 SQL。

    处理：
      - 空数组 {} → '{}'
      - 元素含逗号/花括号/空格/引号 → 用双引号包裹并转义
      - NULL 元素 → NULL
    """
    raw = raw.strip()
    if not raw.startswith("{") or not raw.endswith("}"):
        # 不是数组字面量（理论上不会发生），退化成字符串
        return sql_lit(raw)
    inner = raw[1:-1].strip()
    if inner == "":
        return "'{}'"

    # 按逗号切分，但跳过引号内的逗号
    items = []
    cur = ""
    inq = False
    i = 0
    while i < len(inner):
        ch = inner[i]
        if inq:
            if ch == '"':
                if i + 1 < len(inner) and inner[i + 1] == '"':
                    cur += '""'
                    i += 2
                    continue
                inq = False
            else:
                cur += ch
        else:
            if ch == '"':
                inq = True
            elif ch == ",":
                items.append(cur)
                cur = ""
            else:
                cur += ch
        i += 1
    items.append(cur)

    parts = []
    for it in items:
        it = it.strip()
        if it.upper() == "NULL":
            parts.append("NULL")
            continue
        needs_quote = (it == "") or any(
            ch in it for ch in (",", "{", "}", chr(34), " ", chr(92)))
        if needs_quote:
            it = '"' + it.replace('"', '""') + '"'
        parts.append(it)
    return "'{" + ",".join(parts) + "}'"


# ---------------- 主流程 ----------------
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--recovered", required=True, help="olddisk-recovered 目录")
    ap.add_argument("--outdir", required=True, help="生成的导入包目录")
    ap.add_argument("--schema", required=True, help="schema.sql 路径")
    ap.add_argument("--source-host", default="unknown")
    args = ap.parse_args()

    rec = args.recovered
    out = args.outdir
    if os.path.exists(out):
        shutil.rmtree(out)
    for d in ("pg", "minio", "files", "meta"):
        os.makedirs(os.path.join(out, d), exist_ok=True)

    tables = parse_schema(args.schema)
    print(f"schema 解析: {len(tables)} 张表")

    # ---- schema.sql 复制 ----
    shutil.copy(args.schema, os.path.join(out, "pg", "schema.sql"))

    # ---- 数据表 ----
    present = []
    counts = {}
    total_rows = 0
    for t in IMPORT_ORDER:
        csv_path = os.path.join(rec, "pg-export", "db", f"{t}.csv")
        if not os.path.exists(csv_path):
            print(f"  跳过 {t}（无 CSV）")
            continue
        cols = tables.get(t)
        if cols is None:
            print(f"  ⚠️  {t} 不在 schema 里，跳过")
            continue
        sql, n = csv_to_sql(csv_path, t, cols)
        if not sql:
            print(f"  {t:24} 0 行")
            continue
        with open(os.path.join(out, "pg", f"table_{t}.sql"), "w", encoding="utf-8") as f:
            f.write(sql + "\n")
        present.append(t)
        counts[t] = n
        total_rows += n
        print(f"  {t:24} {n:>5} 行")

    with open(os.path.join(out, "meta", "tables_present.txt"), "w", encoding="utf-8") as f:
        f.write("\n".join(present) + "\n")
    with open(os.path.join(out, "meta", "table_counts.txt"), "w", encoding="utf-8") as f:
        for t, n in counts.items():
            f.write(f"{t}={n}\n")

    # ---- MinIO 对象 ----
    mo_src = os.path.join(rec, "minio-export")
    mo_counts = {}
    for b in MINIO_BUCKETS:
        bsrc = os.path.join(mo_src, b)
        bdst = os.path.join(out, "minio", b)
        os.makedirs(bdst, exist_ok=True)
        n = 0
        if os.path.isdir(bsrc):
            for root, dirs, files in os.walk(bsrc):
                for fn in files:
                    if fn.startswith("."):
                        continue
                    rel = os.path.relpath(os.path.join(root, fn), bsrc)
                    d = os.path.join(bdst, rel)
                    os.makedirs(os.path.dirname(d), exist_ok=True)
                    shutil.copy2(os.path.join(root, fn), d)
                    n += 1
        mo_counts[b] = n
        print(f"  bucket {b:18} {n} 个对象")

    with open(os.path.join(out, "meta", "minio_counts.txt"), "w", encoding="utf-8") as f:
        for b, n in mo_counts.items():
            f.write(f"{b}={n}\n")

    # ---- 显式语义转换（旧盘 → 新 schema）----
    # 旧盘实际列类型与当前 migration 存在漂移（approver_id: varchar → uuid），
    # 必须显式转换并留痕，不能静默改写。
    print("\n语义转换 ...")
    try:
        import subprocess
        r = subprocess.run(
            [sys.executable, os.path.join(os.path.dirname(os.path.abspath(__file__)),
                                          "transform_approver_id.py"), out],
            capture_output=True, text=True, timeout=120)
        if r.stdout:
            print(r.stdout.rstrip())
        if r.returncode != 0:
            print(f"  ⚠️  语义转换返回 {r.returncode}: {r.stderr[-300:]}")
    except Exception as e:
        print(f"  ⚠️  语义转换失败: {e}")

    # ---- 关联清单（磁盘全路径 = bucket + '/' + storage_key）----
    link_root = os.path.join(out, "meta")
    for t in ("invoices", "payment_receipts", "avatars"):
        with open(os.path.join(link_root, f"link_check.txt.{t}"), "w", encoding="utf-8") as f:
            pass

    def dump_links(tbl, col, bucket):
        p = os.path.join(rec, "pg-export", "db", f"{tbl}.csv")
        if not os.path.exists(p):
            return 0
        n = 0
        with open(p, encoding="utf-8", newline="") as f:
            for r in csv.DictReader(f):
                k = (r.get(col) or "").strip()
                if not k or k == "\\N":
                    continue
                with open(os.path.join(link_root, f"link_check.txt.{tbl}"), "a", encoding="utf-8") as o:
                    o.write(f"{bucket}/{k}|{k}\n")
                n += 1
        return n

    ln = 0
    ln += dump_links("invoices", "storage_key", "invoices")
    ln += dump_links("payment_receipts", "storage_key", "payment-receipts")
    # avatars 用 users.avatar_url
    up = os.path.join(rec, "pg-export", "db", "users.csv")
    if os.path.exists(up):
        with open(up, encoding="utf-8", newline="") as f:
            for r in csv.DictReader(f):
                a = (r.get("avatar_url") or "").strip()
                if not a or a == "\\N":
                    continue
                with open(os.path.join(link_root, "link_check.txt.avatars"), "a", encoding="utf-8") as o:
                    o.write(f"avatars/{a}|{a}\n")
                ln += 1
    print(f"  关联清单: {ln} 条")

    # ---- 配置文件 ----
    cfg_src = os.path.join(rec, "configs")
    cfg_map = {
        "ai-config.json": "ai-config.json",
        "ai-test-history.json": "ai-test-history.json",
        "env.local": "env.local",
    }
    n_cfg = 0
    for src_name, dst_name in cfg_map.items():
        p = os.path.join(cfg_src, src_name)
        if os.path.exists(p):
            shutil.copy2(p, os.path.join(out, "files", dst_name))
            n_cfg += 1
    print(f"  配置文件: {n_cfg} 个")

    # ---- export_meta.sh（import 脚本会读 DB_NAME / MINIO_ENDPOINT）----
    with open(os.path.join(out, "meta", "export_meta.sh"), "w", encoding="utf-8") as f:
        f.write(f"""#!/bin/bash
# 由 build_import_package.py 生成 —— 数据来源: 旧盘离线提取
export DB_NAME='sse'
export MINIO_ENDPOINT='http://127.0.0.1:9000'
export MINIO_PORT='9000'
export SOURCE_HOST='{args.source_host}'
export SOURCE_METHOD='offline-file-parse'
""")
    os.chmod(os.path.join(out, "meta", "export_meta.sh"), 0o755)

    # ---- manifest.json ----
    manifest = {
        "format": "sse-import-package",
        "version": 2,
        "source": {
            "method": "offline-file-parse",
            "description": "完全离线：直接解析旧盘 PGDATA 与 MinIO xl.meta，未启动任何服务",
            "host": args.source_host,
        },
        "database": {
            "tables": len(present),
            "total_rows": total_rows,
            "table_counts": counts,
        },
        "minio": {"buckets": mo_counts},
        "files": {"count": n_cfg},
        "links": {"total": ln},
    }
    with open(os.path.join(out, "manifest.json"), "w", encoding="utf-8") as f:
        json.dump(manifest, f, ensure_ascii=False, indent=2)

    # ---- checksums ----
    ck = os.path.join(out, "meta", "checksums.sha256")
    entries = []
    for root, dirs, files in os.walk(out):
        for fn in sorted(files):
            p = os.path.join(root, fn)
            rel = os.path.relpath(p, out)
            if rel == "meta/checksums.sha256":
                continue
            h = hashlib.sha256(open(p, "rb").read()).hexdigest()
            entries.append(f"{h}  {rel}")
    with open(ck, "w", encoding="utf-8") as f:
        f.write("\n".join(sorted(entries)) + "\n")

    print(f"\n✅ 导入包已生成: {out}")
    print(f"   表 {len(present)} 张 / {total_rows} 行")
    print(f"   MinIO {sum(mo_counts.values())} 个对象 / 配置 {n_cfg} 个")
    print(f"   关联 {ln} 条 / checksums {len(entries)} 个文件")
    print(f"\n下一步:")
    print(f"   bash import_sse_data.sh --from {out}")


if __name__ == "__main__":
    main()
