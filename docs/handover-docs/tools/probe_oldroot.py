#!/usr/bin/env python3
"""
SSE 旧盘离线恢复 —— 第 1 步：只读探查

目的：在【不启动任何旧盘服务】的前提下，摸清 /oldroot 里 SSE 相关数据的物理布局，
为后续直接解析磁盘文件（PostgreSQL PGDATA / MinIO xl.meta）做准备。

安全约束：
  * 全程只读。脚本内所有文件访问均为 'rb' 模式或 stat/listdir。
  * 不在 /oldroot 下创建任何文件、目录、临时文件。
  * 不修改权限、不 touch、不移动、不删除。
  * 需要 sudo 的地方只做【读取】，不写。

用法（由调用方在 107 上执行）：
    python3 probe_oldroot.py /oldroot
"""

import json
import os
import struct
import sys
from datetime import datetime, timezone


def human(n):
    if n is None:
        return "?"
    for unit in ("B", "KB", "MB", "GB", "TB"):
        if n < 1024:
            return f"{n:.1f}{unit}"
        n /= 1024
    return f"{n:.1f}PB"


def du_dir(path, max_entries=200000):
    """统计目录总大小和文件数（只读）。"""
    total = 0
    count = 0
    dirs = 0
    errors = 0
    for root, dirnames, filenames in os.walk(path, onerror=lambda e: None):
        dirs += 1
        if count > max_entries:
            errors += 1
            break
        for fn in filenames:
            try:
                st = os.stat(os.path.join(root, fn), follow_symlinks=False)
                total += st.st_size
                count += 1
            except OSError:
                errors += 1
    return total, count, dirs, errors


def find_named(root, name, max_depth=6):
    """在有限深度内按名字查找文件/目录。"""
    hits = []
    root = os.path.abspath(root)
    base_depth = root.rstrip("/").count("/")
    for root_d, dirnames, filenames in os.walk(root, onerror=lambda e: None):
        if root_d.count("/") - base_depth > max_depth:
            dirnames[:] = []
            continue
        if name in dirnames:
            hits.append(os.path.join(root_d, name) + "/")
            dirnames.remove(name)
        if name in filenames:
            hits.append(os.path.join(root_d, name))
    return hits


def probe_postgres(oldroot):
    """定位并解析 PostgreSQL PGDATA。"""
    out = {"found": []}
    candidates = []
    voldir = os.path.join(oldroot, "var/lib/docker/volumes")
    if os.path.isdir(voldir):
        for v in sorted(os.listdir(voldir)):
            p = os.path.join(voldir, v, "_data")
            if os.path.isdir(p):
                # 典型 PGDATA 特征
                if os.path.exists(os.path.join(p, "PG_VERSION")) or \
                   os.path.exists(os.path.join(p, "global/pg_control")):
                    candidates.append((v, p))
    # 兜底：全盘找 PG_VERSION
    if not candidates:
        for hit in find_named(oldroot, "PG_VERSION", max_depth=8):
            candidates.append(("(found-by-scan)", os.path.dirname(hit)))

    for vol, pgdata in candidates:
        info = {"volume": vol, "pgdata": pgdata}
        try:
            ver = open(os.path.join(pgdata, "PG_VERSION")).read().strip()
            info["pg_version"] = ver
        except OSError as e:
            info["pg_version_error"] = str(e)

        # pg_control —— 记录 checkpoint LSN、数据库系统标识等
        pgctl = os.path.join(pgdata, "global/pg_control")
        if os.path.exists(pgctl):
            try:
                info["pg_control_size"] = os.path.getsize(pgctl)
                with open(pgctl, "rb") as f:
                    head = f.read(64)
                # pg_control: magic(4) + version(4) + catalogVersionNo(4) + systemIdentifier(8)
                if len(head) >= 20:
                    magic = head[0:4]
                    # PG_CONTROL_MAGIC = 0xD113 (little endian 2 bytes) for PG13+
                    info["pg_control_magic_hex"] = magic.hex()
                    info["catalog_version_no"] = struct.unpack_from("<I", head, 8)[0]
                    info["system_identifier"] = struct.unpack_from("<Q", head, 12)[0]
            except OSError as e:
                info["pg_control_error"] = str(e)

        # 数据目录结构与体量
        for sub in ("base", "global", "pg_wal", "pg_xact", "pg_tblspc"):
            sp = os.path.join(pgdata, sub)
            if os.path.isdir(sp):
                t, c, d, e = du_dir(sp, max_entries=300000)
                info[f"{sub}_size"] = human(t)
                info[f"{sub}_files"] = c
        # WAL 段数量（每个 16MB）
        pgwal = os.path.join(pgdata, "pg_wal")
        if os.path.isdir(pgwal):
            segs = [f for f in os.listdir(pgwal)
                    if len(f) == 24 and f[:8].isdigit() and f.endswith(".lz4") is False]
            info["wal_segments"] = len(segs)
            if segs:
                info["wal_segment_sample"] = sorted(segs)[:5]

        # 数据库 OID 目录
        base = os.path.join(pgdata, "base")
        if os.path.isdir(base):
            oids = []
            for d in os.listdir(base):
                if d.isdigit():
                    oids.append(int(d))
            info["base_db_oids"] = sorted(oids)
        out["found"].append(info)
    return out


def probe_minio(oldroot):
    """定位并解析 MinIO 数据目录（xl.meta 格式）。"""
    out = {"found": []}
    candidates = []
    voldir = os.path.join(oldroot, "var/lib/docker/volumes")
    if os.path.isdir(voldir):
        for v in sorted(os.listdir(voldir)):
            p = os.path.join(voldir, v, "_data")
            if not os.path.isdir(p):
                continue
            if os.path.isdir(os.path.join(p, ".minio.sys")) or \
               os.path.isdir(os.path.join(p, "format.json")):
                candidates.append((v, p))
    if not candidates:
        for hit in find_named(oldroot, ".minio.sys", max_depth=8):
            candidates.append(("(found-by-scan)", os.path.dirname(hit)))

    for vol, datadir in candidates:
        info = {"volume": vol, "datadir": datadir}
        try:
            t, c, d, e = du_dir(datadir, max_entries=500000)
            info["total_size"] = human(t)
            info["files"] = c
        except Exception as ex:
            info["du_error"] = str(ex)

        fmt = os.path.join(datadir, "format.json")
        if os.path.exists(fmt):
            try:
                info["format_json"] = json.load(open(fmt))
            except Exception as ex:
                info["format_json_error"] = str(ex)

        # bucket 列表（顶层目录，排除 .minio.sys）
        try:
            buckets = []
            for e in os.listdir(datadir):
                if e.startswith("."):
                    continue
                bp = os.path.join(datadir, e)
                if os.path.isdir(bp):
                    nobj = 0
                    try:
                        for _r, _d, _f in os.walk(bp):
                            nobj += len(_f)
                    except OSError:
                        pass
                    buckets.append({"name": e, "files": nobj})
            info["buckets"] = buckets
        except OSError as ex:
            info["list_error"] = str(ex)

        # xl.meta 样本 —— 判断格式版本
        samples = []
        for root_d, _dirs, files in os.walk(datadir):
            for fn in files:
                if fn == "xl.meta":
                    samples.append(os.path.join(root_d, fn))
                    if len(samples) >= 3:
                        break
            if len(samples) >= 3:
                break
        xl = []
        for sp in samples:
            try:
                with open(sp, "rb") as f:
                    head = f.read(64)
                entry = {"path": sp, "size": os.path.getsize(sp), "head_hex": head[:32].hex()}
                # xl.meta v2: 头部 4 字节 xlMetaVersion(1) + 2 字节 headerLen
                if len(head) >= 6:
                    entry["xl_meta_version"] = head[0]
                    entry["header_len"] = struct.unpack_from("<H", head, 4)[0]
                # 尝试 msgpack 解 v1/v2 的 header
                try:
                    import msgpack  # type: ignore
                    entry["msgpack_available"] = True
                except ImportError:
                    entry["msgpack_available"] = False
                xl.append(entry)
            except OSError as ex:
                xl.append({"path": sp, "error": str(ex)})
        info["xl_meta_samples"] = xl

        # .minio.sys 内部结构
        sysdir = os.path.join(datadir, ".minio.sys")
        if os.path.isdir(sysdir):
            sub = {}
            for e in sorted(os.listdir(sysdir)):
                sp = os.path.join(sysdir, e)
                if os.path.isdir(sp):
                    t, c, d, _ = du_dir(sp, max_entries=100000)
                    sub[e] = {"size": human(t), "files": c}
                else:
                    sub[e] = {"file": True, "size": os.path.getsize(sp)}
            info["minio_sys"] = sub
        out["found"].append(info)
    return out


def probe_configs(oldroot):
    """在旧盘里找 SSE 的文件配置（ai-config.json 等）。"""
    out = {"found": []}
    targets = ["ai-config.json", "ai-test-history.json", ".env"]
    # 只在 docker volumes 与 home 目录范围找，避免全盘扫描
    search_roots = [
        os.path.join(oldroot, "var/lib/docker/volumes"),
        os.path.join(oldroot, "home"),
        os.path.join(oldroot, "root"),
        os.path.join(oldroot, "srv"),
        os.path.join(oldroot, "opt"),
    ]
    for sr in search_roots:
        if not os.path.isdir(sr):
            continue
        for target in targets:
            for hit in find_named(sr, target, max_depth=7):
                try:
                    st = os.stat(hit)
                    out["found"].append({
                        "path": hit,
                        "size": st.st_size,
                        "mtime": datetime.fromtimestamp(st.st_mtime, tz=timezone.utc).isoformat(),
                    })
                except OSError:
                    pass
    return out


def probe_docker_layout(oldroot):
    """Docker 根目录整体结构，用于定位 SSE 项目源码/挂载点。"""
    out = {}
    docker_root = os.path.join(oldroot, "var/lib/docker")
    if not os.path.isdir(docker_root):
        return {"error": "没有 /var/lib/docker"}
    for sub in sorted(os.listdir(docker_root)):
        sp = os.path.join(docker_root, sub)
        if os.path.isdir(sp):
            try:
                n = len(os.listdir(sp))
            except OSError:
                n = -1
            out[sub] = n
    # volumes 明细
    voldir = os.path.join(docker_root, "volumes")
    if os.path.isdir(voldir):
        vols = {}
        for v in sorted(os.listdir(voldir)):
            _d, _f = os.path.join(voldir, v), os.path.join(voldir, v, "_data")
            if os.path.isdir(_d):
                entry = {"has_data": os.path.isdir(_f)}
                # 猜用途
                if os.path.isdir(_f):
                    names = set(os.listdir(_f)[:50])
                    if "PG_VERSION" in names:
                        entry["guess"] = "postgresql"
                    elif ".minio.sys" in names or "format.json" in names:
                        entry["guess"] = "minio"
                    else:
                        entry["guess"] = "other"
                    entry["sample_entries"] = sorted(names)[:12]
                vols[v] = entry
        out["volumes"] = vols
    # containers 的 compose 项目线索
    cdir = os.path.join(docker_root, "containers")
    if os.path.isdir(cdir):
        cfgs = []
        for c in os.listdir(cdir):
            cfg = os.path.join(cdir, c, "config.v2.json")
            if os.path.exists(cfg):
                try:
                    d = json.load(open(cfg))
                    name = (d.get("Name") or "").lstrip("/")
                    env = [e for e in (d.get("Config", {}).get("Env") or [])
                           if any(k in e for k in ("POSTGRES", "MINIO", "SSE", "DATABASE"))]
                    mounts = []
                    for m in (d.get("MountPoints") or {}):
                        mounts.append(m)
                    cfgs.append({"container": c[:12], "name": name,
                                 "env_hints": env, "mounts": mounts})
                except Exception:
                    pass
        out["containers"] = cfgs
    return out


def main():
    oldroot = sys.argv[1] if len(sys.argv) > 1 else "/oldroot"
    if not os.path.isdir(oldroot):
        print(f"❌ {oldroot} 不是目录")
        return 1
    print(f"探查 {oldroot} （只读，不做任何写操作）")
    report = {
        "oldroot": oldroot,
        "scanned_at": datetime.now(timezone.utc).isoformat(),
        "docker": probe_docker_layout(oldroot),
        "postgres": probe_postgres(oldroot),
        "minio": probe_minio(oldroot),
        "configs": probe_configs(oldroot),
    }
    out = json.dumps(report, ensure_ascii=False, indent=2)
    print(out)
    # 报告写到 stdout，不在 oldroot 下落盘
    return 0


if __name__ == "__main__":
    sys.exit(main())
