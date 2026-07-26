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

`GET /user/search`：`q` 参数改为可选

| q | 行为 | limit |
|---|------|-------|
| 空/未传 | 返回全部活跃用户 | 50 |
| 有值 | 按姓名或手机号模糊匹配 | 20 |

```sql
-- q 为空
SELECT id, name, phone, department, role
FROM users WHERE status = 'active' ORDER BY name LIMIT 50

-- q 不为空
SELECT id, name, phone, department, role
FROM users
WHERE status = 'active' AND (name ILIKE '%xxx%' OR phone ILIKE '%xxx%')
ORDER BY name LIMIT 20
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
| `packages/api/src/routes/user.ts` | 修改：`/search` q 改为可选 |
| `packages/web/src/pages/AdminMessages.vue` | 修改：替换内联搜索为 UserPicker |

---

> 设计已确认，进入执行。
