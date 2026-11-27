#!/usr/bin/env python3
"""
按目标库实际列结构过滤 INSERT 语句
=====================================

用途：旧盘数据的表结构可能比当前 migration 领先或滞后
（实测：旧盘 expense_reports 有 description 列，当前 migration 已删除）。

处理规则：
  1. 目标库没有的列 → 从 INSERT 里剔除（并在报告里列出被丢弃的列）
  2. 目标库有、但源数据没有的列 → 补 DEFAULT（如果有默认值）或 NULL
  3. 目标库里 NOT NULL 且无默认值的缺失列 → 报错（不能静默丢数据）

用法：
    python3 filter_insert_columns.py <sql文件> <目标库信息JSON> <报告输出>
"""
import json
import re
import sys


def parse_insert(stmt):
    """
    解析 INSERT INTO public.<table> (col1, col2, ...) VALUES (v1, v2, ...);
    返回 (table, cols, values, 其余部分)
    """
    m = re.match(
        r"^INSERT INTO public\.(\w+)\s*\((.*?)\)\s*VALUES\s*\((.*)\);\s*$",
        stmt.strip(), re.S)
    if not m:
        return None
    table = m.group(1)
    cols = [c.strip().strip('"') for c in m.group(2).split(",")]

    # 拆 values：需要处理括号和引号
    raw = m.group(3)
    vals = []
    depth = 0
    in_str = False
    cur = ""
    i = 0
    while i < len(raw):
        c = raw[i]
        if in_str:
            cur += c
            if c == "'":
                # 检查是否是转义的 ''
                if i + 1 < len(raw) and raw[i + 1] == "'":
                    cur += raw[i + 1]
                    i += 2
                    continue
                in_str = False
            i += 1
            continue
        if c == "'":
            in_str = True
            cur += c
        elif c == "(":
            depth += 1
            cur += c
        elif c == ")":
            depth -= 1
            cur += c
        elif c == "," and depth == 0:
            vals.append(cur.strip())
            cur = ""
        else:
            cur += c
        i += 1
    if cur.strip():
        vals.append(cur.strip())
    return table, cols, vals


def main():
    sql_path, meta_path, report_path = sys.argv[1], sys.argv[2], sys.argv[3]

    meta = json.load(open(meta_path, encoding="utf-8"))
    # {table: {"cols": {name: {"notnull":bool, "default":str|None}}, "order":[...]}}
    tables = meta["tables"]

    src = open(sql_path, encoding="utf-8").read()
    lines = src.split("\n")

    out_lines = []
    dropped_cols = {}
    missing_cols = {}
    errors = []

    for line in lines:
        st = line.strip()
        if not st.startswith("INSERT INTO public."):
            out_lines.append(line)
            continue
        parsed = parse_insert(st)
        if parsed is None:
            out_lines.append(line)
            continue
        table, cols, vals = parsed
        if len(cols) != len(vals):
            # 解析失败，原样保留（后面 psql 会报错，比静默出错好）
            out_lines.append(line)
            continue

        tinfo = tables.get(table)
        if tinfo is None:
            out_lines.append(line)
            continue

        tcols = tinfo["cols"]

        # 1. 剔除目标库没有的列
        keep_idx = []
        drop = []
        for i, c in enumerate(cols):
            if c in tcols:
                keep_idx.append(i)
            else:
                drop.append(c)
        if drop:
            dropped_cols.setdefault(table, set()).update(drop)

        # 2. 找出目标库有、源数据没有的列
        src_set = set(cols)
        need = []
        for c, ci in tcols.items():
            if c not in src_set:
                need.append((c, ci))

        if not need:
            new_cols = [cols[i] for i in keep_idx]
            new_vals = [vals[i] for i in keep_idx]
            out_lines.append(
                f"INSERT INTO public.{table} ({', '.join(chr(34)+c+chr(34) for c in new_cols)}) "
                f"VALUES ({', '.join(new_vals)});")
            continue

        # 3. 缺失列：优先用默认值，其次 NULL；NOT NULL 且无默认值 → 报错
        hard_fail = False
        for c, ci in need:
            if ci.get("notnull") and not ci.get("default"):
                errors.append(
                    f"表 {table} 缺少必填列 {c}（目标库 NOT NULL 且无默认值），"
                    f"无法安全导入")
                hard_fail = True
        if hard_fail:
            out_lines.append(line)
            continue

        missing_cols.setdefault(table, set()).update(c for c, _ in need)

        new_cols = [cols[i] for i in keep_idx]
        new_vals = [vals[i] for i in keep_idx]
        # 按目标库的列顺序重排，缺失列插到正确位置
        result_cols = []
        result_vals = []
        vi = 0
        for c, ci in tcols.items():
            if c in src_set:
                idx = cols.index(c)
                result_cols.append(c)
                result_vals.append(vals[idx])
            else:
                result_cols.append(c)
                result_vals.append(ci.get("default") if ci.get("default") else "NULL")

        out_lines.append(
            f"INSERT INTO public.{table} ({', '.join(chr(34)+c+chr(34) for c in result_cols)}) "
            f"VALUES ({', '.join(result_vals)});")

    open(sql_path, "w", encoding="utf-8").write("\n".join(out_lines))

    report = {
        "dropped_columns": {k: sorted(v) for k, v in dropped_cols.items()},
        "filled_columns": {k: sorted(v) for k, v in missing_cols.items()},
        "errors": errors,
    }
    with open(report_path, "w", encoding="utf-8") as f:
        json.dump(report, f, ensure_ascii=False, indent=2)

    if dropped_cols:
        print(f"  ⚠️  目标库缺失的列已剔除: "
              + ", ".join(f"{t}.{','.join(sorted(c))}" for t, c in dropped_cols.items()))
    if missing_cols:
        print(f"  ⚠️  源数据缺失的列已按默认值填充: "
              + ", ".join(f"{t}.{','.join(sorted(c))}" for t, c in missing_cols.items()))
    if errors:
        for e in errors:
            print(f"  ❌ {e}")
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())
