#!/usr/bin/env python3
"""
MinIO xl.meta v2 离线解析器
============================

用途：在【不启动 MinIO 服务、不加载 MinIO 库】的前提下，直接从磁盘上的
xl.meta 文件读出对象的元数据与内容。

格式（已用真实 MinIO RELEASE.2025-08/09 生成的样本逐字节校准）：

    xl.meta 文件 = "XL2 " (4B) + version(1B) + flags(1B) + reserved(2B)
                 + msgpack(元数据)  +  msgpack(内联数据)

  * 元数据段解出来是 4 个顶层对象：
      [0] bytes  -> 又是嵌套 msgpack（对象名 + stat）
      [1] int    -> MTime（Unix 纳秒）
      [2] int    -> 版本
      [3] dict   -> {"null": bytes}  内联数据（小对象）或 {"xl.json": ...}
  * obj[0] 的嵌套结构：
      [0..2] int   -> 版本号
      [3]   bytes -> 嵌套 msgpack -> [ID, DDir, ...]
      [4]   bytes -> 嵌套 msgpack -> {"Type":1, "V2Obj":{...完整 stat...}}
  * stat.V2Obj 关键字段：
      Size      对象字节数
      MTime     修改时间（Unix 纳秒）
      MetaSys   系统元数据；{"x-minio-internal-inline-data": "true"} 表示内容内联
      MetaUsr   用户元数据（etag / content-type 等）

  * 内联数据 blob 的布局： [32 字节 header][payload]
      32 = 16 字节 CRC32C + 16 字节内容 SHA-256 前半（MinIO 内部格式）
      ⇒ header_len = len(blob) - Size   （用 Size 结构化推导，不靠猜）

只读保证：本模块只以 'rb' 打开文件，从不写入。

依赖：msgpack（pip install msgpack）
"""

import hashlib
import os
import struct
import sys

try:
    import msgpack
except ImportError:  # pragma: no cover
    sys.stderr.write("需要 msgpack: pip install msgpack\n")
    raise

XL2_MAGIC = b"XL2 "
INLINE_HEADER_LEN = 32


class XlMetaError(Exception):
    pass


def _unpack_all(data):
    """用 Unpacker 解 msgpack —— 容忍尾部 padding（unpackb 会报错）。"""
    u = msgpack.Unpacker(raw=False, strict_map_key=False)
    u.feed(data)
    return list(u)


def _decode_nested(blob):
    """解嵌套 msgpack bytes，返回对象列表。"""
    return _unpack_all(bytes(blob))


def _extract_stat(objs):
    """
    从一组 msgpack 对象里找出 stat（形如 {"Type":1,"V2Obj":{...}}）。

    stat 可能直接是其中一项，也可能被包在 bytes 里再嵌套一层 msgpack。
    """
    def scan(items, depth=0):
        if depth > 3:
            return None
        for o in items:
            if isinstance(o, dict) and "V2Obj" in o:
                return o
            if isinstance(o, (bytes, bytearray)):
                try:
                    nested = _unpack_all(bytes(o))
                except Exception:
                    continue
                r = scan(nested, depth + 1)
                if r:
                    return r
            elif isinstance(o, (list, tuple)):
                r = scan(list(o), depth + 1)
                if r:
                    return r
        return None
    return scan(objs)


def parse_xlmeta(path):
    """
    解析一个 xl.meta 文件。

    返回 dict：
      {
        "path": ..., "format": "xl.meta v2", "size": ...,
        "mtime": <Unix 纳秒>, "version": ...,
        "object_name": "<目录名>",        # 由调用方从路径推导时覆盖
        "size": <对象字节数>,
        "etag": ..., "content_type": ...,
        "inline": True/False,
        "payload": bytes or None,
        "meta": {...V2Obj 原始内容...},
      }
    解析失败抛 XlMetaError。
    """
    with open(path, "rb") as f:
        data = f.read()

    if len(data) < 8:
        raise XlMetaError(f"{path}: 文件过小 ({len(data)}B)")
    if data[:4] != XL2_MAGIC:
        raise XlMetaError(f"{path}: 不是 xl.meta v2 (magic={data[:4]!r})")

    res = {
        "path": path,
        "format": "xl.meta v2",
        "file_size": len(data),
        "xl_version": data[4],
        "flags": data[5],
    }

    # ---- 元数据段 ----
    # 两种布局（已用真实大/小对象校准）：
    #   小对象（内容内联）: offset 8 → [name_blob, mtime, ver, {null: data}]
    #   大对象（内容在 part.N）: offset 4 → [ver, flags, ?, ?, stat_blob, mtime]
    # 统一做法：扫描两种 offset，取出能解出 stat 的那一组。
    stat = {}
    objs = []
    used_off = None
    for off in (4, 8):
        try:
            cand = _unpack_all(data[off:])
        except Exception:
            continue
        if not cand:
            continue
        s = _extract_stat(cand)
        if s:
            stat = s
            objs = cand
            used_off = off
            break

    if not stat:
        raise XlMetaError(f"{path}: 无法解析出 stat 结构")

    res["meta_offset"] = used_off
    res["mtime"] = objs[-1] if len(objs) > 1 else None
    res["version"] = objs[0] if used_off == 4 else (objs[2] if len(objs) > 2 else None)

    res["meta"] = stat
    v2 = stat.get("V2Obj", {}) if isinstance(stat, dict) else {}
    res["object_type"] = stat.get("Type") if isinstance(stat, dict) else None

    size = v2.get("Size")
    res["size"] = size
    res["mtime_ns"] = v2.get("MTime", res.get("mtime"))

    meta_usr = v2.get("MetaUsr") or {}
    meta_sys = v2.get("MetaSys") or {}

    def _s(v):
        if isinstance(v, (bytes, bytearray)):
            return bytes(v).decode("utf-8", "replace")
        return v

    # DDir 是分片目录名 —— 16 字节二进制 UUID，需转成标准 UUID 字符串
    # （目录名形如 0ac8cd68-5456-4479-a91d-ffdac10adb97）
    ddir = v2.get("DDir")
    if isinstance(ddir, (bytes, bytearray)):
        b = bytes(ddir)
        if len(b) == 16:
            h = b.hex()
            ddir = f"{h[0:8]}-{h[8:12]}-{h[12:16]}-{h[16:20]}-{h[20:32]}"
        else:
            ddir = b.hex()
    res["ddir"] = ddir

    res["etag"] = _s(meta_usr.get("etag"))
    res["content_type"] = _s(meta_usr.get("content-type"))
    res["meta_user"] = {k: _s(v) for k, v in meta_usr.items()}
    res["meta_system"] = {k: _s(v) for k, v in meta_sys.items()}
    res["inline"] = str(_s(meta_sys.get("x-minio-internal-inline-data", ""))).lower() == "true"

    # ---- 内联数据 ----
    # 小对象布局里，内联数据在 {"null": bytes} 这个 dict 中；
    # 大对象布局没有这个 dict。
    inline_map = None
    for o in objs:
        if isinstance(o, dict) and "null" in o:
            inline_map = o
            break
    blob = inline_map.get("null") if isinstance(inline_map, dict) else None

    if res["inline"] and isinstance(blob, (bytes, bytearray)):
        blob = bytes(blob)
        if size is None:
            raise XlMetaError(f"{path}: 内联数据但缺少 Size 字段，无法确定 payload 边界")
        hdr = len(blob) - size
        if hdr < 0:
            raise XlMetaError(f"{path}: blob({len(blob)}) 小于 Size({size})")
        res["inline_blob_len"] = len(blob)
        res["inline_header_len"] = hdr
        res["inline_header_hex"] = blob[:hdr].hex()
        res["payload"] = blob[hdr:]
        res["payload_sha256"] = hashlib.sha256(res["payload"]).hexdigest()
    else:
        # 大对象：内容在 part.N 文件里，xl.meta 只存元数据
        res["payload"] = None
        res["inline_blob_len"] = len(blob) if isinstance(blob, (bytes, bytearray)) else 0

    return res


def parse_xlmeta_safe(path):
    """parse_xlmeta 的安全包装：失败时返回 {"error": ...} 而不抛异常。"""
    try:
        return parse_xlmeta(path)
    except Exception as e:
        return {"path": path, "error": f"{type(e).__name__}: {e}"}


if __name__ == "__main__":
    import json

    for p in sys.argv[1:]:
        r = parse_xlmeta_safe(p)
        out = dict(r)
        if "payload" in out and out["payload"] is not None:
            out["payload"] = f"<{len(out['payload'])} bytes>"
        print(json.dumps(out, ensure_ascii=False, indent=2, default=str))
