# SSE 人员删除功能 — 需求设计文档

> 日期：2026-07-28 | 版本：v1.0 | 状态：待评审

---

## 1. 概述

当前用户管理模块仅支持 `status='disabled'` 软禁用，无删除机制。新增三种删除方式，覆盖录入纠错、员工离职隐藏、彻底清档三场景。

---

## 2. 三种删除策略

| 类型 | 触发条件 | 操作 | 数据校验 | 可逆 |
|------|---------|------|---------|------|
| **硬删除** | 用户无任何关联业务数据 | `DELETE FROM users WHERE id = $1` | 检查无 expense_reports / approval_records / notification_logs 关联行；若有关联则拦截并提示改用软删除 | 否 |
| **软删除** | 用户有关联数据，需从系统中隐藏 | `UPDATE users SET status='deleted', deleted_at=NOW() WHERE id = $1` | 无前置校验 | 否（区别于 `status=disabled` 可切换回 `active`） |
| **级联硬删除** | 彻底清除用户及所有衍生数据 | 级联删除 users + expense_reports + expense_items + invoices + approval_records + notification_logs + identity_mappings | 二次确认弹窗，输入用户名确认 | 否 |

---

## 3. 数据模型变更

### 3.1 `users` 表新增字段

| 字段 | 类型 | 说明 |
|------|------|------|
| `deleted_at` | TIMESTAMPTZ | 软删除时间戳，null=未删除 |

### 3.2 `status` 枚举值扩展

当前：`active` / `disabled`

扩展为：`active` / `disabled` / `deleted`

| 值 | 含义 | 是否可登录 | 是否出现在用户列表 | 是否在 UserPicker 中显示 |
|---|---|---|---|---|
| `active` | 正常 | 是 | 是 | 是 |
| `disabled` | 临时停用 | 否 | 是（管理员可见） | 否（仅 active 用户） |
| `deleted` | 已删除（软删除） | 否 | 否（需切到"已删除"标签页才可见） | 否 |

---

## 4. 软删除后的数据展示

用户在以下场景中的关联数据显示为已删除状态：

| 场景 | 展示方式 |
|------|---------|
| 报销单申请人（`expense_reports.user_id`） | 显示为"已删除用户(原姓名)" |
| 审批记录审批人（`approval_records.approver_id`） | 显示为"已删除用户(原姓名)" |
| 通知日志接收人（`notification_logs.recipient_id`） | 保留发送历史，显示为"已删除用户(原姓名)" |
| 审批记录通过角色匹配（`approverId = 'dept_approver'`） | 软删除用户不计入该部门角色列表 |

---

## 5. API 设计

### 5.1 后端路由（`packages/api/src/routes/admin.ts`）

新增两个端点，修改现有 PUT/DELETE：

| 方法 | 路径 | 说明 |
|------|------|------|
| `PUT` | `/admin/users/:id` | 修改现有：增加 `status` 校验，禁止将 `deleted` 用户状态改回 `active` |
| `DELETE` | `/admin/users/:id?type=hard` | 硬删除（仅无关联数据时） |
| `DELETE` | `/admin/users/:id?type=soft` | 软删除（设置 status=deleted + deleted_at） |
| `DELETE` | `/admin/users/:id?type=cascade` | 级联硬删除（需二次确认） |
| `GET` | `/admin/users?include=deleted` | 现有列表增加可选参数，查询已删除用户 |

### 5.2 校验逻辑

**硬删除前置检查（SQL）**：

```sql
SELECT
  (SELECT COUNT(*) FROM expense_reports WHERE user_id = $1) +
  (SELECT COUNT(*) FROM approval_records WHERE approver_id = $1) +
  (SELECT COUNT(*) FROM notification_logs WHERE recipient_id = $1) +
  (SELECT COUNT(*) FROM notification_logs WHERE sender_id = $1) +
  (SELECT COUNT(*) FROM system_messages WHERE sender_id = $1) +
  (SELECT COUNT(*) FROM identity_mappings WHERE local_user_id = $1)
AS related_count
```

`related_count > 0` → 返回 409 Conflict，提示存在业务数据。

**级联硬删除二次确认**：前端弹窗输入用户名全称，匹配通过后方可提交。

### 5.3 响应格式

硬删除成功：
```json
{ "message": "用户已永久删除" }
```

软删除成功：
```json
{ "message": "用户已删除", "deleted_at": "2026-07-28T10:00:00Z" }
```

硬删除被拦截：
```json
{ "error": { "code": "HAS_RELATED_DATA", "message": "该用户存在 3 条业务数据（报销单/审批记录/通知日志），请使用软删除或级联删除" } }
```

---

## 6. 前端交互（`AdminUsers.vue`）

### 6.1 删除按钮下拉菜单

当前每行的删除按钮改为下拉菜单（或弹出选择对话框）：

```
[删除 ▼]
  ├─ 硬删除（无业务数据时可用）
  ├─ 软删除（员工离职/失效）
  └─ 级联删除（彻底清除所有数据）
```

- **硬删除**：若有关联数据则灰显禁用，hover 提示原因
- **软删除**：始终可用，点击后弹确认框
- **级联删除**：始终可用，点击后弹出二次确认（输入用户名）

### 6.2 用户列表新增标签页

```
[活跃]  [已禁用]  [已删除]
```

"已删除"标签页仅在 `include=deleted` 参数下显示，列出所有 `status='deleted'` 的用户及其 `deleted_at` 时间。

### 6.3 状态变更限制

- `status='deleted'` 的用户，状态开关不可操作
- 已删除用户行以灰色字体显示，操作列仅显示"已删除于 YYYY-MM-DD"

---

## 7. 文件变更清单

| 文件 | 变更类型 | 说明 |
|------|---------|------|
| `packages/db/src/migrations/005_user_deleted_at.sql` | 新建 | 新增 deleted_at 列 + status 约束 |
| `packages/core/src/ports/iuser-repo.ts` | 修改 | 新增 softDelete / hardDelete / cascadeDelete 接口 |
| `packages/db/src/repositories/pg-user-repo.ts` | 修改 | 实现三种删除方法 + 关联数据校验 + 支持查询已删除用户 |
| `packages/api/src/routes/admin.ts` | 修改 | 新增 DELETE type 参数处理，修改现有 PUT 校验 |
| `packages/web/src/pages/AdminUsers.vue` | 修改 | 删除按钮改为下拉菜单，新增已删除标签页 |
| `packages/web/src/api/api.ts` | 修改 | 新增 deleteUser 方法 |
| `packages/shared/src/types/user.ts` | 修改 | User 类型新增 deletedAt 字段 |

---

## 8. 不在本期范围

- 操作日志审计（谁在何时删除了哪个用户）
- 批量删除操作
- 软删除后的"恢复"功能

---

> 评审完成后进入实施阶段。
