# 审批流设计器 & 组织人员管理 — 需求设计文档

> 日期：2026-07-07 | 版本：v1.0 | 状态：待审核

---

## 1. 概述

为 SSE 系统新增**可视化拖拽审批流设计器**和**组织人员管理页面**。管理员可拖拽配置审批链步骤（每步可选角色 + 指定具体人员），系统实时校验角色是否有人、指定人员是否存在。

---

## 2. 审批流设计器

### 2.1 位置

系统管理 → 审批流设计 面板。

### 2.2 ApprovalChainStep 类型变更

```typescript
// 现有
type ApprovalChainStep = {
  step: number;
  role: string;
  label: string;
  reminderAfterHours?: number;
  escalateAfterHours?: number;
  escalateTo?: string;
};

// 变更为
type ApprovalChainStep = {
  step: number;
  role?: string;              // 角色，可选（"dept_approver" | "finance" | "admin"）
  assigneeId?: string;        // 指定人员ID，可选
  assigneeName?: string;      // 指定人员姓名，展示用
  label: string;              // 步骤显示名称
  reminderAfterHours?: number;
  escalateAfterHours?: number;
  escalateTo?: string;
};
```

**规则**：每步至少填 role 或 assigneeId 之一。两者都填表示"该角色的某个人或指定的这个人"。

### 2.3 界面交互

- **拖拽排序**：每个步骤卡片左侧 ⠿ 拖拽手柄，上下拖动调整顺序
- **添加步骤**：底部 "+ 添加步骤" 按钮
- **删除步骤**：卡片右上角 ✕ 按钮
- **编辑步骤**：卡片内直接编辑：
  - 角色下拉框（employee / dept_approver / finance / admin）
  - 人员搜索框（输入姓名搜索用户列表）
  - 提醒/升级时间配置
- **保存**：提交整个审批链 JSON 到后端

### 2.4 实时校验

编辑每步时，实时查询后端校验：

```
✅ 部门审批人 — 可用（张三、李四）
⚠ 财务 — 该角色下没有在职人员，请先添加
⚠ 管理员 — 该角色下没有在职人员
ℹ 指定人员 "张三" — 存在，部门：技术部
ℹ 指定人员 "王五" — 不存在，请检查
```

校验结果以彩色标记显示在步骤卡片上。

### 2.5 技术实现

- 使用原生 HTML5 Drag & Drop API（不引入额外拖拽库）
- SortableList 组件封装拖拽逻辑
- 审批规则列表可切换编辑（现有规则 / 新建规则）

---

## 3. 用户管理页

### 3.1 功能列表

| 功能 | 说明 |
|------|------|
| 列表展示 | 姓名、手机、邮箱、部门、角色、状态，支持分页 |
| 新建用户 | 弹窗：姓名、手机、邮箱、部门（下拉）、角色（下拉） |
| 编辑用户 | 行内编辑或弹窗，可修改姓名/手机/邮箱/部门/角色 |
| 禁用/启用 | 开关按钮，不影响已有审批记录 |
| 搜索 | 按姓名/手机/部门模糊搜索 |
| 筛选 | 按角色筛选，快速发现哪些角色缺人 |
| 角色人数统计 | 每个角色旁显示在职人数，少于 1 人标红 |

### 3.2 角色约束

| 角色 | 最少人数 | 原因 |
|------|----------|------|
| employee | ≥ 1 | 否则无人可提交报销 |
| dept_approver | 每个有员工的部门 ≥ 1 | 否则报销无法审批 |
| finance | ≥ 1 | 否则无法复核打款 |
| admin | ≥ 1 | 否则无法管理系统 |

### 3.3 后端 API

复用现有 `/admin/users` 路由，补充：

- `PUT /admin/users/:id` — 已有，补充 role 修改
- `POST /admin/users` — 已有
- `DELETE /admin/users/:id` — 已有（软删除）

新增：

- `GET /admin/users/validate` — 返回各角色人数统计
  ```json
  { "employee": 3, "dept_approver": 1, "finance": 0, "admin": 1 }
  ```

---

## 4. 部门管理页

### 4.1 功能

| 功能 | 说明 |
|------|------|
| 列表 | 部门名称、在职人数、创建时间 |
| 新建 | 输入部门名称 |
| 重命名 | 双击或编辑按钮 |
| 删除 | 仅当部门下无用户时可删除，否则提示 |

### 4.2 后端 API

新增路由 `/admin/departments`：

- `GET` — 列表
- `POST` — 新建
- `PUT /:id` — 重命名
- `DELETE /:id` — 删除（需校验无用户）

### 4.3 数据来源

部门数据来自 `users.department` 字段。`users` 表已存在 `department` 列。页面以 `SELECT DISTINCT department FROM users` 聚合展示。

---

## 5. 个人中心页

### 5.1 修复现有问题

| 问题 | 修复 |
|------|------|
| "保存修改"按钮无响应 | 对接 `PUT /auth/profile` |
| "更新密码"按钮无响应 | 对接 `PUT /auth/password` |
| 手机号不可修改 | 去掉 `disabled`，对接后端验证 |

---

## 6. 实施优先级

| 优先级 | 模块 | 工作量 |
|--------|------|--------|
| P0 | 用户管理页 CRUD + 角色校验 | 中 |
| P1 | 审批流设计器（拖拽 + 校验） | 大 |
| P2 | 个人中心页修复 | 小 |
| P3 | 部门管理页 | 小 |

---

> 文档位置：`E:\app\opencode\sse\docs\2026-07-07-workflow-organisation-design.md`
