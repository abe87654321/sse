import json
import sys

import msgpack

# MinIO xl.meta v2 布局（已用真实 MinIO 生成的样本校准）：
#   offset 0:  "XL2 "              (4 bytes magic)
#   offset 4:  version = 1        (uint8)   -> 即 xl.meta v2 格式的 version 字段
#   offset 5:  flags               (uint8)
#   offset 6:  reserved            (2 bytes)
#   offset 8:  msgpack MetaEntries (数组)
# MetaEntries 中每项是数组：[key, value, ...]，key 是字符串如 "msg"，
# value 视 key 而定。"meta" 这个 key 下是对象名与 stat 信息。

XL2_MAGIC = b"XL2 "


def parse_xlmeta(path):
    data = open(path, "rb").read()
    res = {"size": len(data), "head": data[:24].hex()}
    if data[:4] != XL2_MAGIC:
        res["format"] = "unknown"
        return res
    res["format"] = "xl.meta v2"
    res["xl_version"] = data[4]
    res["flags"] = data[5]

    # 从 offset 8 开始解 msgpack；用 Unpacker 容忍尾部 padding
    unpacker = msgpack.Unpacker(raw=False, strict_map_key=False)
    unpacker.feed(data[8:])
    try:
        entries = next(iter(unpacker))
    except Exception as e:
        res["error"] = f"msgpack 解析失败: {e}"
        return res

    res["entries_count"] = len(entries) if isinstance(entries, (list, tuple)) else None
    # 归一化：把 MetaEntries 数组转成 dict
    norm = {}
    raw_list = []
    if isinstance(entries, (list, tuple)):
        for item in entries:
            if isinstance(item, (list, tuple)) and len(item) >= 2:
                k = item[0]
                v = item[1]
                if isinstance(k, bytes):
                    k = k.decode("utf-8", "replace")
                raw_list.append([k, v])
                norm[k] = v
    res["keys"] = list(norm.keys())
    res["normalized"] = norm
    return res


def brief(v, depth=0):
    """把 stat 里的 bytes 字段转成人类可读。"""
    if isinstance(v, dict):
        out = {}
        for k, val in v.items():
            if k == "Payload" or k == "payload":
                out[k] = "<...>"
            elif isinstance(val, bytes):
                out[k] = val[:60].decode("utf-8", "replace") + ("..." if len(val) > 60 else "")
            else:
                out[k] = brief(val, depth+1)
        return out
    if isinstance(v, (list, tuple)):
        return [brief(x, depth+1) for x in v]
    if isinstance(v, bytes):
        return v[:80].decode("utf-8", "replace")
    return v


for f in sys.argv[1:]:
    r = parse_xlmeta(f)
    print("=" * 70)
    print(f)
    print("format:", r.get("format"), "xl_version:", r.get("xl_version"),
          "entries:", r.get("entries_count"), "size:", r.get("size"))
    if "error" in r:
        print("ERROR:", r["error"])
        continue
    for k, v in (r.get("normalized") or {}).items():
        print(f"\n  [{k}]")
        print("   ", json.dumps(brief(v), ensure_ascii=False, default=str)[:900])
