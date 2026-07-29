# SSE 报销系统 — 开发过程记录（v2.4）

> 日期：2026-07-28 | 会话记录

---

## 阶段十一：人员删除功能

### 设计决策
- 三种删除方式：硬删除（无关联数据直接 DELETE）、软删除（status=deleted + deleted_at）、级联硬删除（清所有衍生数据）
- status 扩展为 `active` / `disabled` / `deleted`，deleted 不可逆
- 前端删除按钮改为下拉菜单，新增活跃/已禁用/已删除标签页

### 修复问题
- `approval_records.approver_id` 为 TEXT 类型（存储角色字符串），`getRelatedDataCount()` 中需 `$1::text` 比较
- `notification_logs` 无 `sender_id` 列，已从查询移除
- `identity_mappings` 表可能不存在，改为逐个查询 + try-catch 容错
- 操作列宽度从 80px 扩至 140px + `white-space: nowrap`
- 新建按钮仅活跃标签页显示
- 缺少 `GET /admin/users/:id` 路由导致分配人校验失败，已新增
- 路由顺序问题：`/users/validate` 被 `:id` 捕获，已调整顺序

### 产出
- `docs/2026-07-28-user-deletion-design.md`
- `docs/2026-07-28-user-deletion-plan.md`

---

## 阶段十二：审批引擎设计文档同步 + 最简审批流程

### 设计文档更新
- `2026-07-06-sse-design.md` v2.2 → v2.3：§4 审批引擎新增 §4.3 完整 API 流程、§4.4 审批人双语义解析、§4.5 两阶段提醒实际逻辑、§4.6 最简审批流程（兜底规则 + 同人检测降级）
- 英文版同步更新
- 新增 `docs/2026-07-28-fallback-approval-design.md`

### 最简审批流程实现
- **方案 C**：兜底规则（priority=9999 全范围规则）+ 提交/审批时同人检测降级
- `ApprovalEngine` 新增 `resolveApprovers()` 和 `dedupeApprovalChain()` 方法
- 提交流程（`expenses.ts`）和审批流程（`approvals.ts`）均集成降级检测
- 不新增 DB 字段，降级后直接修改本地 `rule.approvalChain`

---

## 阶段十三：Bug 修复 — 审批流程相关

### 1. 管理员无法审批
- 审批记录 `approverId = "dept_approver"`，管理员 `role = "admin"`，`r.approverId === role` 永远不匹配
- 修复：管理员审批/驳回时不按 approverId 过滤，直接找第一个 pending 记录

### 2. 报销详情页审批时间线始终为空
- 前端调用了不存在的 `GET /expenses/:id/approvals` 端点，被 silently catch
- 修复：直接使用 `GET /expenses/:id` 返回的 `approvalRecords`，新增审批人名称解析和规则名称显示

### 3. 驳回后无法编辑
- 前端编辑按钮仅对 `draft` 显示，后端 PUT/submit 仅允许 `DRAFT` 状态
- 修复：前端/后端均扩展支持 `REJECTED` 状态

### 4. 驳回/审批按钮从详情页移除
- 审批操作应在审批管理页面完成，报销详情页仅用于查看
- 已移除详情页的审批通过/驳回按钮，仅保留编辑/提交

### 5. 审批规则适用类别无法持久化
- 前端使用 `categories` 字段名，后端使用 `categoryIds`，写入和读取均不匹配
- 修复：前端 4 处统一改为 `categoryIds`

### 6. 审批规则分配人校验失败
- `WorkflowDesigner.vue` 调 `GET /admin/users/:id` 但路由不存在
- `GET /users/validate` 被 `GET /users/:id` 捕获
- 修复：新增路由 + 调整顺序

---

## 待解决

| 问题 | 状态 |
|------|------|
| 审批管理页面不显示待审批记录（API 正常，前端可能 JS 报错） | 排查中 |

---

## 待办模块汇总

| 优先级 | 模块 | 说明 | 状态 |
|--------|------|------|------|
| — | 人员删除功能 | 三种删除方式 | ✅ 已完成 |
| — | 最简审批流程 | 兜底规则 + 同人检测降级 | ✅ 已完成 |
| — | 审批流程 Bug 修复 | 管理员审批、驳回编辑、类别持久化等 | ✅ 已完成 |
| — | 打款接口 | 手动打款 + 预留财务系统回调 | ✅ 已完成 |
| — | 本体可视化按角色过滤 | 员工/部门审批人/管理员各自看自己的数据范围 | ✅ 已完成 |
| — | 本体层升级设计 + 实现 | 多系统融合（SCIM/MDM→本体）+ 推理引擎（reasoning_rules）+ SPARQL（MCP工具 + 管理UI） | ✅ 已完成 |
| — | 审批流程 + 本体 Bug 修复 | 日期持久化、重复记录、SPARQL URI解析、本体单例共享等 | ✅ 已完成 |
| — | 本体测试用例 | 三大场景 12 个用例 + 一键回归脚本 + 部署 FAQ | ✅ 已完成 |
| P0 | 事务性消息接入 | 驳回/付款等 API 调用 NotificationEngine.send() | 未开始 |
| P1 | 邮件/SMS 真实通道 | 当前 dev/log 模式，需配置 SMTP + 阿里云短信 | 未开始 |
