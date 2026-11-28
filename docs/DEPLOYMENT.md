# SSE 智能报销系统 — 部署指南（当前版本）

> 本文是**当前的部署与升级入口**，覆盖离线 MinIO、AI 智能填单 / 截图视觉模型、批量发票识别、草稿恢复与会话过期处理。
> 更细的历史手册见 [详细部署手册 (2026-11-09)](./2026-11-09-sse-deployment.md)（环境变量全集、反向代理、备份恢复、附录）。

---

## 1. 环境要求

| 组件 | 版本 / 说明 |
|---|---|
| Node.js | ≥ 18（仓库锁定 `pnpm@9.15.0`） |
| pnpm | 9.x |
| Docker + Compose | 最新版 |
| MinIO 镜像 | 随仓库 `images/minio/` 提供（`sse-minio:local`，离线导入） |
| PostgreSQL | `postgres:16-alpine`（Docker Hub 或离线预载） |

默认端口：API `3000`、Web `5173`、PostgreSQL `5433`、MinIO API `9002`、MinIO Console `9003`。
默认账号：`13800000000 / admin123`（首次登录后请修改密码）。

---

## 2. 最短启动路径

```bash
git clone https://github.com/abe87654321/sse.git && cd sse
pnpm install

# 首次或镜像被 prune 后：导入 MinIO 本地镜像
gunzip -c images/minio/sse-minio-local.tar.gz | docker load

docker compose up -d

# 必须先生成 dist：API 运行时引用 @sse/ai 等 workspace 的 dist 产物
pnpm build

cp .env.example .env          # 至少修改 JWT_SECRET
DB_PORT=5433 pnpm migrate     # 应用全部迁移（当前最新 028）
pnpm dev                      # 并行启动 API + Web + stdio MCP
```

Windows PowerShell：

```powershell
Copy-Item .env.example .env
$env:DB_PORT=5433; pnpm migrate
pnpm dev
```

> `pnpm dev` 是**开发模式**（Vite HMR）。共享测试机上边填表边 `git pull` 会触发页面组件重载；当前版本已加入草稿自动恢复（见 §6），但生产/正式测试仍建议用 §7 的构建产物。

---

## 3. 关键环境变量

| 变量 | 说明 |
|---|---|
| `DB_HOST/DB_PORT/DB_NAME/DB_USER/DB_PASSWORD` | 数据库连接，`pnpm migrate` 依赖 `DB_PORT` |
| `JWT_SECRET` | **生产必改**；修改后旧 token 全部失效 |
| `MINIO_ENDPOINT/MINIO_PORT/MINIO_ACCESS_KEY/MINIO_SECRET_KEY/MINIO_BUCKET` | 对象存储 |
| `AI_ENDPOINT` / `AI_MODEL` | 智能填单引擎的初始值（之后以系统管理配置为准） |
| `MINERU_TOKEN` | MinerU 云端 Token 的兜底值（系统管理里保存的值优先） |
| `ONTOLOGY_V2` | `0` 关闭 / `shadow` 影子比对 / `on` 启用 |
| `SCIM_TOKEN` / `MDM_TOKEN` / `*_SIGNING_SECRET` | 外部身份同步（生产必填） |
| `SMS_PROVIDER` / `EMAIL_PROVIDER` | `log` 为调试，生产改为 `aliyun` / `smtp` |

AI / 截图视觉 / OCR 的模型地址、密钥、模型名都在**系统管理**里配置并保存到 `ai-config.json`，修改即时生效，无需重启。

---

## 4. 系统管理中的 AI 配置

进入 **系统管理**，有三块相互独立的引擎：

### 4.1 智能填单引擎（文字识别）

- **API 地址**：OpenAI 兼容地址（填到端口或 `/v1` 即可）
- **API 密钥**：可选，保存后不回显
- **模型**：可「获取模型列表」后选择，或用「检测」验证连通性
- **检验文字识别**：用固定文本跑一次解析，返回解析条数与耗时

文字识别请求超时为 **120 秒**（vLLM / 大模型首包可能 20–60 秒）。

### 4.2 截图识别视觉模型（新增，独立配置）

截图识别**不再复用文字模型**，需要单独配置一个支持图片输入的多模态模型：

- **启用**：必须勾选（未启用时点「检验视觉模型」会提示“未启用，请勾选启用”）
- **API 地址**：如 `http://<vision-host>:11434`
- **视觉模型**：如 `qwen3-vl:8b`、`llama3.2-vision`；可「获取模型列表」选择
- **检测**：校验地址、模型列表与对话
- **检验视觉模型**：使用内置样例图 `docs/vision-fill-sample.png` 跑一次解析

错误提示会区分具体原因：

| 提示 | 处理 |
|---|---|
| 截图识别视觉模型未启用，请勾选「启用」后重试 | 打开启用开关 |
| 请先填写截图识别视觉模型的 API 地址 | 填地址并保存 |
| 请先选择截图识别视觉模型 | 获取/选择模型 |
| 截图识别视觉模型未配置完整 | 检查地址与模型是否都已保存 |

> 若视觉模型接口走 OpenAI 兼容协议，`/v1/models` 必须可达；否则「获取模型列表」会失败。

### 4.3 发票 OCR 引擎（MinerU / Paddle / 视觉）

三选一，详见 [详细部署手册 §3.2](./2026-11-09-sse-deployment.md)。MinerU 使用云端 Token：

```env
MINERU_TOKEN=<你的 MinerU Token>   # 可选；系统管理里保存的优先
```

Token 来源在面板上显示为 `已保存的配置 / 环境变量 / 未配置`；点「↩ 环境变量」或「✕ 清除」可切换/禁用。

---

## 5. AI 识别行为（当前版本）

- **文字识别**：文本框可解析自然语言；也可点击右侧「📁 发票文件」：
  - 支持**多选文件**或**选择整个文件夹**
  - 仅 `PDF / OFD`；单个 ≤ 20 MB；每次最多 **20 个**；顺序处理
  - 非发票文件、超限文件会被忽略并提示数量
  - 单个文件失败不影响其它文件，失败原因在卡片内列出
- **结果合并与填入**：文字 + 多个发票的结果统一预览，点「填入表单」**追加**到费用明细（不会清空已有明细，空占位行会被移除）
- **附件随明细**：每个发票识别出的费用会自动挂上来源文件，保存时随明细一起上传
- **截图识别**：走 §4.2 的视觉模型，与文字模型分离
- **发票上传**：单文件 `PDF / OFD` 走 §4.3 的 OCR 引擎

---

## 6. 草稿恢复与会话过期（当前版本）

### 6.1 新建报销草稿

- 新建报销页会自动保存草稿（**仅新建，不覆盖编辑中的已有单据**）：
  - **字段**（标题、说明、费用明细、AI Tab）→ `localStorage`（`sse:expense-draft:new`）
  - **待上传发票文件** → `IndexedDB`（`sse-drafts/files`）
- 进入页面自动恢复，顶部显示「已恢复上次未保存的草稿」+「放弃草稿」
- 保存草稿 / 提交成功后自动清除；有未保存内容时离开页面会触发浏览器提醒
- 因此 `git pull` 触发的 Vite HMR 重载、误刷新、登录过期后重新登录，都不会再丢内容

### 6.2 会话过期

- 任意普通接口返回 `401` 时，不再强制登出/跳转，而是：
  - 标记“会话已过期”
  - 页面顶部显示「登录已过期，请重新登录」+ 按钮
  - 登录类接口（`/auth/login`、`/auth/api-key-login`、`/auth/refresh`）的 401 不触发该提示
- 重新登录后草稿仍在，回到新建报销页即可继续

---

## 7. 生产部署

```bash
pnpm install --frozen-lockfile
pnpm build                      # 生成各包 dist 与 packages/web/dist
DB_PORT=5433 pnpm migrate
```

- **API**：`node packages/api/dist/index.js`（或用容器，见详细手册 §4.2）
- **Web**：将 `packages/web/dist/` 交给 nginx / 静态服务器，`/api` 反代到 API
- **MCP（可选）**：`MCP_HTTP_PORT=3001 pnpm mcp:http` 或 systemd `deploy/systemd/sse-mcp.service`
- 反向代理需正确设置 `TRUST_PROXY`、`X-Forwarded-For`，并只暴露必要端口

---

## 8. 升级步骤

```bash
cd /path/to/sse
git fetch origin && git pull --ff-only
pnpm install --frozen-lockfile
pnpm build                      # 必须：API 运行时使用 @sse/ai 等包的 dist
DB_PORT=5433 pnpm migrate       # 幂等，可安全重复执行
# 重启 API / Web / stdio MCP；如启用 HTTP MCP 一并重启
```

> **注意**：升级期间不要在生产用户正在填写的页面上直接触发 HMR（开发模式）。正式环境请用构建产物发布；即使发生重载，草稿也会自动恢复。

---

## 9. 验收清单

基础：

- [ ] `GET /health` / `GET /healthz` 返回 `ok`
- [ ] 默认账号可登录，修改密码后旧密码失效
- [ ] 创建报销、提交审批、财务打款、统计导出正常
- [ ] `pnpm migrate` 无报错，`schema_migrations` 含最新版本

AI：

- [ ] 智能填单「检测」通过，「检验文字识别」返回费用条目
- [ ] 截图识别视觉模型「启用 + 检测 + 检验视觉模型」通过
- [ ] 文字识别可选多个发票/文件夹，结果合并并追加到明细
- [ ] 识别出的明细带来源发票文件，保存后附件可下载
- [ ] 未启用/未配置视觉模型时，提示能明确指出缺哪一项

草稿与会话：

- [ ] 新建报销填写后刷新页面，内容与发票文件自动恢复
- [ ] 保存草稿/提交后不再恢复旧草稿
- [ ] Token 失效时只出现顶部重新登录提示，表单内容不丢

---

## 10. 排障

**AI 识别很慢或超时**：文字/发票请求超时为 120s；确认模型服务负载与首包时间。超时会在 AI 卡片内提示。

**截图识别提示“未启用/未配置”**：见 §4.2 的四种提示，逐项检查「启用 / 地址 / 模型」是否保存。

**「获取模型列表」失败**：确认视觉端点暴露 OpenAI 兼容 `/v1/models`，且 API 进程能访问该地址。

**批量发票部分失败**：失败文件名与原因会列在卡片内；成功的条目仍然保留，可单独重试。

**草稿没有恢复**：确认是“新建报销”页（编辑已有单据不启用草稿）；浏览器需允许 `localStorage` 与 `IndexedDB`。

**页面“一闪”后内容清空（旧版本）**：根因是开发服务器 HMR 重载组件。升级到当前版本后草稿会自动恢复；正式测试请用 `pnpm build` 产物。

**`Property 'visionEngine' does not exist` 或启动即报类型错误**：`@sse/ai` 的 `dist` 过期，执行 `pnpm build`（或至少 `pnpm --filter @sse/ai build`）后重启 API。

---

## 11. 相关文档

- [详细部署手册 (2026-11-09)](./2026-11-09-sse-deployment.md)
- [开发过程记录 (2026-11-28)](./2026-11-28-sse-process.md)
- [本体 v2 运行手册](./2026-11-10-ontology-v2-runbook.md)
- [MinIO 本地镜像说明](../images/minio/sse-minio-local.meta.txt)
