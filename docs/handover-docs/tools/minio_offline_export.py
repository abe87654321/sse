#!/usr/bin/env python3
"""
MinIO 数据目录离线导出器
========================

在【不启动 MinIO、不用 mc 客户端】的前提下，直接遍历 MinIO 数据目录，
解析每个对象的 xl.meta，把对象内容导出成普通文件。

产出布局（可直接喂给 mc mirror / import 脚本）：
    <outdir>/<bucket>/<object-key>       对象内容
    <outdir>/_meta/objects.json           对象清单（name/size/etag/content_type/mtime/sha256）
    <outdir>/_meta/objects.csv            同上，CSV 便于人工核对

只读保证：只以 'rb' 打开源文件；全部输出写到 outdir。

用法：
    python3 minio_offline_export.py --datadir /oldroot/var/lib/docker/volumes/<v>/_data \
                                   --outdir  /tmp/minio-export [--buckets invoices,payment-receipts,avatars]
"""

import argparse
import hashlib
import json
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from xlmeta_parse import parse_xlmeta_safe  # noqa: E402


def guess_bucket(name):
    """从对象目录名反推 bucket —— 对象目录形如 <bucket>/<key-with-slashes>/。"""
    return name.split("/", 1)[0] if "/" in name else name


def walk_objects(datadir, buckets=None):
    """
    遍历 MinIO 数据目录，找出所有对象目录（含 xl.meta 的）。

    MinIO XL 布局：
        <datadir>/<bucket>/<key path>/xl.meta
        <datadir>/<bucket>/<key path>/part.1     （大对象）
    单盘模式下 bucket 就是顶层目录。
    """
    objects = []
    skipped = []
    try:
        top = sorted(os.listdir(datadir))
    except OSError as e:
        return objects, [f"无法列出 {datadir}: {e}"]

    for entry in top:
        if entry.startswith("."):
            continue
        bucket_dir = os.path.join(datadir, entry)
        if not os.path.isdir(bucket_dir):
            continue
        if buckets and entry not in buckets:
            continue

        for root, dirs, files in os.walk(bucket_dir):
            if "xl.meta" not in files:
                continue
            rel = os.path.relpath(root, bucket_dir)
            key = rel.replace(os.sep, "/")
            objects.append({
                "bucket": entry,
                "key": key,
                "dir": root,
                "xlmeta": os.path.join(root, "xl.meta"),
            })
    return objects, skipped


def export_one(obj, outdir, dry_run=False):
    """导出一个对象。返回 manifest 条目。"""
    entry = {
        "bucket": obj["bucket"],
        "key": obj["key"],
        "source_dir": obj["dir"],
    }
    meta = parse_xlmeta_safe(obj["xlmeta"])
    if "error" in meta:
        entry["error"] = meta["error"]
        return entry

    entry["size"] = meta.get("size")
    entry["etag"] = meta.get("etag")
    entry["content_type"] = meta.get("content_type")
    entry["mtime_ns"] = meta.get("mtime_ns")
    entry["inline"] = meta.get("inline")

    payload = meta.get("payload")
    if payload is not None:
        # 小对象：内容内联在 xl.meta
        entry["source"] = "inline"
        entry["sha256"] = hashlib.sha256(payload).hexdigest()
        if not dry_run:
            dest = os.path.join(outdir, obj["bucket"], *obj["key"].split("/"))
            os.makedirs(os.path.dirname(dest), exist_ok=True)
            with open(dest, "wb") as f:
                f.write(payload)
        return entry

    # 大对象：内容在 part.N 文件里。
    # MinIO XL 布局有两种：
    #   旧式: <objdir>/part.1
    #   新式: <objdir>/<DDir-hex>/part.1   （DDir 来自 stat）
    search_dirs = [obj["dir"]]
    ddir = meta.get("ddir")
    if ddir:
        cand = os.path.join(obj["dir"], ddir)
        if os.path.isdir(cand):
            search_dirs.insert(0, cand)

    parts = []
    for sd in search_dirs:
        try:
            for fn in sorted(os.listdir(sd)):
                if fn.startswith("part.") and fn != "part.erasure":
                    parts.append(os.path.join(sd, fn))
        except OSError as e:
            entry.setdefault("part_scan_errors", []).append(f"{sd}: {e}")
        if parts:
            break
    if not parts and entry.get("part_scan_errors"):
        entry["error"] = "无法列出 part 文件: " + "; ".join(entry.pop("part_scan_errors"))
        return entry

    if not parts:
        entry["error"] = "既无内联数据也无 part.N 文件"
        return entry

    entry["source"] = "parts"
    entry["parts"] = [os.path.basename(p) for p in parts]
    entry["part_dir"] = os.path.relpath(os.path.dirname(parts[0]), obj["dir"]) if parts else None
    if not dry_run:
        dest = os.path.join(outdir, obj["bucket"], *obj["key"].split("/"))
        os.makedirs(os.path.dirname(dest), exist_ok=True)
        h = hashlib.sha256()
        with open(dest, "wb") as out:
            for p in parts:
                with open(p, "rb") as f:
                    while True:
                        chunk = f.read(1024 * 1024)
                        if not chunk:
                            break
                        out.write(chunk)
                        h.update(chunk)
        entry["sha256"] = h.hexdigest()
    else:
        entry["sha256"] = None
    return entry


def main():
    ap = argparse.ArgumentParser(description="MinIO 数据目录离线导出")
    ap.add_argument("--datadir", required=True, help="MinIO 数据目录（含 .minio.sys 的那一层）")
    ap.add_argument("--outdir", required=True, help="导出目标目录")
    ap.add_argument("--buckets", default="", help="逗号分隔的 bucket 白名单；留空=全部")
    ap.add_argument("--dry-run", action="store_true", help="只扫描不写文件")
    args = ap.parse_args()

    if not os.path.isdir(args.datadir):
        print(f"❌ 数据目录不存在: {args.datadir}", file=sys.stderr)
        return 2

    buckets = [b.strip() for b in args.buckets.split(",") if b.strip()]

    print(f"扫描 {args.datadir}")
    objects, skipped = walk_objects(args.datadir, buckets or None)
    print(f"发现 {len(objects)} 个对象"
          + (f"（bucket 过滤: {', '.join(buckets)}）" if buckets else ""))
    for s in skipped:
        print(f"  ⚠️ {s}")

    if not args.dry_run:
        os.makedirs(os.path.join(args.outdir, "_meta"), exist_ok=True)

    manifest = []
    errors = []
    by_bucket = {}
    for i, obj in enumerate(objects, 1):
        e = export_one(obj, args.outdir, args.dry_run)
        manifest.append(e)
        b = by_bucket.setdefault(e["bucket"], {"count": 0, "bytes": 0, "errors": 0})
        b["count"] += 1
        b["bytes"] += e.get("size") or 0
        if e.get("error"):
            b["errors"] += 1
            errors.append(e)
        if i % 20 == 0 or i == len(objects):
            print(f"  [{i}/{len(objects)}] {e['bucket']}/{e['key']}")

    if not args.dry_run:
        meta_dir = os.path.join(args.outdir, "_meta")
        with open(os.path.join(meta_dir, "objects.json"), "w", encoding="utf-8") as f:
            json.dump({
                "source_datadir": args.datadir,
                "exported_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                "buckets": by_bucket,
                "objects": manifest,
            }, f, ensure_ascii=False, indent=2)

        import csv
        with open(os.path.join(meta_dir, "objects.csv"), "w", encoding="utf-8", newline="") as f:
            w = csv.writer(f)
            w.writerow(["bucket", "key", "size", "sha256", "etag", "content_type", "mtime_ns", "source"])
            for e in manifest:
                w.writerow([e.get("bucket"), e.get("key"), e.get("size"), e.get("sha256"),
                            e.get("etag"), e.get("content_type"), e.get("mtime_ns"),
                            e.get("source")])

    print("\n=== 按 bucket 汇总 ===")
    for b, v in sorted(by_bucket.items()):
        print(f"  {b:20} {v['count']:>5} 个对象  {v['bytes']:>12} 字节  错误 {v['errors']}")
    if errors:
        print(f"\n❌ {len(errors)} 个对象导出失败:")
        for e in errors[:20]:
            print(f"   {e['bucket']}/{e['key']}: {e['error']}")
        return 1
    print("\n✅ 全部对象导出成功")
    return 0


if __name__ == "__main__":
    sys.exit(main())
