# SSE 核心实体关系 & 权限矩阵

> 日期：2026-07-07

---

## 1. 实体关系图 (ER)

```
┌──────────────────────┐
│     Department       │   ← 从 users.department 派生
│  name (PK)           │
│  user_count          │
└──────────┬───────────┘
           │ 1:N
           ▼
┌──────────────────────────────────────────────┐
│                  User                         │
│  id (UUID PK)                                │
│  name · phone · email                        │
│  department ──────────────────────────────┐  │
│  role: admin | finance | dept_approver    │  │
│        | employee                         │  │
│  parent_id ──────────┐                    │  │
│  status: active | disabled                │  │
│  password_hash                            │  │
└──┬───────┬──────────┼─────────────────────┤  │
   │       │          │ self-ref (上级)     │  │
   │       │          └─────────────────────┘  │
   │       │                                    │
   │       │ 1:N (申请人)                       │
   │       ▼                                    │
   │  ┌──────────────────────────┐              │
   │  │     ExpenseReport         │              │
   │  │  id (UUID PK)            │              │
   │  │  serial_no (RE-xxx)      │              │
   │  │  user_id (FK → User)     │              │
   │  │  title · total_amount    │              │
   │  │  status: draft|pending|   │              │
   │  │    approved|rejected|paid │              │
   │  │  current_step · timestamps│              │
   │  └────┬─────────────────────┘              │
   │       │ 1:N                               │
   │       ▼                                    │
   │  ┌──────────────────────────┐              │
   │  │     ExpenseItem           │              │
   │  │  id · report_id (FK)     │              │
   │  │  category_id (FK)        │              │
   │  │  amount · expense_date   │              │
   │  │  description             │              │
   │  └────┬─────────────────────┘              │
   │       │ 1:1                               │
   │       ▼                                    │
   │  ┌──────────────────────────┐              │
   │  │       Invoice             │              │
   │  │  id · item_id (FK)       │              │
   │  │  file_name · file_format │              │
   │  │  storage_key · bucket    │              │
   │  │  checksum · ocr_result   │              │
   │  └──────────────────────────┘              │
   │                                            │
   │ 1:N (审批人)                               │
   ▼                                            │
┌──────────────────────────────┐                │
│      ApprovalRecord           │                │
│  id · report_id (FK)         │                │
│  step · approver_id (FK→User)│                │
│  result: pending|approved     │                │
│         | rejected            │                │
│  comment · timestamps         │                │
└──────────────────────────────┘                │
                                                │
    ┌───────────────────────────┐               │
    │      ApprovalRule          │               │
    │  id (UUID PK)             │               │
    │  name · min/max_amount    │               │
    │  category_ids[]           │               │
    │  approval_chain (JSONB):  │               │
    │    [{step, role?,          │               │
    │      assignee_id?,        │               │
    │      assignee_name?,      │               │
    │      reminder_hours,      │               │
    │      escalate_to}]        │               │
    │  priority · is_active     │               │
    └───────────────────────────┘               │
          ↑ 不直接关联，按金额+类别匹配           │
          └─────────────────────────────────────┘
```

---

## 2. 约束关系

| 约束 | 类型 | 说明 |
|------|------|------|
| User.parent_id → User.id | 自引用 FK | 上级关系，用于审批升级 |
| ExpenseReport.user_id → User.id | FK | 报销单发起人 |
| ExpenseItem.report_id → ExpenseReport.id | FK, CASCADE | 明细归属，删除报销单时级联删除 |
| Invoice.item_id → ExpenseItem.id | FK, CASCADE | 发票归属，删除明细时级联删除 |
| ApprovalRecord.report_id → ExpenseReport.id | FK, CASCADE | 审批记录归属 |
| ApprovalRecord.approver_id → User.id | FK | 审批人必须是真实用户 |
| ApprovalRule.approval_chain[].role | 应用层 | 角色必须在系统中存在至少1名在职人员 |
| ApprovalRule.approval_chain[].assigneeId | 应用层 | 指定人员必须存在且 status = active |
| ExpenseReport.status | 状态机 | draft → pending → approved → paid（rejected → draft） |

---

## 3. 报销单状态流转

```
草稿 ──提交──> 待审批 ──全部通过──> 已通过 ──打款──> 已打款
  ^               │
  │               ├──驳回──> 已驳回 ──修改重提──> 草稿
  │               │
  └───保存草稿─────┘
```

---

## 4. 审批规则匹配逻辑

1. 提交报销单 → 计算总金额
2. 筛选 `is_active=true` 且 `min_amount ≤ 总金额 < max_amount` 的规则
3. 若有 `category_ids` 限定，匹配报销单中的费用类别
4. 按 `priority` 升序，取第一条匹配规则
5. 按 `approval_chain` 顺序执行审批

---

## 5. 权限矩阵

### 5.1 数据范围

| 实体 | employee | dept_approver | finance | admin |
|------|----------|---------------|---------|-------|
| User（自身） | 可读 | 可读 | 可读 | 可读 |
| User（他人） | ❌ | 仅同部门 | 全公司 | 全公司 · 可编辑 |
| Department | ❌ | 仅本部门 | 全公司 | 全部 · 可管理 |
| ExpenseReport | 仅自己 | 本部门所有 | 全公司 | 全公司 |
| ExpenseItem | 同Report | 同Report | 同Report | 同Report |
| Invoice | 同Item | 同Item | 同Item | 同Item |
| ApprovalRecord | 仅自己的报销 | 本部门 | 全公司 | 全公司 |

### 5.2 操作权限

| 操作 | employee | dept_approver | finance | admin |
|------|----------|---------------|---------|-------|
| 提交报销 | ✅ | ✅ | ✅ | ✅ |
| 查看自己报销 | ✅ | ✅ | ✅ | ✅ |
| 查看本部门报销 | ❌ | ✅ | ✅ | ✅ |
| 查看全公司报销 | ❌ | ❌ | ✅ | ✅ |
| 审批报销 | ❌ | ✅ | ❌ | ❌ |
| 复核打款 | ❌ | ❌ | ✅ | ❌ |
| 导出报表 | ❌ | ❌ | ✅ | ✅ |
| 管理用户 | ❌ | ❌ | ❌ | ✅ |
| 管理部门 | ❌ | ❌ | ❌ | ✅ |
| 管理审批规则 | ❌ | ❌ | ❌ | ✅ |
| 管理AI配置 | ❌ | ❌ | ❌ | ✅ |

### 5.3 数据范围过滤伪代码

```
canViewReport(viewerRole, viewerDept, ownerDept, ownerId, viewerId):
  if viewer is disabled         → false
  if viewerRole is admin        → true
  if viewerRole is finance      → true
  if viewerRole is dept_approver → viewerDept == ownerDept
  if viewerRole is employee     → viewerId == ownerId
```

---

> 文档位置：`E:\app\opencode\sse\docs\2026-07-07-er-permission-matrix.md`
