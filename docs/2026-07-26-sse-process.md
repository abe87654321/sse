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
4. **本体 Turtle 文件** — `data/ontology/sse.owl` 初始文件待创建

---

## 下次会话建议

1. 运行 `pnpm test:integration`（需先启动 API）验证本体和 MDM
2. 事务性消息接入 — 驳回/付款等 API 端点调用 NotificationEngine.send()
3. 配置真实邮件/SMS 通道
4. 创建 `data/ontology/sse.owl` 初始 Turtle 本体文件

---

> 文档位置：`E:\app\opencode\sse\docs\2026-07-26-sse-process.md`

---

# SSE 报销系统 — 开发过程记录（v2.2）

> 日期：2026-07-27 | 会话记录

---

## 阶段八：本体层 MCP 工具 + 可视化页面

### 使用的 ECC 技能
- **brainstorming** — 确认 MCP 工具选择（7个全做）+ 可视化方案（Cytoscape.js）
- **writing-plans** — 制定 6 个任务的实施计划
- **subagent-driven-development** — 子代理逐任务实施 + spec/code 双阶段审查

### 6 个任务完成情况

| # | 任务 | 状态 |
|---|------|------|
| 1 | OwlStore 扩展：getGraph / addRelation / deleteEntity / deleteRelation / clear | ✅ |
| 2 | EntityExtractor 扩展：extractGraph NL→图谱 | ✅ |
| 3 | 7 个 MCP 工具实现 + server.ts 注册（共 13 个工具） | ✅ |
| 4 | API 扩展：/from-text, /graph, /entity, /relation（共 9 个端点） | ✅ |
| 5 | 前端 Ontology.vue（Cytoscape.js）+ 路由 + 侧边栏 | ✅ |
| 6 | 全量编译验证（11/11 包通过） | ✅ |

### MCP 工具（7 个新增）

| 工具 | 功能 |
|------|------|
| `submit_expense_from_text` | NL 描述 → LLM 提取 → 创建+提交报销单 |
| `submit_expense_from_invoice` | 发票 base64 → OCR → LLM → 创建报销单 |
| `query_expense_status` | NL 查询 → LLM 提取过滤条件 → SQL 搜索 → NL 总结 |
| `explain_decision` | 解释审批规则匹配 + 审批链 + 全程历史 |
| `get_entity_network` | N 跳 BFS 语义关系网络展开 |
| `validate_expense` | 合规检查：规则匹配 + 审批人就绪校验 + 建议 |
| `query_ontology` | 图谱查询：全图/按类型过滤 + 统计概览 |

### API 端点（6 个新增，共 9 个）

| 方法 | 路径 | 说明 |
|------|------|------|
| `POST` | `/ontology/from-text` | NL → LLM 提取实体+关系 → 存 OwlStore |
| `GET` | `/ontology/graph` | 返回全图谱（nodes + edges） |
| `PUT` | `/ontology/entity` | 创建/编辑实体 |
| `DELETE` | `/ontology/entity?uri=` | 删除实体及关联 |
| `POST` | `/ontology/relation` | 创建关系 |
| `DELETE` | `/ontology/relation` | 删除关系 |

### 前端页面

- **路由**：`/ontology`，侧边栏菜单"本体可视化"
- **Cytoscape.js 图谱**：缩放/拖拽/自动布局，节点按类型着色
- **NL → 图谱**：自然语言描述 → LLM 提取 → 渲染到画布
- **手动编辑**：添加节点（URI+类型+属性JSON）、添加关系
- **属性面板**：点击节点查看/编辑属性，保存或删除
- **数据库同步**：一键从 expense_reports 表同步到本体图谱

### 代码质量修复
- OwlStore `getGraph()`：修复 N+1 查询（预建 typeIndex），修复 https URI 误判（改用 termType）
- EntityExtractor：GraphExtraction 类型同时定义于 types.ts 和 entity-extractor.ts（TODO：统一导入）

### 新增/修改文件

```
新增：
packages/mcp/src/tools/submit-expense-from-text.ts
packages/mcp/src/tools/submit-expense-from-invoice.ts
packages/mcp/src/tools/query-expense-status.ts
packages/mcp/src/tools/explain-decision.ts
packages/mcp/src/tools/get-entity-network.ts
packages/mcp/src/tools/validate-expense.ts
packages/mcp/src/tools/query-ontology.ts
packages/web/src/pages/Ontology.vue

修改：
packages/ontology/src/owl-store.ts
packages/ontology/src/entity-extractor.ts
packages/ontology/src/types.ts
packages/mcp/src/server.ts
packages/api/src/routes/ontology.ts
packages/web/src/router/index.ts
packages/web/src/layouts/DefaultLayout.vue
docs/2026-07-26-ontology-design.md
docs/2026-07-26-sse-process.md
```

### 已知问题（本阶段）
1. GraphExtraction 在 types.ts 和 entity-extractor.ts 重复定义
2. 可视化页面使用 Cytoscape.js（已计划替换为 vis-network）

---

> 文档位置：`E:\app\opencode\sse\docs\2026-07-26-sse-process.md`

---

# SSE 报销系统 — 开发过程记录（v2.3）

> 日期：2026-07-27 | 会话记录（续）

---

## 阶段九：本体可视化升级 — vis-network + 持久化 + 校验

### 使用的 ECC 技能
- **brainstorming** — 调研可视化方案（Cytoscape vs vis-network vs d3），确定持久化策略
- **writing-plans** — 制定 5 个任务的实施计划
- **subagent-driven-development** — 子代理逐任务实施

### 5 个任务完成情况

| # | 任务 | 状态 |
|---|------|------|
| 1 | OwlStore validateGraph + saveToDb/loadFromDb + DB 迁移 | ✅ |
| 2 | vis-network 替换 cytoscape + 图例 + 警告 + 搜索 | ✅ |
| 3 | API 集成校验 + Turtle/DB 持久化调用 | ✅ |
| 4 | 启动时从 DB/Turtle 恢复本体 | ✅ |
| 5 | 全量编译 + 文档更新 | ✅ |

### 主要变更

**可视化：Cytoscape.js → vis-network**
- 节点按类型区分形状（Person=圆形, Department=菱形, ExpenseItem=三角形, Invoice=五角星, Rule=方形）
- 深色背景 + 力导向布局，双击节点高亮邻居
- 搜索过滤 + 重置视图 + 导航按钮
- 底部图例面板（8 种类型颜色/形状对照）

**合规校验：OwlStore.validateGraph()**
- 检查关系来源/目标是否存在
- 标记孤立节点（无连接）
- 检查 Person 是否绑定 belongsTo 部门
- API `/from-text` 和 `/sync` 返回 `warnings` 数组

**混合持久化**
- 每次写操作自动 saveToTurtle("data/ontology/sse.owl") + saveToDb()
- API 启动时从 DB (ontology_snapshots 表) + Turtle 文件恢复
- 重启后数据不丢失

**数据库迁移（Docker 环境）**
```bash
# 注意：PostgreSQL 在 Docker 容器中，不能用本地 psql
sudo docker exec -i sse-postgres-1 psql -U sse -d sse < packages/db/src/migrations/004_ontology_snapshots.sql
```

### 新增/修改文件
```
新增：
packages/db/src/migrations/004_ontology_snapshots.sql

修改：
packages/ontology/src/owl-store.ts
packages/web/src/pages/Ontology.vue (重写)
packages/web/package.json (cytoscape → vis-network + vis-data)
packages/api/src/routes/ontology.ts
packages/api/src/index.ts
docs/2026-07-26-ontology-design.md (v1.2)
docs/2026-07-26-sse-process.md
```

### 已知问题（本阶段）
1. Ontology chunk 531KB（vis-network + vis-data 捆绑）
2. Turtle 文件仅在写操作后保存，启动恢复优先 DB

---

## 已知问题（更新）

1. **事务性消息未接入** — 驳回/付款等事件未调用 NotificationEngine.send()
2. **邮件/SMS Dev 模式** — 需配置 SMTP/阿里云
3. **集成测试依赖 API 服务** — 需先启动 `pnpm --filter @sse/api dev`
4. **本体 n3 类型声明** — `n3.d.ts` 是手动维护的类型声明

---

## 下次会话建议

1. 运行 `pnpm test:integration`（需先启动 API）验证本体和 MDM
2. 事务性消息接入 — 驳回/付款等 API 端点调用 NotificationEngine.send()
3. 配置真实邮件/SMS 通道

---

> 文档位置：`E:\app\opencode\sse\docs\2026-07-26-sse-process.md`
