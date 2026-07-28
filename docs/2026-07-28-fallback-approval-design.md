# SSE 最简审批流程 — 需求设计文档

> 日期：2026-07-28 | 版本：v1.0 | 状态：已确认

---

## 1. 概述

在小公司场景中，一人常担任多角色（如同时是部门审批人和财务）。当前审批链按角色推进 `dept_approver → finance`，导致同一人对同一报销单审批两次。同时，当部门缺少审批人或无规则匹配时，系统缺乏兜底机制。

新增**最简审批流程**：一条极低优先级的兜底规则 + 提交时智能检测同人降级。

---

## 2. 兜底规则

### 2.1 设计

在现有 `approval_rules` 表中创建一条特殊规则，利用 `matchRule()` 的 priority 排序机制自然兜底：

```json
{
  "name": "最简审批",
  "minAmount": 0,
  "maxAmount": 99999999,
  "categoryIds": null,
  "approvalChain": [{ "step": 1, "role": null, "assigneeId": "管理员UUID", "label": "兜底审批" }],
  "priority": 9999,
  "isActive": true
}
```

**效果**：`matchRule()` 按 priority 升序匹配。当前面所有规则都不匹配时，此规则因全金额区间 + 全类别覆盖自然返回。`matchRule()` 零改动。

### 2.2 触发场景

| 场景 | 说明 |
|------|------|
| 无规则命中 | 金额/类别不在任何活跃规则范围内 |
| 部门缺少审批人 | `matchRule()` 虽是普通规则，但审批链的 role 在部门中无人 → 经同人检测后走兜底 |
| 审批链全指向同一人 | 检测降级处理（见 §3） |

---

## 3. 同人检测降级

### 3.1 时机

提交报销单时（`POST /expenses/:id/submit`），在 `matchRule()` 返回规则后、`startApproval()` 创建审批记录前。

### 3.2 流程

```
matchRule() → 得到规则 + 审批链
              ↓
         对每一步解析实际审批人
              ↓
    ┌─ 步骤1: role="dept_approver" → userRepo.findByRole(role, department) → [张三, 李四]
    │  步骤2: role="finance"        → userRepo.findByRole(role)             → [张三]
    │  步骤3: assigneeId="uuid"     → userRepo.findById(uuid)              → [王五]
    └─→ 比较各步骤审批人集合
              ↓
    ┌─ 所有步骤指向同一人（张三同时是部门审批人和财务）
    │    → 合并为一步：审批人=张三
    │
    ├─ 部分重叠（步骤1=[张三,李四]，步骤2=[张三]）
    │    → 合并重叠步骤
    │
    └─ 无重叠 → 正常执行
```

### 3.3 降级后通知

降级发生时，向所有管理员发送 `bounce_alert` 类型通知："审批链因同人降级，原X步→现Y步，审批人：XXX"。

### 3.4 有效审批链存储

降级后的有效步骤存入 `ApprovalRecord` 数组。后续 `createNextStep()` 和审批推进参照实际创建的审批记录而非原始规则审批链，避免步数错位。

不新增数据库字段——通过比较 `approval_records` 的步数与原始规则步数，即可判断是否发生降级。

---

## 4. 文件变更

| 文件 | 变更 | 说明 |
|------|------|------|
| `packages/core/src/services/approval-engine.ts` | 修改 | 新增 `dedupeChain()` 和 `resolveApprover()` 方法 |
| `packages/core/src/ports/iuser-repo.ts` | 无改动 | 复用现有 `findByRole()` 和 `findById()` |
| `packages/api/src/routes/expenses.ts` | 修改 | `POST /:id/submit` 调用降级检测 |
| `packages/api/src/routes/approvals.ts` | 修改 | `createNextStep()` 参照实际审批记录数 |
| `packages/notifications/src/notification-engine.ts` | 视需要 | 降级通知调用（如已存在则复用） |

---

## 5. 前端

无新增页面。管理员在现有**审批规则管理**界面创建兜底规则，或一键"设为最简审批"快捷入口。

---

> 评审完成，进入实施阶段。
