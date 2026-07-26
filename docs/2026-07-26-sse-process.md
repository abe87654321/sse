# SSE 报销系统 — 开发过程记录（v2.1）

> 日期：2026-07-26 | 会话记录

---

## 阶段一：审批流程修复

### 发现问题
1. **Approvals.vue** 页面为桩，列表用硬编码假数据，按钮无事件绑定
2. **多步审批链断裂** — 提交后只创建第一步，后续步骤不推进
3. **提醒/升级调度器** — 代码写好但未接入 API 服务
4. **ApprovalEngine** 只处理第一步，无 `createNextStep` 逻辑

### 修复内容
| 文件 | 变更 |
|------|------|
| `approval-engine.ts` | 新增 `createNextStep()`、`isLastStep()`；简化 `approveStep()` 移除多余参数 |
| `approvals.ts` (API) | 正确匹配规则、创建后续步骤、推进 `current_step` |
| `expenses.ts` (API) | `POST /:id/submit` 触发审批引擎，创建首步审批记录 |
| `Approvals.vue` | 从 API 获取真实数据，驳回前弹出原因输入框，toast 消息 |
| `index.ts` (API) | 调度器随 API 启动，邮件/SMS provider 接入 |
| `pg-user-repo.ts` | 新增 `findByRole(role, department?)` |
| `scheduler.ts` | 修复角色审批人 UUID 校验问题 |
| `DefaultLayout.vue` | 新增登出按钮；隐藏非 admin 侧边栏管理菜单 |

### Git 提交
```bash
6724e67 fix: approval workflow - multi-step progression, frontend API integration, scheduler
47d97a4 fix: bind Express to IPv4 to avoid EADDRINUSE
6decc72 fix: cast PORT to number
32b18d0 feat: add logout button with user dropdown menu
```

---

## 阶段二：工作台和统计分析接入真实数据

### 修改文件
| 文件 | 变更 |
|------|------|
| `Dashboard.vue` | 统计卡片/待审批数/最近报销从 API 实时获取 |
| `Statistics.vue` | 汇总、月度趋势、类别分布从 `/statistics` API 获取 |
| `statistics.ts` (API) | 新增 `monthly` 查询聚合 |

---

## 阶段三：通知系统设计与实现

### 使用的 ECC 技能
- **brainstorming** — 设计通知系统的双通道架构
- **writing-plans** — 制定 12 个任务的实施计划
- **subagent-driven-development** — 子代理并行实施

### 设计决策
- 页面内通知为主 + SMS/邮件为补充送达渠道
- `notification_logs`（逻辑层）+ `notification_deliveries`（渠道层）两层模型
- `system_messages` 表承载管理员广播草稿/已发送
- 用户 `notify_prefs` JSONB 字段存储通知偏好
- AI 润色复用 Ollama LLM（`/ai/polish` 端点）

### 12 个任务完成情况

| # | 任务 | 状态 |
|---|------|------|
| 1 | 共享类型 + 枚举更新 | ✅ |
| 2 | 数据库迁移 | ✅ |
| 3 | 邮件 SMTP Provider（163邮箱） | ✅ |
| 4 | 阿里云短信 Provider | ✅ |
| 5 | 通知数据仓库 Repository | ✅ |
| 6 | NotificationEngine + 调度器更新 | ✅ |
| 7 | API：用户通知 + 偏好 + AI 润色 | ✅ |
| 8 | API：管理员广播消息管理 | ✅ |
| 9 | 前端：消息通知页重写 | ✅ |
| 10 | 前端：管理员消息管理页 | ✅ |
| 11 | 前端：个人中心通知设置 + 顶栏红点 | ✅ |
| 12 | 全量编译验证 | ✅ |

### 新增文件（13个）
```
packages/db/src/migrations/002_notifications.sql
packages/shared/src/types/notification-delivery.ts
packages/shared/src/types/system-message.ts
packages/core/src/ports/inotification-repo.ts
packages/db/src/repositories/pg-notification-repo.ts
packages/notifications/src/notification-engine.ts
packages/api/src/routes/notifications.ts
packages/api/src/routes/user.ts
packages/api/src/routes/admin-messages.ts
packages/web/src/pages/AdminMessages.vue
docs/2026-07-26-notification-system-design.md
docs/plans/2026-07-26-notification-system.md
docs/2026-07-26-sse-process.md
```

### 修改文件（14个）
```
packages/shared/src/enums/notification-trigger.ts
packages/shared/src/types/notification-log.ts
packages/shared/src/types/user.ts
packages/db/src/repositories/pg-notification-log-repo.ts
packages/db/src/repositories/pg-user-repo.ts
packages/notifications/src/channels/email.ts
packages/notifications/src/channels/sms.ts
packages/notifications/src/index.ts
packages/notifications/src/scheduler.ts
packages/api/src/routes/ai.ts
packages/api/src/index.ts
packages/web/src/pages/Notifications.vue (重写)
packages/web/src/pages/Profile.vue
packages/web/src/layouts/DefaultLayout.vue
packages/web/src/router/index.ts
docs/2026-07-06-sse-deployment.md
```

### Git 提交
```bash
20796d7 docs: add notification system design spec
858b905 docs: add notification system implementation plan (12 tasks)
c0c3586 fix: align User type fields and notification-log-repo with new types
92e9b42 feat: add DB migration, email/sms providers, fix type compatibility
a4182a9 feat: notification system - engine, repo, API routes, frontend pages
0e94d1d feat: add AdminMessages.vue - broadcast message management with AI polish
d2fc6c0 fix: improve AdminMessages error handling, fallback body to title
df01c9e docs: fix docker container names and add system_messages migration FAQ
5845d20 feat: add UserPicker common component, refactor AdminMessages to use it
b8deb57 fix: require target selection before sending broadcast, show sent count
976c1e0 feat: bidirectional role-user sync in AdminMessages, add role param to /user/search
f965a07 fix: add missing created_at and type columns to notification_logs migration
ead96d9 fix: drop NOT NULL on legacy notification_logs columns for new INSERT compatibility
012913a fix: send notification to all users even if notify_prefs is NULL (use defaults)
ca7ab16 fix: replace HTML emoji entities with real Unicode chars in Vue templates
0733834 fix: Dashboard &#165; display and Statistics NaN% division
dcdfa4e fix: sendBounceAlert FK violation and skip bounce when user has no phone/email
```

### 部署文档更新
- 新增 §4 通知通道配置：163邮箱 SMTP 开通步骤、阿里云短信开通步骤
- 环境变量清单新增 9 个变量
- `.env.example` 新增邮件 SMTP 和短信配置注释
- FAQ 新增 Docker 容器名修正、`system_messages` 表迁移、EADDRINUSE 端口冲突

---

## 阶段四：UserPicker 通用组件 + Bug 修复

### UserPicker 组件

用 brainstorming 设计，直接实施。3 个文件变更：

| 文件 | 变更 |
|------|------|
| `packages/web/src/components/UserPicker.vue` | 新建通用用户多选组件（标签在输入框内、下拉复选框、300ms 防抖、键盘导航） |
| `packages/api/src/routes/user.ts` | `/search` 支持 `q` 和 `role` 可选参数 |
| `packages/web/src/pages/AdminMessages.vue` | 替换内联搜索为 UserPicker；角色-用户双向同步 |

### 关键 Bug 修复

| Bug | 根因 | 修复 |
|-----|------|------|
| 通知发送后用户收不到 | `sendBatch` 中 `if (!prefs) continue` 因老用户 `notify_prefs` 为 NULL 全部跳过 | 改为总有默认 prefs |
| 勾选 SMS/邮件发送报 500 | `sendBounceAlert` 中 `notification_id: admin.id` 用用户 UUID 当通知 ID，FK 违规 | 改用 `bounceNotif.id` |
| 用户无 phone/email 时误报退回 | 未区分"未尝试发送"和"发送失败" | 新增 `attempted` 标志，未尝试则标 `skipped` |
| 迁移后 `notification_logs` INSERT 失败 | 旧列 `report_id` 等有 NOT NULL 约束 | ALTER 表松绑约束 |
| 表情符号显示 `&#128197;` | HTML 实体在 `{{ }}` 文本插值中不解码 | 换成真实 Unicode 字符 |
| 通过率显示 `NaN%` | 分母 `approvedCount + rejectedCount` 为 0 时除零 | 提前算 `done`，`done > 0` 才除 |
| 保存草稿失败 | `system_messages` 表不存在（迁移未执行） | 手动执行 `002_notifications.sql` |

### 设计文档新增
- `docs/2026-07-26-userpicker-design.md` — UserPicker 设计（含双向同步）

---

## 已知问题

1. ~~数据库迁移未执行~~ — 已手动执行 `002_notifications.sql`，但仅针对当前 DB
2. **事务性消息未接入** — 驳回/付款等事件的 NotificationEngine.send() 尚未调用
3. **阿里云短信 SDK** — 需安装并取消代码注释
4. **邮件/SMS 真实发送** — 当前用 Dev 模式（仅 console.log），需配置 SMTP/阿里云
5. **EADDRINUSE 端口冲突** — Express 绑定 IPv4 `0.0.0.0` 已缓解，FAQ 已记录 `fuser -k` 方案

---

## 下次会话建议

1. **优先**：事务性消息接入 — 驳回/付款等 API 端点调用 `NotificationEngine.send()`
2. **其次**：配置真实邮件/SMS 通道（163 SMTP / 阿里云短信）
3. **前端体验**：Dashboard 统计卡片在无数据时显示 0 而非 "-"、空状态优化
4. **测试**：端到端集成测试（创建报销 → 审批流转 → 通知送达）

---

> 文档位置：`E:\app\opencode\sse\docs\2026-07-26-sse-process.md`
