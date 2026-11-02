# SSE 报销系统 — 开发过程记录（v2.6）

> 日期：2026-11-02 | 会话记录
> 本次会话覆盖：报销列表类别/报销人/分页、MCP 一致性修复、打款确认 Bug 与 P0/P1/P2 打款回单核对。

---

## 阶段十八：报销列表类别/报销人 + 服务端分页

### 问题

- 报销列表「类别」列始终为空。
- 列表没有「报销人」列。
- 列表分页和筛选是前端假分页：只取第一页，再在浏览器里过滤。

### 根因

- `ExpenseList.vue` 渲染 `item.category`，但 `GET /expenses` 从未返回该字段。
- `expense_reports` 表没有类别列，类别在 `expense_items.category_id -> expense_categories.name`，一张单可含多个类别。
- 列表接口只返回 `userId`，没有申请人姓名。

### 实现

- `packages/shared/src/types/expense-report.ts`
  - 新增 `applicantName?`、`categoryNames?`。
- `packages/db/src/repositories/pg-expense-repo.ts`
  - 列表/详情 JOIN `users` 取 `applicant_name`。
  - 用相关子查询聚合 `category_names`。
  - 关键词改为匹配 `serial_no OR title`。
- `packages/api/src/routes/expenses.ts`
  - 部门审批人分支同步 JOIN/聚合。
  - `mapReportRow` 映射新字段。
- `packages/web/src/pages/ExpenseList.vue`
  - 新增「报销人」列。
  - 类别标签：前 3 个 + `+N`，悬浮显示全部。
  - 状态/关键词/页码/每页条数改为服务端参数。
  - 筛选变化重置到第 1 页，关键词 300ms 防抖。
- `packages/web/src/pages/ExpenseDetail.vue`
  - 基本信息新增「报销人」。

### 结果

- PR #2 合并到 `master`，合并提交 `6f7de13`。
- 功能分支 `feat/expense-list-applicant-category-pagination` 已删除（本地+远程）。
- 文档：
  - `docs/superpowers/specs/2026-11-02-expense-list-category-applicant-design.md`
  - `docs/superpowers/plans/2026-11-02-expense-list-category-applicant.md`

---

## 阶段十九：MCP 一致性与可见性修复

### 问题

1. 原生 MCP `search_expenses` 的员工路径与非员工路径行为不一致：
   - 员工走 `findManyByUser`，返回 camelCase；
   - 非员工走工具内 SQL，关键词仅搜标题，且不返回申请人/类别。
2. 上一个会话的 AI 发票核对结果对 MCP 不可见。
3. Pi 瘦客户端 `get_approval_status` / `explain_decision` 读取了错误的字段层级（`r.data.status` 而不是 `r.data.report.status`）。

### 实现

- `packages/mcp/src/tools/search-expenses.ts`
  - 所有角色统一返回 snake_case。
  - 关键词统一为 `serial_no OR title`。
  - 所有角色返回 `applicant_name`、`category_names`。
- `packages/mcp/src/tools/get-expense-detail.ts`
  - report 增加 `applicant_name`。
  - invoice 增加 `invoice_no`、`verification_status`、`verification_result`、`verified_at`。
- `.pi/extensions/sse-mcp.ts`
  - `get_approval_status` / `explain_decision` 改读 `r.data.report.*`。
  - `explain_decision` 额外返回 `report` 对象。

### 结果

- 提交 `e9e8519 fix(mcp): align search results and expose invoice verification`。
- 已用真实数据调用 `search_expenses` / `get_expense_detail` 验证。

---

## 阶段二十：打款确认 Bug + 打款回单核对（P0+P1+P2）

### 问题

在报销详情点击「确认打款」后弹出 `prompt()` 输入凭证号。取消、Esc、切页导致弹窗关闭、或不输入直接确定时，仍会标记为已付款，且无法修改。

### 根因

`ExpenseDetail.vue` / `ApprovalHandle.vue` 使用：

```ts
const ref = prompt('打款凭证号（可选）：')
await api.post(..., { paymentRef: ref || undefined })
```

`prompt()` 取消返回 `null`，空输入确定返回 `''`，两者都被 `|| undefined` 吞掉后仍然提交。后端也没有校验凭证号，`payment_ref` 允许 NULL。

### 评审确认的业务规则

| 项 | 决策 |
|---|---|
| 打款凭证号 | 必填，除非上传打款回单（至少一项） |
| 打款回单 | 可选；上传后必须用系统 OCR 异步核对 |
| OCR 结果 | 异步执行，管理员/财务可查看是否可疑 |
| 修正 | 允许 finance/admin 修正，必须留审计和原因 |
| 撤销打款 | 允许 finance/admin，必须留审计和原因 |
| 已付款删除 | 禁止，包括管理员 |
| 凭证格式 | 无统一行业标准；自由文本，trim 后 1–100 字符 |

### 数据模型（迁移 011）

新增：

- `payment_receipts`：每单一份回单，MinIO 存储，含 OCR 结果和核对状态。
- `payment_audit_logs`：记录 `mark_paid` / `update_payment` / `revert_payment`，含操作人、原因、before/after。
- `expense_reports` 新增 `payment_comment`、`payment_updated_at`、`payment_updated_by`。

### 核心规则

- 打款：`status = approved`，且凭证号或回单至少一项。
- 原子更新：`UPDATE ... WHERE status='approved'`，避免并发重复打款。
- 已付款单据：`DELETE` 直接拒绝；前端 `canDelete=false`。
- 回单可疑规则：
  - OCR 不可用/失败 -> `unverified`
  - 金额与报销总额不一致（容差 0.01）-> `warning`
  - 回单日期与打款日期相差 >7 天 -> `warning`
  - 相同 checksum 的回单已存在 -> `warning`
  - 文本包含 失败/退回/冲正/撤销/处理中 -> `warning`
  - 全部通过 -> `pass`

### API

```text
POST /expenses/:id/payment-receipts                 # 上传回单（multipart）
GET  /expenses/:id/payment-receipts/:receiptId/download
POST /expenses/:id/payment-receipts/:receiptId/verify
POST /expenses/:id/pay                              # paymentRef/paymentComment/receiptId
PUT  /expenses/:id/payment                          # 修正，需 reason
POST /expenses/:id/payment/revert                   # 撤销，需 reason
```

- `GET /expenses/:id` 新增 `paymentReceipts`、`paymentAuditLogs`、`paidByName`，以及 `viewerActions.canManagePayment`。
- 回单详细核对结果和审计仅 finance/admin 可见；所有能查看报销单的人可下载回单。

### 前端

- 新增 `packages/web/src/components/PaymentDialog.vue`
  - 替代 `prompt()`；取消不提交。
  - 凭证号、备注、回单文件；凭证号/回单至少一项。
  - 支持 `pay` 和 `edit` 两种模式。
- 新增 `packages/web/src/components/PaymentReceiptPanel.vue`
  - 打款时间、打款人、凭证号、备注。
  - 回单状态、可疑提示、核对明细、下载、重新识别/强制重新识别。
  - 修正、撤销；审计记录列表。
- `ExpenseDetail.vue`、`ApprovalHandle.vue` 接入对话框；详情页展示回单核对面板。
- 修正/撤销后刷新详情；已付款删除按钮隐藏。

### 异步处理

- 上传后 `setImmediate` 触发核对。
- API 启动时扫描一次 `pending`，之后每 5 分钟扫描。
- 服务重启后未完成的 `pending` 回单会继续处理。
- 手动重新识别为同步接口，前端请求超时放宽到 180 秒。

### 结果

- 提交 `e819e8e feat(payments): require reference or receipt with audit and OCR checks`。
- 文档：
  - `docs/superpowers/specs/2026-11-02-payment-receipt-verification-design.md`
  - `docs/superpowers/plans/2026-11-02-payment-receipt-verification.md`

---

## 验证记录

### 构建与测试

| 项 | 结果 |
|---|---|
| `@sse/shared` build | 通过 |
| `@sse/core` build | 通过 |
| `@sse/core` test | 33 passed（新增 12 个回单核对用例） |
| `@sse/db` build | 通过 |
| `@sse/api` build | 通过 |
| `@sse/mcp` build | 通过 |
| `@sse/web` build | 通过 |

### 打款 API 冒烟测试

使用测试库与测试机 MinIO 实际执行：

- 空凭证打款 -> `400 请填写打款凭证号或上传打款回单`
- 上传回单 -> `201`，状态 `pending`
- 异步核对 -> `unverified`（本机未配置可用 OCR 引擎，符合预期）
- 打款 -> `200`，返回 `paymentRef`、`receiptId`
- 详情 -> `status=paid`、`paidByName`、回单数量、审计 `mark_paid`、`canDelete=false`、`canManagePayment=true`
- 修正 -> `200`
- 删除已付款 -> `400 已付款单据不可删除`
- 撤销 -> `200`，回到 `approved`
- 测试结束后已清理回单/审计测试记录，`RE-20261102-296` 恢复为 `approved`。

---

## 数据库迁移与部署

### 迁移 011

`packages/db/src/migrations/011_payment_receipts_audit.sql` 已应用到当前测试库 `192.168.3.107:5433/sse`。

测试机没有安装 `psql`，但 Postgres 跑在容器 `sse-postgres-1` 中，可用：

```bash
sudo docker exec -i -e PGPASSWORD=sse_dev sse-postgres-1 \
  psql -U sse -d sse < packages/db/src/migrations/011_payment_receipts_audit.sql
```

验证：

```bash
sudo docker exec -i -e PGPASSWORD=sse_dev sse-postgres-1 \
  psql -U sse -d sse -c "\dt payment_*"
```

注意：脚本使用 `IF NOT EXISTS`，重复执行是安全的 no-op。

### 部署顺序

```bash
git pull
pnpm install
# 先迁移（或至少保证在重启 API 前完成）
sudo docker exec -i -e PGPASSWORD=sse_dev sse-postgres-1 \
  psql -U sse -d sse < packages/db/src/migrations/011_payment_receipts_audit.sql
pnpm build
# 重启 API / 前端服务
```

关键：新 API 代码会查询 payment 表，迁移必须在 API 重启前完成。

已知基础设施限制：仓库的 `pnpm migrate` 目前只执行 `001_initial.sql`，不会自动应用 002–011。后续可单独改进迁移执行器。

---

## 已知限制与后续建议

- 回单 OCR 依赖「系统管理」中配置的 OCR 引擎；引擎不可用时状态为 `unverified`，需要在页面提示人工复核。
- 替换回单时旧文件保留在 MinIO 中供审计，不会自动删除。
- 审计日志目前是“先改状态、后写日志”；若要严格原子性，可把状态更新和审计写入同一事务。
- 替换回单/修正打款信息只允许 finance/admin；详细核对结果和审计不对普通员工展示。
- 之前已误标 `paid` 且无凭证号的历史单据，部署后可由 finance/admin 通过「修改打款信息」补录。
- 分页/筛选现在由服务端处理；如果后续增加按申请人姓名搜索，可复用 `applicantName` 查询参数。

---

## 本次提交记录

| Commit | 说明 |
|---|---|
| `6f7de13` | Merge PR #2：报销列表报销人/类别/服务端分页 |
| `e9e8519` | fix(mcp): 搜索一致性与发票核对结果可见性 |
| `e819e8e` | feat(payments): 打款凭证/回单、修正撤销审计、异步 OCR 可疑检查 |

当前 `master` 与 `origin/master` 同步于 `e819e8e`。

## 阶段二十一：系统管理引擎设置可用性优化

### 问题
- 智能填单要求完整 /v1/chat/completions 地址，缺少 API 密钥。
- 模型只能从固定下拉框选择，无法查看地址实际模型。
- OCR 测试结果不可观测。

### 实现
- 地址归一化：根地址、/v1、完整旧地址兼容；LocalProvider 自动补全 /v1/chat/completions。
- 智能填单：API 密钥、检测（模型列表 + 最小对话）、模型选择对话框（搜索/分类/刷新/+−/手动标签）。
- 配置：ai-config.json 增加 apiKey、catalogs、visionApiKey；按规范化地址持久化模型清单。
- OCR：测试耗时/状态/字段/原始文本/失败建议/样例上传/历史记录。
- 本体、MCP、视觉 OCR 透传 apiKey；配置保存后原地重配本体引擎。
- 测试历史写入本地 ai-test-history.json，读取和写入均做脱敏/截断，文件已加入 .gitignore。

### 验证
- @sse/ai 单元测试通过（60 tests）。
- @sse/api 探针/上传测试通过（2 suites，17 tests）；`@sse/api` 已接入 Jest。
- @sse/core 测试通过（33 tests）。
- ai/ontology/db/api/mcp/web 构建通过。
- 运行时冒烟（真实 Ollama、管理员登录、+/− 选择、OCR 样例上传）需在具备服务和测试库的环境手动执行。