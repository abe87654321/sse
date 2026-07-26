# UserPicker — 通用用户多选组件设计

> 日期：2026-07-26 | 版本：v1.0

---

## 1. 概述

抽取当前 `AdminMessages.vue` 中内联的用户搜索逻辑为独立的 `UserPicker.vue` 公共组件，供所有需要选择用户的页面复用（消息管理、审批规则指定审批人、未来任何需要选人的场景）。

---

## 2. 组件接口

**位置**：`packages/web/src/components/UserPicker.vue`

| Prop | 类型 | 默认 | 说明 |
|------|------|------|------|
| modelValue | `{id:string, name:string}[]` | `[]` | 已选用户列表（v-model） |
| placeholder | string | `"搜索用户..."` | 输入框占位文字 |

| Emit | 参数 | 说明 |
|------|------|------|
| update:modelValue | `{id:string, name:string}[]` | 选中变化时触发 |

---

## 3. 后端改动

`GET /user/search`：`q` 和 `role` 参数可选

| 参数 | 行为 | limit |
|------|------|-------|
| `role` 有值 | 返回指定角色的全部活跃用户 | 全部 |
| `q` 有值 | 按姓名或手机号模糊匹配 | 20 |
| 都无 | 返回全部活跃用户 | 50 |

```sql
-- role 指定
SELECT id, name, phone, department, role
FROM users WHERE status = 'active' AND role = $1 ORDER BY name

-- q 不为空
SELECT id, name, phone, department, role
FROM users
WHERE status = 'active' AND (name ILIKE '%xxx%' OR phone ILIKE '%xxx%')
ORDER BY name LIMIT 20

-- 都无
SELECT id, name, phone, department, role
FROM users WHERE status = 'active' ORDER BY name LIMIT 50
```

---

## 4. 交互设计

```
┌─ UserPicker ───────────────────────────────────────────┐
│  [张三 ×] [李四 ×] [│搜索用户...___________________]     │
│  ┌────────────────────────────────────────────────────┐ │
│  │ ☑ 王五 — 13800001111 · 技术部 / employee          │ │
│  │ ☐ 赵六 — 13800002222 · 财务部 / finance           │ │
│  │ ☐ 钱七 — 13800003333 · 销售部 / dept_approver     │ │
│  └────────────────────────────────────────────────────┘ │
└────────────────────────────────────────────────────────┘
```

1. **焦点进入**：下拉展示全部活跃用户（调 `/user/search` 无 q）
2. **输入文字**：300ms 防抖 → 调 `/user/search?q=xxx` → 更新下拉
3. **勾选/取消**：checkbox 切换，即时更新 v-model
4. **标签 ×**：从已选中移除
5. **点击外部**：关闭下拉（`blur` 事件或 `@click.outside`）
6. **键盘导航**：↑↓ 移动高亮，Enter 选中/取消高亮项

---

## 5. 文件变更

| 文件 | 变更 |
|------|------|
| `packages/web/src/components/UserPicker.vue` | 新建 |
| `packages/api/src/routes/user.ts` | 修改：`/search` 加 `q` 和 `role` 参数 |
| `packages/web/src/pages/AdminMessages.vue` | 修改：替换内联搜索为 UserPicker；角色-用户双向同步 |

---

## 6. 角色-用户双向同步

### 6.1 数据模型

唯一数据源是已选用户集合（UserPicker v-model）。role checkbox 是派生视图。

```
用户选中集合 ──(派生)──→ role checkbox 状态
role checkbox ──(写入)──→ 用户选中集合
```

### 6.2 同步规则

```
勾选"财务" → GET /user/search?role=finance → 加入已选集合
取消"财务" → 从集合移除所有 role=finance 的用户

UserPicker 勾选某用户 → 检查该用户的 role 是否所有成员都已选中
  是 → checkbox 自动勾
  否 → checkbox 不勾

UserPicker 移除某用户 → 同上反向检查
```

### 6.3 防循环

使用 `syncing` 标志位防止 `syncRoleToUsers` 和 `syncUsersToRoles` 互相触发死循环。

---

> 设计已确认，进入执行。
