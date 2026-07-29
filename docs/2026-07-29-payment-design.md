# SSE 打款接口 — 需求设计文档

> 日期：2026-07-29 | 版本：v1.0 | 状态：待评审

---

## 1. 概述

报销单审批通过后进入"已通过"状态，最终需由财务人员确认打款。当前 `paid` 状态仅是枚举值，无实际接口和数据支撑。本设计分两阶段：先实现手动打款，预留自动化对接财务系统的回调接口。

---

## 2. 数据模型

### 2.1 `expense_reports` 新增字段

| 字段 | 类型 | 说明 |
|------|------|------|
| `paid_at` | TIMESTAMPTZ | 打款完成时间 |
| `paid_by` | UUID | 打款操作人，FK → users(id) |
| `payment_ref` | VARCHAR(100) | 打款凭证号/交易流水号，可为空 |

### 2.2 迁移脚本

```sql
ALTER TABLE expense_reports
  ADD COLUMN paid_at TIMESTAMPTZ,
  ADD COLUMN paid_by UUID REFERENCES users(id),
  ADD COLUMN payment_ref VARCHAR(100);
```

---

## 3. API 设计

### 3.1 手动打款

`POST /expenses/:id/pay`

**权限**：`finance` 或 `admin`，仅 `approved` 状态可操作。

**请求**：
```json
{
  "paymentRef": "BANK-20260729-001",
  "comment": "已转至张三工行尾号1872"
}
```

**响应**：
```json
{
  "message": "已标记打款",
  "paidAt": "2026-07-29T10:00:00Z",
  "paymentRef": "BANK-20260729-001"
}
```

### 3.2 财务系统回调（第二阶段预留）

`POST /api/v1/webhooks/payment-callback`

**认证**：HMAC-SHA256 签名（与 §9 数据中台对接一致）。

**请求**：
```json
{
  "reportId": "uuid",
  "paidAt": "2026-07-29T10:00:00Z",
  "paymentRef": "ERP-PAY-001",
  "status": "success"
}
```

**响应**：
```json
{ "message": "ok" }
```

**验签失败** → 401；`reportId` 不存在 → 404；状态非 `approved` → 409。

### 3.3 状态流转更新

```
Draft → Pending → Approved → Paid
                              ↑
                     POST /expenses/:id/pay
```

---

## 4. viewerActions 更新

`GET /expenses/:id` 返回的 `viewerActions` 新增 `canPay` 字段：

```typescript
{ canPay: (isAdmin || isFinance) && report.status === 'approved' }
```

已打款的报销单所有按钮隐藏（含管理员删除）。

---

## 5. 本体层扩展

`packages/ontology/src/semantic-mapper.ts` 同步打款状态时新增：

| 元素 | 定义 |
|------|------|
| 类 | `sse:PaidReport` 继承 `sse:ApprovedReport` |
| 数据属性 | `sse:paidAt` (xsd:dateTime)、`sse:paidBy` (xsd:string)、`sse:paymentRef` (xsd:string) |

本体查询 `query_ontology` 按类型过滤时增加 `PaidReport` 支持。

---

## 6. 前端

| 页面 | 新增 |
|------|------|
| `ExpenseDetail.vue` | 基本信息卡片展示打款人和打款时间 |
| `ExpenseList.vue` | 已打款状态显示 `paid` 标签 |
| `ApprovalHandle.vue` | 已通过的报销单显示"确认打款"按钮 |

---

## 7. 文件变更清单

| 文件 | 变更 | 说明 |
|------|------|------|
| `packages/db/src/migrations/006_payment.sql` | 新建 | 新增 paid_at、paid_by、payment_ref |
| `packages/shared/src/types/expense-report.ts` | 修改 | 新增三个字段 |
| `packages/core/src/ports/iexpense-repo.ts` | 修改 | 新增 markPaid 方法 |
| `packages/db/src/repositories/pg-expense-repo.ts` | 修改 | 实现 markPaid + map 新增字段 |
| `packages/api/src/routes/expenses.ts` | 修改 | 新增 POST /:id/pay；GET 返回新增字段；viewerActions 新增 canPay |
| `packages/ontology/src/semantic-mapper.ts` | 修改 | 同步 PaidReport 类 |
| `packages/web/src/pages/ExpenseDetail.vue` | 修改 | 打款信息展示 |
| `packages/web/src/pages/ApprovalHandle.vue` | 修改 | 确认打款按钮 |

---

> 评审完成后进入实施阶段。
