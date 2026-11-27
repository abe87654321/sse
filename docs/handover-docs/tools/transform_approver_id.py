#!/usr/bin/env python3
"""
旧盘 → 新系统 的显式语义转换
==============================

旧盘的【实际数据库】与它自己的 migration 文件存在漂移：migration 说
approval_records.approver_id 是 UUID REFERENCES users(id)，但线上真实列类型是
`character varying(50)`，里面存的是【角色名】（'admin' / 'finance'）。

旧版应用代码也印证了这一点（packages/api/src/routes/expenses.ts:233）：
    records.find((r) => r.result === PENDING && r.approverId === role)
即 approverId 与 role 比较，而不是与 user id 比较。

当前 SSE 的 migration 已经把该列改回 UUID REFERENCES users(id)，所以直接导入
会报 "invalid input syntax for type uuid: 'finance'"。

本脚本按【角色 → 用户】把旧值映射成新 schema 需要的 uuid，并把映射关系
完整写进报告（可审计），而不是静默丢弃或静默改写。

规则：
  1. 若目标列是 uuid，且源值是合法 uuid → 原样保留
  2. 若目标列是 uuid，源值不是 uuid：
       - 在 users 表里按 role 匹配（同名角色若唯一 → 取该用户 id）
       - 角色不唯一或找不到 → 记为 unresolved，导入时置 NULL 并在报告里列出
  3. 若目标列不是 uuid → 原样保留

用法:
    python3 transform_approver_id.py <包目录>
包目录需含 pg/table_approval_records.sql 与 pg/table_users.sql
"""
import csv
import json
import os
import re
import sys

UU = re.compile(r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-"
                r"[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$")


def parse_users(pkg):
    """从包里提取 role → [user_id] 映射（用于交叉校验）。"""
    f = os.path.join(pkg, "pg", "table_users.sql")
    roles = {}
    if not os.path.exists(f):
        return roles
    for line in open(f, encoding="utf-8"):
        m = re.match(
            r'^INSERT INTO public\.users \((.*?)\) VALUES \((.*)\);$',
            line.strip(), re.S)
        if not m:
            continue
        cols = [c.strip().strip('"') for c in m.group(1).split(",")]
        vals = split_values(m.group(2))
        row = dict(zip(cols, vals))
        uid = unquote_literal(row.get("id", ""))
        role = unquote_literal(row.get("role", ""))
        if uid and role:
            roles.setdefault(role, []).append(uid)
    return roles


def parse_rule_assignees(pkg):
    """
    从 approval_rules.approval_chain 里提取 role → assigneeId 映射。

    ★ 这是最权威的映射来源：审批链在创建时就把【角色】绑定到了【具体审批人】，
    例如：
        {"role": "admin",   "step": 1, "assigneeId": "3e856835-...", "assigneeName": "系统管理员"}
        {"role": "finance", "step": 2, "assigneeId": "a7e2c5f4-...", "assigneeName": "王钰"}
    比"按 users.role 反查"更准确 —— 因为 admin 角色有多个用户，
    但审批链里指定了实际审批的那个人。
    """
    f = os.path.join(pkg, "pg", "table_approval_rules.sql")
    mapping = {}
    if not os.path.exists(f):
        return mapping
    for line in open(f, encoding="utf-8"):
        m = re.match(
            r'^INSERT INTO public\.approval_rules \((.*?)\) VALUES \((.*)\);$',
            line.strip(), re.S)
        if not m:
            continue
        cols = [c.strip().strip('"') for c in m.group(1).split(",")]
        vals = split_values(m.group(2))
        row = dict(zip(cols, vals))
        chain = unquote_literal(row.get("approval_chain", ""))
        if not chain or chain == "NULL" or chain == "":
            continue
        try:
            steps = json.loads(chain)
        except Exception:
            continue
        if not isinstance(steps, list):
            continue
        for st in steps:
            if not isinstance(st, dict):
                continue
            role = st.get("role")
            aid = st.get("assigneeId")
            if role and aid and UU.match(aid):
                # 一个角色在不同规则里可能指向不同人 → 记成集合，交给调用方消歧
                mapping.setdefault(role, []).append(aid)
    return mapping


def unquote_literal(tok):
    """
    把一个 SQL 字符串字面量还原成原始值。

    SQL 里 '...' 内的单引号写成 ''，所以：
        '[{"role": "admin"}]'  →  [{"role": "admin"}]
        'it''s'                →  it's
    非字符串（NULL / 数字 / 布尔）原样返回。
    """
    t = tok.strip()
    # 可能是 E'...'（转义字符串）形式 —— builder 统一用 E'' 输出
    if len(t) >= 3 and t[0] in ("E", "e") and t[1] == "'" and t[-1] == "'":
        inner = t[2:-1]
        inner = inner.replace("''", "'")
        # E'' 形式下 \n \r \t \\ 是转义序列
        inner = (inner.replace("\\\\", "\x00")
                      .replace("\\n", "\n").replace("\\r", "\r").replace("\\t", "\t")
                      .replace("\x00", "\\"))
        return inner
    if len(t) >= 2 and t[0] == "'" and t[-1] == "'":
        inner = t[1:-1]
        return inner.replace("''", "'")
    return t


def split_values(raw):
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
    return vals


def transform(pkg):
    roles = parse_users(pkg)
    chain_map = parse_rule_assignees(pkg)
    f = os.path.join(pkg, "pg", "table_approval_records.sql")
    if not os.path.exists(f):
        print("  （无 approval_records 表，跳过）")
        return {"applied": False}

    lines = open(f, encoding="utf-8").read().split("\n")
    out = []
    mapping = {}
    mapping_source = {}
    unresolved = []

    for line in lines:
        m = re.match(
            r'^INSERT INTO public\.approval_records \((.*?)\) VALUES \((.*)\);$',
            line.strip(), re.S)
        if not m:
            out.append(line)
            continue
        cols = [c.strip().strip('"') for c in m.group(1).split(",")]
        vals = split_values(m.group(2))
        if "approver_id" not in cols:
            out.append(line)
            continue
        idx = cols.index("approver_id")
        raw = vals[idx]
        if raw in ("NULL", ""):
            out.append(line)
            continue
        # ★ 去掉 E'' 前缀与引号，取真实值
        val = unquote_literal(raw)
        if UU.match(val):
            out.append(line)
            continue
        # 角色名 → 用户 id
        # 优先用 approval_chain 里的 assigneeId（权威：审批链指定了实际审批人）
        chain_cands = sorted(set(chain_map.get(val, [])))
        if len(chain_cands) == 1:
            vals[idx] = f"'{chain_cands[0]}'"
            mapping[val] = chain_cands[0]
            mapping_source[val] = "approval_rules.approval_chain.assigneeId"
            out.append(
                f"INSERT INTO public.approval_records ({m.group(1)}) VALUES "
                f"({', '.join(vals)});")
            continue
        elif len(chain_cands) > 1:
            # 审批链里同一角色指向多个人 —— 只能退回到按 users.role 消歧
            candidates = roles.get(val, [])
        else:
            candidates = roles.get(val, [])
        if len(candidates) == 1:
            vals[idx] = f"'{candidates[0]}'"
            mapping[val] = candidates[0]
            mapping_source[val] = "users.role (唯一匹配)"
        elif len(candidates) > 1:
            unresolved.append({
                "role": val,
                "reason": "该角色对应多个用户，无法确定唯一 approver",
                "candidates": candidates,
            })
            vals[idx] = "NULL"
        else:
            unresolved.append({
                "role": val,
                "reason": "users 表中找不到该角色",
                "candidates": [],
            })
            vals[idx] = "NULL"
        out.append(
            f"INSERT INTO public.approval_records ({m.group(1)}) VALUES "
            f"({', '.join(vals)});")

    open(f, "w", encoding="utf-8").write("\n".join(out))

    report = {
        "applied": True,
        "column": "approval_records.approver_id",
        "reason": "旧盘实际列为 character varying(50)（存角色名），"
                  "当前 SSE migration 已改为 uuid REFERENCES users(id)",
        "role_to_user": mapping,
        "mapping_source": mapping_source,
        "unresolved": unresolved,
    }
    rp = os.path.join(pkg, "meta", "semantic_transform.json")
    with open(rp, "w", encoding="utf-8") as fh:
        json.dump(report, fh, ensure_ascii=False, indent=2)

    if mapping:
        print(f"  ✅ approver_id 角色→用户 映射 {len(mapping)} 条: "
              + ", ".join(f"{k}→{v[:8]}" for k, v in mapping.items()))
    if unresolved:
        print(f"  ⚠️  无法解析的 approver_id {len(unresolved)} 条（置为 NULL，已记录）")
        for u in unresolved:
            print(f"      {u['role']}: {u['reason']}")
    return report


if __name__ == "__main__":
    pkg = sys.argv[1]
    transform(pkg)
