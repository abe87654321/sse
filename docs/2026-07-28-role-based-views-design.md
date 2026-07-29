# SSE 报销详情页角色拆分 — 需求设计文档

> 日期：2026-07-28 | 版本：v1.0 | 状态：已确认

---

## 1. 概述

当前 `ExpenseDetail.vue` 被报销人和审批人共用，按钮逻辑仅按报表状态判断（如 `status === 'draft'` 显示编辑），不区分"谁在看"。导致审批管理页面进入时看到提交者专属按钮，角色混淆。

拆分为两个独立页面，权限由服务端统一计算返回 `viewerActions`，前端仅按结果渲染。

---

## 2. 权限计算（服务端 `GET /expenses/:id`）

`viewerActions` 由后端根据当前用户角色、是否报表提交者、报表状态三条信息计算：

```typescript
{
  canEdit: boolean;
  canSubmit: boolean;
  canDelete: boolean;
  canApprove: boolean;
  canReject: boolean;
}
```

### 完整权限矩阵

| 查看者 | 报表状态 | canEdit | canSubmit | canDelete | canApprove | canReject |
|--------|---------|---------|-----------|-----------|------------|-----------|
| **提交者本人** | draft | ✅ | ✅ | ✅ | — | — |
| | rejected | ✅ | ✅ | — | — | — |
| | pending/approved/paid | — | — | — | — | — |
| **审批人（角色匹配审批记录）** | pending | — | — | — | ✅ | ✅ |
| **管理员** | 任意 | ✅ | ✅ | ✅ | ✅ | ✅ |

- 管理员始终拥有全部权限
- 管理员删除待审批/已通过等非草稿状态的报销单时，级联清除关联 `approval_records`（当前 `DELETE /expenses/:id` 无此逻辑）

---

## 3. 页面拆分

### 3.1 ExpenseDetail.vue（提交者视图）

**路由**：`/expenses/:id`

**入口**：报销列表、工作台

**显示按钮**：根据 `viewerActions` 显示 `canEdit` / `canSubmit` / `canDelete`

**管理员增强**：管理员进入此页面时额外显示 `canApprove` / `canReject`

**共通内容**：费用明细、发票、审批时间线

### 3.2 ApprovalHandle.vue（审批者视图，新建）

**路由**：`/approvals/:reportId`

**入口**：审批管理列表（`Approvals.vue` 点击卡片跳转至此）

**显示按钮**：根据 `viewerActions` 显示 `canApprove` / `canReject`

**管理员增强**：管理员进入此页面时额外显示 `canEdit` / `canDelete`

**共通内容**：费用明细、发票、审批时间线

### 3.3 共通组件抽取

审批时间线（步骤节点、规则名、审批人、驳回原因、时间）从 `ExpenseDetail.vue` 抽出为 `ApprovalTimeline.vue` 组件，两个页面复用。

---

## 4. 审批管理列表联动

`Approvals.vue` 点击卡片 → `router.push('/approvals/' + item.reportId)`（当前为 `/expenses/:id`，需修改）

`ApprovalHandle.vue` 审批完成或驳回后 → 自动刷新审批列表或跳转回 `/approvals`

---

## 5. 管理员删除级联

当前 `DELETE /expenses/:id` 不删除审批记录。修改逻辑：

- 管理员删除任意状态的报销单时，执行 `DELETE FROM approval_records WHERE report_id = $1` 后再删除报表
- 普通用户仅可删除自己草稿状态的报销单（现有逻辑不变）

---

## 6. 文件变更清单

| 文件 | 变更 | 说明 |
|------|------|------|
| `packages/api/src/routes/expenses.ts` | 修改 | `GET /:id` 返回 `viewerActions`；`DELETE /:id` 管理员级联删除审批记录 |
| `packages/web/src/pages/ExpenseDetail.vue` | 修改 | 按钮改用 `viewerActions` 驱动；抽取时间线为组件 |
| `packages/web/src/components/ApprovalTimeline.vue` | 新建 | 审批时间线公共组件 |
| `packages/web/src/pages/ApprovalHandle.vue` | 新建 | 审批者视图 |
| `packages/web/src/pages/Approvals.vue` | 修改 | 卡片点击跳转改为 `/approvals/:reportId` |
| `packages/web/src/router/index.ts` | 修改 | 新增 `/approvals/:reportId` 路由 |

---

> 评审完成，进入实施阶段。
