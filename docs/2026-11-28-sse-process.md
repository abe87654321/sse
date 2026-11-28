# SSE 开发过程记录（2026-11-28）

> 本会话覆盖：AI 智能填单“无反馈”修复、截图识别独立视觉模型（可配置 / 检测 / 模型列表 / 检验）、
> 文字识别批量发票 / 文件夹、识别结果追加与附件随明细、未保存表单草稿恢复与会话过期处理。
> 主要在 `master`。

---

## 一、AI 识别“没有结果反馈”修复（228e711）

### 现象

员工在新建报销中使用 AI 智能填单（文字 / 截图 / 上传发票），点击识别后长时间无明显反馈。

### 根因（测试机实测）

| # | 问题 | 证据 |
|---|---|---|
| 1 | 前端 axios 全局超时 **15s**，短于模型耗时 | `/ai/parse` 文字实测 39s，`/ai/parse-invoice` 19s |
| 2 | AI 错误渲染在页面**底部**（提交按钮上方），AI 卡片处看不到 | `ExpenseForm.vue` 的 `error-msg` 位置 |
| 3 | 截图识别复用文字模型 `qwen3.6-35b`（非视觉模型） | 图片解析返回 `items: []` |
| 4 | 根目录 `ai-config.json` 的 MinerU token 过期（与进程实际读取的不是同一份） | 根目录探测 401 `user token expired`；`packages/api/ai-config.json` 有效 |

### 修复

- `/ai/parse`、`/ai/parse-invoice` 前端超时提升到 **120s**。
- AI 错误 / 空结果改为**内联显示在 AI 卡片内**（`role=alert` / `role=status`），空结果提示“未识别到内容”。
- 新增独立 `visionEngine`（截图识别专用），不再回退到文字模型。
- 服务器侧：用有效的 `packages/api/ai-config.json` 覆盖根目录过期文件（备份保留）。

---

## 二、截图识别视觉模型：可配置 + 检测 + 模型列表 + 检验（14a10c6 / bef359d）

### 配置模型

- `packages/ai/src/config/ai-config.ts`
  - 新增 `visionEngine { endpoint, apiKey, model, enabled, catalogs }`。
  - 支持目录持久化、活动模型解析、密钥脱敏/换地址清空；与 `fillEngine` 行为一致。
- `packages/api/src/services/ai-engines.ts`
  - `createVisionFillProvider` / `getSmartFillVisionEngine`；
  - `visionEngineIssue()` 返回 `disabled | missing_endpoint | missing_model`。

### 管理端能力

| 能力 | 接口 |
|---|---|
| 检测 | `POST /admin/ai-connection-test { engine: 'vision' }` |
| 获取模型列表 | `POST /admin/ai-models { engine: 'vision' }`（目录存入 `visionEngine.catalogs`） |
| 检验视觉模型 | `POST /admin/ai-test/vision`（内置样例 `docs/vision-fill-sample.png`） |

- `Admin.vue` 新增「📸 截图识别视觉模型」卡片：地址 / 密钥 / 模型选择 / 检测 / 获取模型列表 / 检验视觉模型 / 启用。
- 错误提示按原因区分：未启用、缺 API 地址、缺模型、未配置完整。
- 样例图已用 `qwen3-vl:8b` 实测：识别为「交通 50 / 餐饮 88」两条。

---

## 三、文字识别支持多发票 / 文件夹（5cee486）

- 文字识别 Tab 文本框右侧新增「📁 发票文件」菜单：
  - **选择发票文件**：`<input multiple accept=".pdf,.ofd">`
  - **选择发票文件夹**：`<input webkitdirectory>`（递归）
- 规则：仅 PDF/OFD、单个 ≤20MB、最多 **20 个**、去重、顺序识别；忽略数量会提示。
- 「AI 识别」一次触发：先文字（如有），再逐个文件调用 `/ai/parse-invoice`，结果合并；按钮显示 `发票识别中… n/total`。
- 单个文件失败不影响其它文件，卡片内列出失败文件名与原因。

---

## 四、结果追加 + 来源附件随明细（69389d0 / a857a4a）

- `applyAIResult` 从“覆盖 `form.items`”改为**追加**，并过滤初始空占位行。
- 识别结果项新增 `sourceFile`：
  - 上传发票：该项挂上所选文件；
  - 文字 Tab 的多个发票：每个文件挂到其解析出的明细。
- 填表后写入 `pendingInvoiceFile`，费用明细显示 `📎 文件名 — 保存后自动上传`，保存时沿用原有上传流程。

> 截图识别暂不附带图片附件，因为发票附件目前只接受 PDF/OFD。

---

## 五、未保存表单“突然一闪全没了”根因与修复（edc0cb8）

### 根因（测试机日志确认）

- Vite 开发服务器在 `git pull`（代码部署）后触发 HMR：
  `[web] hmr update /src/pages/ExpenseForm.vue`。
- Vue SFC 热更新会销毁并重建组件实例，`form` 等内存状态（含 `File`）全部丢失；
  `App.vue` 的 `<component :key="route.path">` + 过渡动画表现为“一闪”。
- 表单没有草稿持久化，因此无法恢复。

### 修复

**1) 新建报销草稿自动保存 / 恢复**

- 字段（标题/说明/明细/AI Tab）防抖 400ms 写入 `localStorage`（`sse:expense-draft:new`）。
- 待上传发票文件写入 `IndexedDB`（`sse-drafts/files`），恢复时按明细顺序挂回。
- 进入页面自动恢复并提示，可「放弃草稿」；保存草稿/提交成功后清除；离开页面有未保存内容时提示。
- 仅新建生效；编辑已有单据不启用，避免覆盖服务端数据。

**2) 401 不再静默登出**

- `packages/web/src/api/session.ts`：区分 401 来源，登录类接口不计为会话过期。
- 普通 401 不再 `logout + 跳转`，改为标记 `sessionExpired`，布局顶部显示「登录已过期，请重新登录」。
- 后台未读数轮询（每 60s）触发的 401 也不会再打断正在填写的页面。

---

## 六、测试与提交

| 包 | 结果 |
|---|---|
| `@sse/ai` | 109 passed |
| `@sse/api` | 236 passed |
| `@sse/web` | 116 passed |
| 构建 | `@sse/ai` / `@sse/api` / `@sse/web` 均通过 |

| SHA | 说明 |
|---|---|
| `228e711` | fix(ai): 识别反馈内联 + 120s 超时 + 可配置视觉模型 |
| `14a10c6` | feat(admin): 视觉模型检测 / 模型列表 / 检验 |
| `bef359d` | fix(admin): 分类说明视觉模型不可用原因 |
| `69389d0` | fix(web): 识别结果追加而非覆盖 |
| `5cee486` | feat(web): 文字识别支持多发票 / 文件夹 |
| `a857a4a` | fix(web): 识别结果附带来源发票文件 |
| `edc0cb8` | feat(web): 草稿自动恢复 + 停止 401 静默登出 |

---

## 七、测试机部署与复测（192.168.3.107）

```bash
ssh szl@192.168.3.107
cd ~/projects/sse
git fetch origin && git pull --ff-only
pnpm install --frozen-lockfile
pnpm build                     # 必须：API 运行时使用 @sse/ai dist
DB_PORT=5433 pnpm migrate      # 本轮无新迁移，幂等执行即可
# 重启 pnpm dev / API / MCP
```

系统管理 → 截图识别视觉模型：勾选启用，地址 `http://192.168.3.117:11434`，模型 `qwen3-vl:8b`，
依次点「检测」「检验视觉模型」。

复测要点：

1. 智能填单：文字识别返回明细；文字 + 多个发票/文件夹合并并追加。
2. 识别出的明细带来源文件，保存后附件可下载。
3. 截图识别使用视觉模型；未启用/缺地址/缺模型提示明确。
4. 新建报销填写后刷新或触发 HMR，内容与发票文件自动恢复。
5. Token 失效时只出现顶部重新登录提示，页面内容不丢。

---

## 八、已知缺口与后续

1. **截图识别附件**：暂不支持把截图作为发票附件（后端仅收 PDF/OFD）；如需支持要放宽附件类型。
2. **批量识别接口**：当前前端顺序调用单文件接口；大量文件时可考虑新增 `/ai/parse-invoices`。
3. **草稿文件对齐**：IndexedDB 中文件按明细索引保存；极端并发（删除后立即刷新）可能错位，后续可改为稳定 `draftFileId`。
4. **草稿范围**：仅“新建报销”；编辑已有单据不启用草稿。
5. **登录后跳转**：会话过期重新登录后回到 Dashboard 而非原表单（草稿可手动回到新建页恢复）。

---

## 九、文档更新

- `README.md`：特性、最近更新、文档入口更新。
- `docs/DEPLOYMENT.md`：新增当前部署指南（视觉模型、批量发票、草稿/会话、升级步骤、验收与排障）。
- 本文：本会话开发过程记录。
