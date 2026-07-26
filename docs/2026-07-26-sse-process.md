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
2ceabae docs: add ontology and MDM integration design specs
bf3f959 feat: add ontology package, ontology routes, MDM identity bridge, SCIM/webhook
0f35443 docs: update README with latest features, ontology, MDM; switch to Apache 2.0
734f60a docs: switch logo to Phosphor invoice icon
2726ddf feat: apply invoice logo to sidebar, login, favicon, and browser tab
f77c124 test: add ontology and MDM integration test cases
65933b5 fix: jest config exclude dist and node_modules, restrict testMatch to test/ dir
1341eba fix: scope jest to test/ directory only, ignore packages and dist
b4795b3 fix: simplify jest config and add tsconfig for ts-jest
768f9fb chore: add test:integration script for test/ directory
0017ec7 fix: add node and jest types to test tsconfig
01d6dd4 fix: add @types/node to root workspace devDependencies
```

---

## 阶段四：UserPicker 通用组件 + Bug 修复

## 阶段五：本体层 + MDM 设计与实现

### 使用的 ECC 技能
- **brainstorming** — 本体层语义编排引擎 + MDM 整合设计
- **writing-plans** — 两个实施计划（7+2 任务）
- **Task tool (general-purpose)** — 子代理实施 ontology 包

### 新增文件（15+ 个）
```
packages/ontology/               — 本体层包（8 个源文件）
packages/api/src/routes/ontology.ts
packages/api/src/routes/scim.ts
packages/api/src/routes/webhook.ts
packages/api/src/services/identity-bridge.ts
packages/db/src/migrations/003_identity_mappings.sql
docs/2026-07-26-ontology-design.md
docs/2026-07-26-mdm-design.md
docs/plans/2026-07-26-ontology.md
docs/plans/2026-07-26-mdm.md
```

---

## 阶段六：README 重写 + Logo + 品牌统一

- 协议 MIT → **Apache 2.0**，新增 LICENSE 文件
- Logo：Phosphor Icons `invoice` 图标 + coral→orange 渐变
- 应用位置：README、侧边栏、登录页、favicon、浏览器标签页
- README 完整重写：12 个包、12 个 MCP 工具、本体语义引擎、MDM/SCIM

---

## 阶段七：集成测试用例 + 踩坑

### test/ 目录创建
- `test/ontology.test.ts` — 7 个用例
- `test/mdm.test.ts` — 9 个用例
- `pnpm test:integration` 运行（需先启动 API）

### jest 配置踩坑
| # | 问题 | 解决 |
|---|------|------|
| 1 | Jest 扫描 packages/ 下的测试文件 | 加 `test:integration` 脚本 `cd test && jest` |
| 2 | `import type` 语法解析失败 | test/ 目录加 `tsconfig.json`（types: node, jest） |
| 3 | `.bin/jest` 是 shell 脚本不能用 node 运行 | 用 `pnpm exec jest` 或 npm scripts |
| 4 | ts-jest 找不到 `process`/`fetch`/`require` | root 加 `@types/node` devDependency |

---

## 已知问题

1. **事务性消息未接入** — 驳回/付款等事件未调用 NotificationEngine.send()
2. **邮件/SMS Dev 模式** — 需配置 SMTP/阿里云
3. **集成测试依赖 API 服务** — 需先启动 `pnpm --filter @sse/api dev`
4. **`git stash/pop` 冲突** — 本地 package.json 被 pnpm add 修改时 pull 会冲突

---

## 下次会话建议

1. 运行 `pnpm test:integration`（需先启动 API）验证本体和 MDM
2. 事务性消息接入 — 驳回/付款等 API 端点调用 NotificationEngine.send()
3. 配置真实邮件/SMS 通道
4. 本体可视化编辑页面（Cytoscape.js）
5. MCP 工具注册（ontology 的 5 个新工具）

---

> 文档位置：`E:\app\opencode\sse\docs\2026-07-26-sse-process.md`
