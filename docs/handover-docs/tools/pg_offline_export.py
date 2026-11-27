#!/usr/bin/env python3
"""
PostgreSQL 数据目录离线导出器
==============================

在【不启动 PostgreSQL 服务、不监听任何端口】的前提下，用 PostgreSQL 的
**单用户模式**（`postgres --single`）直接对 PGDATA 执行 SQL，把业务数据导出为 CSV。

为什么用单用户模式：
  * `postgres --single` 不需要网络、不需要共享内存、不启动任何后台进程，
    是一个离线的 SQL 执行器，直接在数据目录上工作。
  * PostgreSQL 自己解码所有类型（uuid / numeric / jsonb / text[] / timestamptz …），
    输出绝对正确 —— 远比自己解析 heap page 可靠。
  * 与常规 psql 导出相比，唯一差别是不支持并发/事务隔离，本场景不需要。

只读保证：
  * 【绝不】在原 PGDATA 上运行。单用户模式会写 pg_control / pg_wal / pg_xact
    （已实测：7 个文件被修改）。
  * 本脚本先把 PGDATA 【复制】到临时工作目录，在副本上操作，原盘一个字节都不动。
  * 复制完成后会立刻对原目录做 mtime+size 快照校验，确认零改动。

用法：
    python3 pg_offline_export.py --pgdata /oldroot/.../_data \
                                 --outdir  /tmp/pg-export \
                                 --pgbin   /path/to/postgresql/<ver>/bin \
                                 --dbname  sse
"""

import argparse
import csv
import hashlib
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time

# SSE 的业务表（按 FK 依赖顺序排列；导入脚本会按此顺序处理）
SSE_TABLES = [
    "users",
    "expense_categories",
    "approval_rules",
    "reasoning_rules",
    "system_messages",
    "notification_logs",
    "audit_logs",
    "invoices",
    "payment_receipts",
]

# 不导出的系统表
SKIP_TABLES = {
    "schema_migrations",
    "spatial_ref_sys",
}


def run(cmd, **kw):
    return subprocess.run(cmd, capture_output=True, text=True, **kw)


def snapshot(root):
    """对目录下所有文件做 (mtime_ns, size) 快照，用于只读校验。"""
    snap = {}
    for r, _d, files in os.walk(root):
        for fn in files:
            p = os.path.join(r, fn)
            try:
                st = os.stat(p, follow_symlinks=False)
                snap[os.path.relpath(p, root)] = (st.st_mtime_ns, st.st_size)
            except OSError:
                pass
    return snap


def diff_snap(a, b):
    keys = set(a) | set(b)
    return [k for k in keys if a.get(k) != b.get(k)]


def read_pg_version(pgdata):
    p = os.path.join(pgdata, "PG_VERSION")
    try:
        return open(p).read().strip()
    except OSError:
        return None


def detect_tables(pgbin, pgdata_work, dbname, env, workdir):
    """
    在单用户模式下查询信息架构，拿到实际存在的表。

    用服务端 COPY 写到文件再读回 —— 单用户模式的 stdout 混着 backend 提示符，
    解析 stdout 很脆弱；写文件最可靠。
    """
    out = os.path.join(workdir, "_tables.csv")
    if os.path.exists(out):
        os.remove(out)
    q = (
        "COPY (SELECT c.relname FROM pg_class c "
        "JOIN pg_namespace n ON n.oid = c.relnamespace "
        "WHERE c.relkind = 'r' AND n.nspname = 'public' "
        "ORDER BY c.relname) TO '" + out + "' WITH (FORMAT csv, HEADER);\n"
    )
    r = run([os.path.join(pgbin, "postgres"), "--single", "-D", pgdata_work, dbname],
            input=q, env=env, timeout=600)
    tables = []
    if os.path.exists(out):
        with open(out, encoding="utf-8") as f:
            for i, line in enumerate(f):
                line = line.strip()
                if not line or (i == 0 and line == "relname"):
                    continue
                tables.append(line)
    return tables, r.stderr


def export_schema(pgbin, pgdata_work, dbname, env, outdir):
    """
    导出表结构（CREATE TABLE 语句）。

    离线环境下没有 pg_dump 可用（也不需要连库），所以从信息架构里
    拼出等价的 CREATE TABLE 语句 —— 列名、类型、NOT NULL、默认值。

    注：这里只导出【表】，不导出索引/约束/函数 —— SSE 的表结构由
    migration 定义，导入端用 migration 建表更可靠。
    """
    dest = os.path.join(outdir, "db", "_columns.csv")
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    if os.path.exists(dest):
        os.remove(dest)

    q = (
        "COPY ("
        " SELECT c.relname, a.attnum, a.attname, "
        "        format_type(a.atttypid, a.atttypmod) AS coltype, "
        "        a.attnotnull, "
        "        pg_get_expr(d.adbin, d.adrelid) AS coldefault, "
        "        a.attidentity <> '' AS is_identity "
        " FROM pg_class c "
        " JOIN pg_namespace n ON n.oid = c.relnamespace "
        " JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped "
        " LEFT JOIN pg_attrdef d ON d.adrelid = c.oid AND d.adnum = a.attnum "
        " WHERE c.relkind = 'r' AND n.nspname = 'public' "
        " ORDER BY c.relname, a.attnum"
        ") TO '" + dest + "' WITH (FORMAT csv, HEADER);\n"
    )
    r = run([os.path.join(pgbin, "postgres"), "--single", "-D", pgdata_work, dbname],
            input=q, env=env, timeout=600)

    rows = []
    if os.path.exists(dest):
        with open(dest, encoding="utf-8") as f:
            import csv as _csv
            rows = list(_csv.DictReader(f))

    # 分组成 CREATE TABLE 语句
    tables = {}
    for row in rows:
        t = row["relname"]
        tables.setdefault(t, []).append(row)

    out_path = os.path.join(outdir, "schema.sql")
    with open(out_path, "w", encoding="utf-8") as f:
        f.write("-- 由 pg_offline_export.py 从旧盘 PGDATA 离线提取的表结构\n")
        f.write(f"-- 数据库: {dbname}\n\n")
        for t in sorted(tables):
            f.write(f"CREATE TABLE public.{t} (\n")
            lines = []
            for row in tables[t]:
                col = f'  "{row["attname"]}" {row["coltype"]}'
                if row["attnotnull"] == "t":
                    col += " NOT NULL"
                if row.get("coldefault"):
                    col += f' DEFAULT {row["coldefault"]}'
                lines.append(col)
            f.write(",\n".join(lines))
            f.write("\n);\n\n")

    return out_path, len(tables), r.stderr


def export_table(pgbin, pgdata_work, dbname, env, table, outdir):
    """
    用【服务端】COPY ... TO '<file>' 导出一个表。

    注意：单用户模式下 \copy（客户端复制）不可用，必须用服务端 COPY。
    服务端 COPY 要求 postgres 进程对目标路径有写权限 —— 脚本以当前用户运行，
    路径在 outdir 下，正常可写。
    """
    dest = os.path.join(outdir, "db", f"{table}.csv")
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    if os.path.exists(dest):
        os.remove(dest)
    # ★ NULL 必须与空字符串区分开！
    #   COPY 默认把 NULL 输出成空字段，于是 NULL 和 '' 完全无法分辨
    #   （实测：users.parent_id 是 NULL，password_hash 是 ''，导出后长得一模一样）
    #   用 psql 惯用的 \N 作为 NULL 标记，导入时再还原。
    sql = (f"COPY (SELECT * FROM {table}) TO '{dest}' "
           f"WITH (FORMAT csv, HEADER, NULL '\\N');\n")
    r = run([os.path.join(pgbin, "postgres"), "--single", "-D", pgdata_work, dbname],
            input=sql, env=env, timeout=900)
    ok = os.path.exists(dest) and os.path.getsize(dest) > 0
    return {
        "table": table,
        "file": dest if ok else None,
        "bytes": os.path.getsize(dest) if os.path.exists(dest) else 0,
        "ok": ok,
        "stderr_tail": (r.stderr or "")[-400:],
    }


def main():
    ap = argparse.ArgumentParser(description="PostgreSQL 数据目录离线导出")
    ap.add_argument("--pgdata", required=True, help="旧盘上的 PGDATA 目录（只读）")
    ap.add_argument("--outdir", required=True, help="导出目标目录")
    ap.add_argument("--pgbin", required=True, help="与 PGDATA 同 major 版本的 PostgreSQL bin 目录")
    ap.add_argument("--dbname", default="sse", help="数据库名")
    ap.add_argument("--tables", default="", help="逗号分隔表名；留空=自动探测")
    ap.add_argument("--keep-work", action="store_true", help="保留临时工作副本（调试用）")
    ap.add_argument("--workdir", default="", help="临时副本放置目录")
    args = ap.parse_args()

    if not os.path.isdir(args.pgdata):
        print(f"❌ PGDATA 不存在: {args.pgdata}", file=sys.stderr)
        return 2
    if not os.path.isdir(args.pgbin):
        print(f"❌ pgbin 不存在: {args.pgbin}", file=sys.stderr)
        return 2

    pgbin = os.path.abspath(args.pgbin)
    env = dict(os.environ)
    env["PGCLIENTENCODING"] = "UTF8"

    pgver = read_pg_version(args.pgdata)
    print(f"PGDATA      : {args.pgdata}")
    print(f"PG_VERSION  : {pgver}")
    print(f"pgbin       : {pgbin}")

    # 版本一致性检查
    try:
        r = run([os.path.join(pgbin, "postgres"), "--version"], env=env)
        binver = r.stdout.strip()
        print(f"binary      : {binver}")
        bin_major = binver.split()[-1].split(".")[0] if binver else "?"
    except Exception as e:
        print(f"❌ 无法执行 postgres 二进制: {e}", file=sys.stderr)
        return 2

    if pgver and bin_major and pgver.split(".")[0] != bin_major:
        print(f"❌ 版本不匹配: PGDATA 是 {pgver}，二进制是 {binver}")
        print("   PostgreSQL 不允许用不同 major 版本的二进制打开数据目录。")
        print("   需要准备对应 major 版本的 PostgreSQL 二进制。")
        return 3

    os.makedirs(args.outdir, exist_ok=True)

    # ---- 复制 PGDATA 到工作副本 ----
    work_parent = args.workdir or tempfile.mkdtemp(prefix="pgoffline_")
    os.makedirs(work_parent, exist_ok=True)
    work = os.path.join(work_parent, "pgdata")
    print(f"\n复制 PGDATA 到工作副本: {work}")
    t0 = time.time()
    # 排除运行时文件：postmaster.pid 会让单用户模式拒绝启动；
    # postmaster.opts / postmaster.opts 之类的运行时产物同样无需复制。
    ignore = shutil.ignore_patterns("postmaster.pid", "postmaster.opts")
    shutil.copytree(args.pgdata, work, symlinks=True, ignore=ignore)
    print(f"  复制完成 ({time.time()-t0:.1f}s)")

    # PGDATA 权限必须是 0700
    os.chmod(work, 0o700)

    orig_before = snapshot(args.pgdata)

    try:
        # ---- 探测表 ----
        tables = [t.strip() for t in args.tables.split(",") if t.strip()]
        if not tables:
            print("\n探测数据库中的表 ...")
            tables, err = detect_tables(pgbin, work, args.dbname, env, work_parent)
            if not tables:
                print(f"❌ 未能探测到表。stderr 尾部:\n{err[-800:]}")
                return 4
            print(f"  找到 {len(tables)} 张表")

        export_list = [t for t in tables if t not in SKIP_TABLES]

        # ---- 表结构 ----
        print("\n导出表结构 ...")
        try:
            spath, ntab, serr = export_schema(pgbin, work, args.dbname, env, args.outdir)
            print(f"  ✅ schema.sql: {ntab} 张表 -> {spath}")
        except Exception as e:
            print(f"  ⚠️  schema 导出失败: {e}")

        # ---- 逐表导出 ----
        print(f"\n导出 {len(export_list)} 张表 ...")
        results = []
        for t in export_list:
            res = export_table(pgbin, work, args.dbname, env, t, args.outdir)
            status = "✅" if res["ok"] else "❌"
            print(f"  {status} {t:24} {res['bytes']:>10} 字节")
            if not res["ok"]:
                print(f"      stderr: {res['stderr_tail'][:300]}")
            results.append(res)

    finally:
        # ---- 只读校验：原 PGDATA 必须零改动 ----
        orig_after = snapshot(args.pgdata)
        changed = diff_snap(orig_before, orig_after)
        print(f"\n=== 原 PGDATA 只读校验 ===")
        print(f"  文件数 {len(orig_before)} → {len(orig_after)}")
        print(f"  被修改的文件: {len(changed)}")
        if changed:
            for k in sorted(changed)[:20]:
                print(f"    ❌ {k}")
        else:
            print("  ✅ 原盘 PGDATA 完全未被修改")

        if not args.keep_work:
            shutil.rmtree(work_parent, ignore_errors=True)
        else:
            print(f"\n工作副本保留在: {work}")

    # ---- manifest ----
    ok_count = sum(1 for r in results if r["ok"])
    manifest = {
        "source_pgdata": args.pgdata,
        "pg_version": pgver,
        "binary": binver,
        "exported_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "source_unchanged": len(changed) == 0,
        "tables": [
            {"table": r["table"], "bytes": r["bytes"], "ok": r["ok"],
             "file": os.path.relpath(r["file"], args.outdir) if r["file"] else None}
            for r in results
        ],
    }
    with open(os.path.join(args.outdir, "db_manifest.json"), "w", encoding="utf-8") as f:
        json.dump(manifest, f, ensure_ascii=False, indent=2)

    # ---- 行数统计 ----
    counts = {}
    for r in results:
        if not r["ok"]:
            continue
        try:
            # ★ 必须按 CSV 记录数统计，不能按物理行数！
            #   jsonb / text 字段里含换行时，一条记录会占多行
            #   （实测 notification_logs: 物理行 135 → 实际记录 49）
            import csv as _csv
            with open(r["file"], encoding="utf-8", newline="") as f:
                counts[r["table"]] = sum(1 for _ in _csv.reader(f)) - 1
        except OSError:
            pass
    with open(os.path.join(args.outdir, "db_row_counts.json"), "w", encoding="utf-8") as f:
        json.dump(counts, f, ensure_ascii=False, indent=2)

    print(f"\n=== 导出行数 ===")
    for t, c in sorted(counts.items()):
        print(f"  {t:24} {c:>6}")
    print(f"\n成功 {ok_count}/{len(results)} 张表")
    return 0 if ok_count == len(results) and not changed else 1


if __name__ == "__main__":
    sys.exit(main())
