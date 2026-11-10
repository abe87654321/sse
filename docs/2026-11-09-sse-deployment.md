# SSE 智能报销系统 — 部署指南

> 日期：2026-11-09 | 适用：`master` | 读者：第一次部署的新手
> 更新：2026-11-10 — 增加 MCP Streamable HTTP、OpenAPI、systemd 运维与相关环境变量
> 配套文件：[README](../README.md) · [.env.example](../.env.example) · [docker-compose.yml](../docker-compose.yml) · [MinIO 镜像元信息](../images/minio/sse-minio-local.meta.txt)

本指南只回答一件事：**怎样把 SSE 从零跑起来**。

- **第 1–2 章是必做主线**，照做即可启动。
- **第 3 章是可选功能**（AI / OCR / 通知 / MCP），不配置也能使用核心报销流程。
- **第 4 章是生产部署**，第 5–6 章用于验收和排障。
- 未特别说明时，命令均在项目根目录执行，示例为 Linux/macOS 的 bash；Windows 差异见 §6.8。

> **只想先跑起来？** 直接看 [§1.5 最短启动路径](#15-最短启动路径) 和
> [§2.7 首次验收](#27-首次验收)，其余章节按需查阅。

---

## 目录

- [1. 部署前必读](#1-部署前必读)
- [2. 第一次启动（必做）](#2-第一次启动必做)
- [3. 可选功能（按需配置）](#3-可选功能按需配置)
- [4. 生产部署（进阶）](#4-生产部署进阶)
- [5. 验收清单](#5-验收清单)
- [6. 排障手册](#6-排障手册)
- [附录](#附录)

---

## 1. 部署前必读

### 1.1 三种部署方式怎么选

| 场景 | 需要准备 | 阅读章节 |
|---|---|---|
| 本地开发 / 演示 | Node、pnpm、Docker | 第 1–2 章 |
| 内网 / 离线演示 | 同上 + 本地 MinIO 镜像 + PostgreSQL 镜像 | 第 1–2 章，重点看 §1.4 |
| 生产环境 | 反向代理、HTTPS、备份、监控、独立 Web 静态服务 | 第 4 章，第 3 章按需 |

> SSE 是 monorepo。开发模式下 **API、Web、MCP 跑在宿主机**，Docker 只负责 PostgreSQL 和 MinIO。
> 生产环境需要分别部署 API（Node 容器或进程）和 Web（静态文件 + Nginx）。

### 1.2 环境要求

| 组件 | 要求 | 说明 |
|---|---|---|
| Node.js | ≥ 18，推荐 20 LTS | `package.json` 要求 `>=18` |
| pnpm | ≥ 9 | 仓库锁定 `pnpm@9.15.0` |
| Docker Engine | 最新稳定版 | 运行 PostgreSQL + MinIO |
| Docker Compose | **v2**（`docker compose`，空格） | 不要使用 Python 版 `docker-compose`（v1） |
| Git | 任意近期版本 | 拉取代码 |
| 磁盘 | ≥ 3 GB 可用 | 镜像解压约 123 MB + 依赖 + 数据卷 |
| 端口 | 3000、5173、5433、9002、9003 未被占用 | 见 §1.3 |

检查命令：

```bash
node -v
pnpm -v
docker compose version    # 应 ≥ 2.0
```

### 1.3 端口、数据卷与默认账号

| 服务 | 访问地址 | 宿主机端口 | 容器内端口 |
|---|---|---|---|
| API | `http://localhost:3000` | 3000 | —（宿主机进程） |
| Web | `http://localhost:5173` | 5173 | —（宿主机进程） |
| PostgreSQL | `localhost:5433` | 5433 | 5432 |
| MinIO API | `localhost:9002` | 9002 | 9000 |
| MinIO Console | `http://localhost:9003` | 9003 | 9001 |

> **最容易踩的坑**：`.env` 里必须写**宿主机端口** `DB_PORT=5433`、`MINIO_PORT=9002`，
> 不要写容器内端口 `5432` / `9000`。

Docker 数据卷：

| 卷名 | 存放内容 | 删除方式 |
|---|---|---|
| `pgdata` | PostgreSQL 业务数据 | `docker compose down -v` |
| `miniodata` | 发票、回单、头像等附件 | `docker compose down -v` |

> ⚠️ `docker compose down -v` 会**永久删除以上两个数据卷**。只有确认数据可丢弃时才使用。

默认管理员（由迁移脚本创建）：

| 字段 | 值 |
|---|---|
| 手机号 | `13800000000` |
| 密码 | `admin123` |
| 角色 | 管理员（admin） |

> 首次登录后请立即修改密码。

### 1.4 离线 / 内网部署说明

`docker-compose.yml` 中的 MinIO 已改为本地镜像 `sse-minio:local`，**不会访问 Docker Hub**：

```yaml
minio:
  image: sse-minio:local
```

镜像包随仓库放在 `images/minio/`：

| 文件 | 用途 |
|---|---|
| `sse-minio-local.tar.gz` | 镜像压缩包（约 43 MB，解压后约 123 MB） |
| `sse-minio-local.tar.gz.sha256` | SHA-256 校验和 |
| `sse-minio-local.meta.txt` | 版本、构建信息、安全说明 |

首次启动、换机，或执行过 `docker image prune -a` / `docker system prune -a` 后，
必须先导入镜像，步骤见 §2.2。

> **PostgreSQL 镜像仍需单独准备**：`docker-compose.yml` 使用 `postgres:16-alpine`。
> 完全离线的机器如果本地没有该镜像，`docker compose up -d` 仍会尝试联网。
> 可在一台有网的机器上导出后拷贝：
>
> ```bash
> docker pull postgres:16-alpine
> docker save postgres:16-alpine -o postgres-16-alpine.tar
> # 拷贝到离线机器后：
> docker load -i postgres-16-alpine.tar
> ```

镜像是 `linux/amd64`。ARM 主机（如 Apple Silicon）需要开启 Docker Desktop 的 amd64 模拟，
否则可能报 `exec format error`。

### 1.5 最短启动路径

已经熟悉 Docker 和 Node 的读者，可以直接执行下面的最短路径；每一步的详细说明在后面。

```bash
git clone https://github.com/abe87654321/sse.git && cd sse
pnpm install

# 导入 MinIO 本地镜像（首次或镜像被清理后）
cd images/minio
gunzip -c sse-minio-local.tar.gz | docker load
cd ../..

docker compose up -d
cp .env.example .env
# 编辑 .env：至少修改 JWT_SECRET

pnpm build
pnpm migrate
pnpm dev
```

README 的 Quick Start 与本路径一致。Windows 用户请先阅读 §2.2.2 和 §6.8。

---

## 2. 第一次启动（必做）

### 2.1 获取代码并安装依赖

```bash
git clone https://github.com/abe87654321/sse.git
cd sse
pnpm install
```

> 仓库地址：`https://github.com/abe87654321/sse`。
> 已配置 SSH 的机器也可以使用：`git@github.com:abe87654321/sse.git`。

`pnpm install` 会安装所有 workspace 依赖，包括开发脚本使用的 `concurrently`。

### 2.2 导入 MinIO 镜像

`docker-compose.yml` 使用 `sse-minio:local`，不再使用 `minio/minio`。
如果镜像不存在，`docker compose up -d` 会报 `pull access denied for sse-minio`
或 `No such image: sse-minio:local`。

#### 2.2.1 Linux / macOS

```bash
cd images/minio

# ① 校验压缩包（必须通过；失败说明文件损坏，重新获取）
sha256sum -c sse-minio-local.tar.gz.sha256
# macOS 用：shasum -a 256 -c sse-minio-local.tar.gz.sha256

# ② 导入镜像（无需先解压到磁盘）
gunzip -c sse-minio-local.tar.gz | docker load

cd ../..
```

#### 2.2.2 Windows PowerShell

```powershell
cd images\minio

# ① 校验压缩包，输出应与 .sha256 文件中的值一致
Get-FileHash .\sse-minio-local.tar.gz -Algorithm SHA256
# 期望：AD39EEF348551352BE1C04699BCA557BFBA9455FA09E0E4D6C5F6196247EAE7F

# ② 解压后导入（Windows 10/11 自带 tar）
tar -xzf sse-minio-local.tar.gz
docker load -i sse-minio-local.tar
Remove-Item sse-minio-local.tar

cd ..\..
```

#### 2.2.3 验证与常见错误

验证镜像：

```bash
docker image inspect sse-minio:local --format '{{.Id}}'
docker run --rm --entrypoint /usr/bin/minio sse-minio:local --version
# 期望：minio version RELEASE.2025-09-07T16-13-09Z (commit-id=07c3a429...)
```

| 现象 | 原因 | 处理 |
|---|---|---|
| `pull access denied for sse-minio` | 镜像未导入，或已被 prune | 重新执行本节导入命令 |
| `No such image: sse-minio:local` | 同上 | 同上 |
| `archive/tar: invalid tar header` | 把 `.tar.gz` 直接传给了 `docker load -i` | 用 `gunzip -c ... \| docker load` 或先 `tar -xzf` |
| SHA-256 不一致 | 文件在复制/下载时损坏 | 重新获取镜像包 |
| `exec format error` | 当前平台不是 `linux/amd64` | 开启 amd64 模拟，或使用 amd64 主机 |

> **安全提示**：镜像版本为 MinIO `RELEASE.2025-09-07T16-13-09Z`，早于 2025-10 的 CVE 修复。
> SSE 使用单一 root 账号、不启用 STS/服务账号/集群，当前用法不受影响；
> 生产环境建议升级到 `RELEASE.2025-10-15T17-29-55Z` 或更新版本。详见
> `images/minio/sse-minio-local.meta.txt`。

### 2.3 启动 PostgreSQL 和 MinIO

```bash
docker compose up -d
docker compose ps
```

预期看到两个容器处于 `Up` 状态，端口映射为 `5433`、`9002`、`9003`。

查看日志：

```bash
docker compose logs -f postgres
docker compose logs -f minio
```

启动失败时先看 §6.2。

### 2.4 创建 .env

```bash
cp .env.example .env
# Windows PowerShell: Copy-Item .env.example .env
```

打开 `.env`，**至少修改** `JWT_SECRET`：

```env
JWT_SECRET=请替换为一段足够长的随机字符串
```

同时确认以下两项是宿主机端口：

```env
DB_PORT=5433
MINIO_PORT=9002
```

最小配置中通常不需要改动：

```env
DB_HOST=localhost
DB_NAME=sse
DB_USER=sse
DB_PASSWORD=sse_dev

MINIO_ENDPOINT=localhost
MINIO_ACCESS_KEY=minioadmin
MINIO_SECRET_KEY=minioadmin
MINIO_BUCKET=invoices
```

> 完整变量列表见 [附录 A](#a-环境变量速查) 和 [.env.example](../.env.example)。
> 开发环境保持 `SMS_PROVIDER=log`、`EMAIL_PROVIDER=log` 即可，不需要真实短信/邮箱。

### 2.5 编译并执行数据库迁移

```bash
pnpm build
pnpm migrate
```

说明：

- `pnpm migrate` 实际执行的是 `node dist/migrate.js up`，所以**必须先 `pnpm build`**。
- 迁移器会按编号顺序应用 `packages/db/src/migrations/` 下所有未执行的 `.sql`，
  并把版本记录到 `schema_migrations` 表。
- 可以安全重复执行；已应用的迁移不会重复运行。
- **不要手动执行 `001_initial.sql`、`002_notifications.sql`、`009_mcp_api_keys.sql`**，
  统一交给 `pnpm migrate`。

验证迁移结果：

```bash
docker exec -i sse-postgres-1 psql -U sse -d sse \
  -c "SELECT version, applied_at FROM schema_migrations ORDER BY version;"
```

如果修改过数据库端口：

```bash
DB_PORT=5433 pnpm migrate
# Windows PowerShell: $env:DB_PORT=5433; pnpm migrate
```

### 2.6 启动服务

推荐一键启动：

```bash
pnpm dev
```

`pnpm dev` 会并行启动三个进程：

| 进程 | 命令 | 说明 |
|---|---|---|
| API | `pnpm --filter @sse/api dev` | Express，端口 3000 |
| Web | `pnpm --filter @sse/web dev --host` | Vite，端口 5173，允许外部访问 |
| MCP | `pnpm mcp` | 先编译 `@sse/mcp`，再启动 stdio MCP Server |

按一次 `Ctrl+C` 会停止全部三个进程；任一进程退出时，`concurrently -k` 也会终止其余进程。

需要单独调试时，分别在三个终端执行：

```bash
pnpm --filter @sse/api dev
pnpm --filter @sse/web dev --host
pnpm mcp
```

> Web 必须带 `--host` 才能从其他机器访问，否则只监听 `localhost`。
>
> MCP 是可选能力。如果不需要 Agent 调用，可以只用上面的单进程命令启动 API 和 Web，
> 避免 MCP 编译问题影响主流程。

### 2.7 首次验收

完成以下检查，说明基础部署成功：

| 检查项 | 操作 | 期望结果 |
|---|---|---|
| 容器状态 | `docker compose ps` | PostgreSQL、MinIO 均为 `Up` |
| MinIO 控制台 | 打开 `http://<server-ip>:9003` | 能用 `minioadmin / minioadmin` 登录 |
| API 登录 | 见下方 curl | 返回 `accessToken` |
| Web 页面 | 打开 `http://<server-ip>:5173` | 登录页正常显示 |
| 默认账号 | `13800000000 / admin123` | 能登录进入系统 |

API 登录验证：

```bash
curl -s -X POST http://localhost:3000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"phone":"13800000000","password":"admin123"}'
```

返回中包含 `accessToken` 即表示 API、数据库、迁移都正常。

---

## 3. 可选功能（按需配置）

以下功能不影响核心报销流程，可以全部跳过。

### 3.1 AI 模型（智能填单 + 视觉 OCR）

SSE 的“说话报销”和视觉发票识别依赖 OpenAI 兼容的模型服务。

#### 3.1.1 使用本地 Ollama

```bash
curl -fsSL https://ollama.com/install.sh | sh
ollama pull llama3.2-vision:11b
ollama list
curl http://localhost:11434/v1/models
```

#### 3.1.2 在管理后台配置

1. 登录 SSE，进入 **管理后台 → AI 模型配置**
2. 端点填 `http://localhost:11434/v1/chat/completions`
3. 模型填 `llama3.2-vision`
4. 点击“保存配置”
5. 点击“检验文字识别”和“检验图像 OCR”

配置保存在项目根目录 `ai-config.json`，修改后即时生效，无需重启 API。

#### 3.1.3 环境变量预设

`.env` 可预置初始值（之后仍可在后台修改）：

```env
AI_ENDPOINT=http://localhost:11434/v1/chat/completions
AI_MODEL=llama3.2-vision
```

#### 3.1.4 使用云端 OpenAI 兼容服务

在管理后台把端点改为云端地址（如 `https://api.openai.com/v1/chat/completions`），
模型改为对应名称（如 `gpt-4o`），并在后台的 **API Key** 输入框填写密钥。
密钥会写入 `ai-config.json`，不需要改 `.env`。

> 没有 GPU 也可以运行 Ollama，但纯 CPU 速度较慢（每条识别约 5–30 秒），建议至少 8 GB 内存。

### 3.2 发票 OCR 引擎（三选一）

在管理后台 **发票 OCR 引擎** 面板选择。三种方案任选其一，也可以暂时不配置。

> **PDF 处理方式**：MinerU 与视觉模型引擎会自动处理 PDF ——
> 电子发票（PDF 带文本层）保持 PDF 直接送引擎；扫描件会先渲染并裁掉页面白边再送识别，
> 避免引擎的版面分析跳过带边框的内容区（见 §6.5）。
> PaddleOCR 方案则把原始文件直接发给你的自建服务，由该服务自行处理 PDF/图片。

#### 方案 A：MinerU（推荐）

MinerU 适合中文 PDF 发票，输出结构化 Markdown。系统调用的是 **MinerU 云端 API**：

```bash
# 无需本地部署 MinerU，只需一个云端 Token
```

Token 在 [MinerU 开放平台](https://mineru.net) 获取，两种配置方式：

```env
# 方式一：环境变量（推荐，便于容器化部署）
# .env
MINERU_TOKEN=<你的 MinerU Token>
```

后台配置：

```text
引擎: MinerU
端点: https://mineru.net
Token: 粘贴上面的 Token（保存后不再回显）
```

> **Token 来源优先级**：系统管理里已保存的 MinerU Token > `.env` 的 `MINERU_TOKEN`；
> 在系统管理点「↩ 环境变量」可交还给 `.env`，点「✕ 清除」则完全禁用（含 `.env`）。
> 当前生效来源见系统管理面板下方提示，或 `GET /admin/ai-config` 的
> `ocrEngine.mineruTokenSource`（`saved` / `env` / `none`）。

#### 方案 B：PaddleOCR

```bash
pip install paddlepaddle paddleocr flask
# 适配器结构与附录 D 的自建方案相同，端口示例 8899
```

后台配置：

```text
引擎: PaddleOCR
端点: http://<paddle-ip>:8899
```

#### 方案 C：视觉模型

直接复用 Ollama 视觉模型，无需额外服务：

```text
引擎: 视觉模型
端点: http://<ollama-ip>:11434/v1/chat/completions
模型: llama3.2-vision（或 glm-ocr 等）
```

> OCR 不可用时，发票自动识别会关闭；打款回单核对会标记为 `unverified`，
> 需要人工复核，不影响报销和打款主流程。

### 3.3 通知通道（邮件 / 短信）

站内通知始终启用。邮件和短信是补充通道，开发环境保持 `log` 即可。

```env
SMS_PROVIDER=log
EMAIL_PROVIDER=log
```

#### 3.3.1 邮件通道：163 邮箱 SMTP

1. 登录 [163 邮箱](https://mail.163.com)
2. 进入 **设置 → POP3/SMTP/IMAP**
3. 开启 **SMTP 服务**
4. 完成验证，获取 **授权码**（不是邮箱登录密码）

`.env` 配置：

```env
EMAIL_PROVIDER=smtp
EMAIL_HOST=smtp.163.com
EMAIL_PORT=465
EMAIL_USER=your-email@163.com
EMAIL_PASS=your-auth-code
EMAIL_FROM=your-email@163.com
```

其他邮箱：

| 邮箱 | SMTP |
|---|---|
| QQ 邮箱 | `smtp.qq.com:465`（需生成授权码） |
| Gmail | `smtp.gmail.com:587`（需两步验证 + 应用专用密码） |

#### 3.3.2 阿里云短信

1. 登录 [阿里云控制台](https://console.aliyun.com)，开通 **短信服务**
2. 在 **国内消息 → 签名管理** 添加签名（审核 1–2 个工作日）
3. 在 **国内消息 → 模板管理** 申请**通知类**模板
4. 在 **AccessKey 管理** 获取 AccessKey ID / Secret

`.env` 配置：

```env
SMS_PROVIDER=aliyun
ALIYUN_ACCESS_KEY_ID=your-access-key-id
ALIYUN_ACCESS_KEY_SECRET=your-access-key-secret
ALIYUN_SMS_SIGN_NAME=审批通知
```

按事件配置模板 CODE（优先使用；未配置时回退到通用模板）：

```env
# 提醒 / 升级 / 驳回 / 打款：模板变量统一为 ${code}，值为报销单号
ALIYUN_SMS_TEMPLATE_REMINDER=SMS_...
ALIYUN_SMS_TEMPLATE_ESCALATION=SMS_...
ALIYUN_SMS_TEMPLATE_REJECTED=SMS_...
ALIYUN_SMS_TEMPLATE_PAID=SMS_...

# 广播：建议使用固定文案，不带变量
ALIYUN_SMS_TEMPLATE_BROADCAST=SMS_...

# 通用回退模板
ALIYUN_SMS_TEMPLATE_CODE=SMS_123456789
```

> **重要**：验证码模板不能用于通知文本。阿里云限制验证码模板变量只能是 `[a-zA-Z0-9]`，
> 必须申请**通知类**模板。短信 SDK 已随 `@sse/notifications` 安装，无需额外 `pnpm add`。

#### 3.3.3 通知偏好

用户可在 **个人资料 → 通知偏好** 中分别开关站内、邮件、短信的提醒/升级/驳回/打款通知。
默认值：

| 事件 | 短信 | 邮件 | 站内 |
|---|---|---|---|
| 超时提醒 | 开 | 开 | — |
| 超时升级 | 开 | 开 | — |
| 驳回 | 关 | 开 | 开 |
| 打款 | 开 | 关 | 开 |

### 3.4 MCP Server 与 Agent 接入

MCP 用于让 AI Agent 查询/创建报销单。不需要 Agent 时可以跳过。

#### 3.4.1 先理解两个变量

MCP 鉴权涉及两个不同的环境变量，名字很像，作用不同：

| 变量 | 作用 | 示例 |
|---|---|---|
| `MCP_API_KEYS` | 定义“密钥 → 用户身份”的映射表，多个用逗号分隔 | `mcp_key_001=<uuid>:admin:管理部` |
| `MCP_API_KEY` | stdio 模式下默认使用的密钥（客户端不传 `api_key` 时）；HTTP 模式不使用 | `mcp_key_001` |

最简单的配置是**两个都写**：

```env
MCP_API_KEYS=mcp_key_001=<admin-id>:admin:管理部
MCP_API_KEY=mcp_key_001
```

> 只写 `MCP_API_KEYS` 时，如果 stdio 客户端不主动传 `api_key`，服务端无法确定使用哪把密钥。
> HTTP / OpenAPI 模式不走这个兜底：每个请求必须自带 `Authorization: Bearer <key>`。

#### 3.4.2 获取管理员 UUID

```bash
docker exec -i sse-postgres-1 psql -U sse -d sse \
  -c "SELECT id, name, role FROM users WHERE role='admin';"
```

把输出的 `id` 填入上面的 `<admin-id>`。

#### 3.4.3 配置密钥

写入项目根目录 `.env`（推荐，重启后仍生效）：

```env
MCP_API_KEYS=mcp_key_001=3e856835-07c0-41b8-9ae1-f33ef17ce80c:admin:管理部
MCP_API_KEY=mcp_key_001
```

也支持把密钥持久化到数据库表 `mcp_api_keys`（迁移 009 已由 `pnpm migrate` 自动创建）。
无论用哪种来源，`MCP_API_KEY` 或客户端传入的 `api_key` 必须是映射表中存在的 key。

#### 3.4.4 启动与验证

手动启动（会先编译）：

```bash
pnpm mcp
```

`pnpm dev` 已经包含 `pnpm mcp`，开发时通常不需要单独执行。

Agent 的 `mcp.json` 示例（由 Agent 自己拉起 MCP 进程）：

```json
{
  "mcpServers": {
    "sse": {
      "command": "node",
      "args": ["/absolute/path/to/sse/packages/mcp/dist/index.js"],
      "env": {
        "MCP_API_KEY": "mcp_key_001",
        "MCP_API_KEYS": "mcp_key_001=<admin-id>:admin:管理部"
      }
    }
  }
}
```

> MCP Server 通过 stdio 通信。`pnpm dev` 里的 MCP 进程主要用于本地编译和冒烟；
> 真正接入 Agent 时，由 Agent 按上面的配置启动独立进程。

#### 3.4.5 HTTP 传输（推荐远程 Agent）

`pnpm mcp:http` 以 HTTP 方式启动同一个 MCP Server：

| 端点 | 用途 |
|---|---|
| `POST/GET/DELETE /mcp` | Streamable HTTP（Claude Code / Cursor / VS Code 等） |
| `GET /sse` + `POST /messages` | 旧版 HTTP+SSE 兼容（`MCP_LEGACY_SSE=0` 关闭） |
| `GET /healthz` | 健康检查 |

```bash
MCP_HTTP_PORT=3001 pnpm mcp:http
curl -s http://127.0.0.1:3001/healthz
```

鉴权：每个请求都必须带 `Authorization: Bearer <mcp-api-key>`。HTTP 模式**不使用**
`MCP_API_KEY` 作为默认兜底；身份按请求解析，多个 key 并发互不串用。会话数、请求体
大小可分别用 `MCP_MAX_SESSIONS`、`MCP_MAX_BODY_BYTES` 限制。

数据库中的 `mcp_api_keys` 会按 `MCP_KEY_REFRESH_MS`（默认 60s）刷新，角色/部门以
`users` 表为准；禁用用户或停用 key 最多在该周期内失效。迁移 014 支持 `expires_at`
过期时间，过期 key 会被拒绝。

按用户限流（`MCP_RATE_LIMIT_PER_MIN`，默认 120/分钟）与审计日志（`MCP_AUDIT_LOG`，
stderr JSON）在 MCP 进程内生效；多实例部署时各自计数，如需全局配额请在前置网关限流。

客户端 `mcpServers` 示例（字段名因客户端而异）：

```json
{
  "mcpServers": {
    "sse": {
      "type": "http",
      "url": "http://<server-ip>:3001/mcp",
      "headers": { "Authorization": "Bearer mcp_key_001" }
    }
  }
}
```

> `MCP_API_KEYS` / `MCP_API_KEY` 仍用于 stdio 和 key 校验；HTTP 只需要 key 本身有效。

#### 3.4.6 非 MCP Agent（OpenAPI）

不支持 MCP 的 Agent / 编排平台（LangChain、Dify、n8n 等）可直接用 REST：

1. `GET /openapi.json` 拉取 OpenAPI 3.1 规范（公开，无需鉴权）
2. `POST /auth/api-key-login`，body `{ "apiKey": "mcp_key_001" }` 换 `accessToken`
3. 之后所有请求带 `Authorization: Bearer <accessToken>`

角色和部门随 key 绑定，服务端自动做数据范围过滤，与 MCP 一致。

#### 3.4.7 systemd 托管（Linux）

仓库提供 `deploy/systemd/sse-mcp.service`，按实际路径调整 `User` / `WorkingDirectory` /
`ExecStart` 后安装：

```bash
sudo cp deploy/systemd/sse-mcp.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now sse-mcp
curl -s http://127.0.0.1:3001/healthz
```

### 3.5 通知调度器

审批提醒调度器已集成到 API 服务中，`pnpm --filter @sse/api dev` 或 `pnpm dev`
启动后自动运行，每 15 分钟扫描超时待审批记录。无需手动启动。

如需独立调试：

```bash
pnpm --filter @sse/notifications build
node packages/notifications/dist/scheduler.js
```

---

## 4. 生产部署（进阶）

> 本章是指导性示例，不是“一键生产方案”。生产环境还需要反向代理、HTTPS、
> 进程守护、日志、监控和备份策略。

### 4.1 构建

```bash
pnpm build
```

编译产物在各包的 `dist/` 目录，Web 产物在 `packages/web/dist/`。

### 4.2 API 容器示例

下面是一个**最小可用**的 API 镜像示例，已修正旧文档只 COPY 部分 workspace 包的问题：

```dockerfile
FROM node:20-alpine AS build
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages ./packages
RUN pnpm install --frozen-lockfile
RUN pnpm build

FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app /app
EXPOSE 3000
CMD ["node", "packages/api/dist/index.js"]
```

构建与运行：

```bash
docker build -t sse-api:local .
docker run -d --name sse-api \
  --env-file .env \
  -p 3000:3000 \
  sse-api:local
```

注意：

- 容器**不会自动执行迁移**。首次启动前，请在能访问数据库的环境执行 `pnpm migrate`。
- `.env` 中的 `DB_HOST`、`MINIO_ENDPOINT` 要指向容器可访问的地址，不能写 `localhost`
  （除非使用 host 网络或同容器网络）。
- 该示例把整个构建目录复制进运行镜像，镜像偏大；生产可进一步用 `pnpm deploy` 或
  多阶段裁剪，仅保留运行所需文件。
- **Web 不包含在此镜像中**，见 §4.3。

### 4.3 Web 静态部署

```bash
pnpm --filter @sse/web build
# 产物：packages/web/dist/
```

把 `dist/` 交给 Nginx 或任意静态服务器。Web 默认请求 `/api`，因此需要把 `/api`
反向代理到 API 服务，并去掉前缀：

```nginx
server {
    listen 80;
    server_name your-domain.example.com;

    root /usr/share/nginx/html;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }

    location /api/ {
        proxy_pass http://127.0.0.1:3000/;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

如果前后端不在同一域名下，也可以在构建时设置 `VITE_API_BASE` 指向完整 API 地址：

```bash
VITE_API_BASE=https://api.example.com pnpm --filter @sse/web build
```

### 4.4 生产环境变量

生产环境至少确认：

- `NODE_ENV=production`
- `JWT_SECRET` 为随机强密钥
- `DB_*`、`MINIO_*` 指向生产实例，端口为生产实际端口
- 关闭开发默认值：修改 `DB_PASSWORD`、MinIO 账号密码
- `SMS_PROVIDER` / `EMAIL_PROVIDER` 按需开启
- `MCP_API_KEYS` / `MCP_API_KEY` 按最小权限分配

完整变量见 [附录 A](#a-环境变量速查) 与 [.env.example](../.env.example)。

### 4.5 升级与迁移顺序

```bash
git pull
pnpm install

# 如果 MinIO 镜像被清理，重新导入
cd images/minio
gunzip -c sse-minio-local.tar.gz | docker load
cd ../..

pnpm build
pnpm migrate          # 先迁移，再重启 API
# 重启 API / Web / 反向代理（以及 MCP HTTP 服务）
```

迁移必须在 API 重启前完成，否则新代码可能查询尚不存在的列/表。

> 若升级包含 MCP 依赖变更（如 SDK 1.x + zod），`pnpm install` 不可跳过；
> 重启 MCP HTTP 服务后访问 `/healthz` 确认。

### 4.6 备份与恢复

需要同时备份两个存储：

| 存储 | 内容 | 方式 |
|---|---|---|
| PostgreSQL | 业务数据 | `pg_dump` / 数据卷快照 |
| MinIO | 发票、回单、头像 | `mc mirror` / 数据卷快照 |

只备份数据库会丢失附件，只备份 MinIO 会丢失业务数据，两者必须成对备份。

项目另有一套离线备份/恢复工具（见交付目录 `docs/handover-docs/`），
支持从旧盘直接解析 PostgreSQL 和 MinIO 数据，适合灾难恢复场景。

---

## 5. 验收清单

### 5.1 基础服务

- [ ] `docker compose ps`：PostgreSQL、MinIO 均为 `Up`
- [ ] `docker compose logs postgres` 无致命错误
- [ ] `docker compose logs minio` 无致命错误
- [ ] `pnpm migrate` 执行成功，`schema_migrations` 有记录
- [ ] `pnpm dev` 输出 `[api]`、`[web]`、`[mcp]` 三个前缀
- [ ] `http://<server-ip>:9003` 能打开 MinIO 控制台
- [ ] `http://<server-ip>:5173` 能打开登录页

### 5.2 核心业务

- [ ] 用 `13800000000 / admin123` 登录成功
- [ ] 能创建报销单（文字或发票上传）
- [ ] 能提交审批
- [ ] 审批人能看到待办并审批
- [ ] 财务能打款（填写凭证号或上传回单）
- [ ] 已打款单据不能删除
- [ ] 能查看统计和导出

### 5.3 可选功能

- [ ] AI 模型“检验文字识别”成功
- [ ] OCR 引擎“检验图像 OCR”成功
- [ ] 邮件/短信实际收到（或日志显示发送成功）
- [ ] MCP 工具能返回数据
- [ ] `curl -s http://127.0.0.1:3001/healthz` 返回 `status: ok`
- [ ] `POST /mcp` initialize + `tools/list` 返回 18 个工具
- [ ] `GET /openapi.json` 返回 OpenAPI 3.1；`POST /auth/api-key-login` 能换到 JWT
- [ ] 通知偏好开关生效

---

## 6. 排障手册

### 6.1 通用排查顺序

遇到问题先按这个顺序检查，通常能定位 80% 的部署问题：

```bash
docker compose ps
docker compose logs --tail=100 postgres
docker compose logs --tail=100 minio
cat .env
node -v && pnpm -v && docker compose version
```

然后确认：

1. `.env` 端口是否是宿主机端口（5433 / 9002）
2. 是否先 `pnpm build` 再 `pnpm migrate`
3. 是否导入了 `sse-minio:local` 镜像
4. API/Web 进程是否真的在运行，端口是否被占用

### 6.2 Docker / MinIO

**Q: `permission denied while trying to connect to the Docker daemon socket`**

```bash
# 方式一：临时提权
sudo docker compose up -d

# 方式二：加入 docker 组（需重新登录）
sudo usermod -aG docker $USER
```

**Q: `port is already allocated`**

```bash
sudo lsof -i :5433
sudo lsof -i :9002
sudo lsof -i :9003

# 若为其他容器占用
sudo docker rm -f <container-name>
```

**Q: `docker-compose` 报 `'ContainerConfig'` 或 `KeyError`**

使用的是 Python 版 v1，改用 Docker 内置 v2：

```bash
sudo docker-compose up -d     # 错误
sudo docker compose up -d      # 正确
docker compose version         # 应 ≥ 2.0
```

**Q: 旧容器残留导致启动失败**

```bash
sudo docker rm -f sse-postgres-1 sse-minio-1
sudo docker compose up -d
```

**Q: `pull access denied for sse-minio` / `No such image: sse-minio:local`**

镜像未导入，或被执行过 `docker image prune -a` / `docker system prune -a` 清理掉了。

```bash
cd images/minio && gunzip -c sse-minio-local.tar.gz | docker load && cd ../..
sudo docker compose up -d
```

**Q: `docker load` 报 `archive/tar: invalid tar header`**

传入的是 gzip 压缩包，不是未压缩的 tar：

```bash
# 方式一
gunzip -c images/minio/sse-minio-local.tar.gz | docker load

# 方式二
cd images/minio
tar -xzf sse-minio-local.tar.gz
docker load -i sse-minio-local.tar
```

**Q: 如何确认镜像已正确导入？**

```bash
docker image inspect sse-minio:local --format '{{.Id}}'
docker run --rm --entrypoint /usr/bin/minio sse-minio:local --version
```

**Q: MinIO 控制台无法访问**

浏览器打开 `http://<server>:9003`（不是 9001），账号 `minioadmin / minioadmin`。

**Q: 内网/离线环境能否使用？**

可以。MinIO 使用本地镜像；但 PostgreSQL 镜像 `postgres:16-alpine` 仍需提前导入，
见 §1.4。

### 6.3 数据库 / 迁移

**Q: 数据库迁移失败**

先确认 PostgreSQL 已启动，再确认已执行 `pnpm build`：

```bash
docker compose ps
docker exec -i sse-postgres-1 psql -U sse -d sse -c "SELECT 1"
pnpm build
pnpm migrate
```

**Q: 迁移报错 `role "sse" does not exist`**

说明数据卷状态异常。可以重建（**会删除数据**）：

```bash
sudo docker compose down -v
sudo docker compose up -d
pnpm build
DB_PORT=5433 pnpm migrate
```

> 只有确认数据可丢弃时才执行 `down -v`。已有业务数据请先备份。

**Q: `migrate` 报 `ENOENT: .../dist/migrations/001_initial.sql`**

TS 编译不会复制 `.sql` 文件。确认 `migrate.ts` 读取的是 `src/migrations/`：

```typescript
// 正确
join(__dirname, '..', 'src', 'migrations', '001_initial.sql')

// 错误（dist 下没有）
join(__dirname, 'migrations', '001_initial.sql')
```

然后重新 `pnpm --filter @sse/db build` 再迁移。

**Q: `migrate` 报 `ECONNREFUSED 127.0.0.1:5432`**

默认是 5433。显式指定：

```bash
DB_PORT=5433 pnpm migrate
```

**Q: 如何判断迁移是否全部完成？**

```bash
docker exec -i sse-postgres-1 psql -U sse -d sse \
  -c "SELECT version FROM schema_migrations ORDER BY version;"
```

### 6.4 API / Web

**Q: 启动 API 报 `EADDRINUSE: address already in use 0.0.0.0:3000`**

```bash
fuser 3000/tcp
fuser -k 3000/tcp
# 或
lsof -ti:3000 | xargs kill -9
```

**Q: 前端无法从其他机器访问（只显示 localhost:5173）**

Vite 默认只监听本地，启动时加 `--host`：

```bash
pnpm --filter @sse/web dev --host
# 或直接 pnpm dev（已包含 --host）
```

**Q: 前端无法连接 API**

开发模式由 Vite 代理 `/api` 到 `http://localhost:3000`。确认 API 在 3000 端口运行：

```bash
curl -s -X POST http://localhost:3000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"phone":"13800000000","password":"admin123"}'
```

**Q: Web 构建失败**

确认 `vue-tsc` 版本 ≥ 2.0（当前依赖已满足），并先执行 `pnpm install`。

### 6.5 AI / OCR

**Q: AI 检验按钮报“连接失败”**

```bash
ollama serve
systemctl start ollama
curl http://localhost:11434/v1/models
```

**Q: 智能填单返回“未解析到结构化数据”**

1. 换更强的视觉模型（如 `llama3.2-vision:90b`，需要更多显存）
2. 确认输入文本包含可识别的金额/类别信息
3. 在管理后台调整模型名称并重新检验

**Q: 没有 GPU 能跑吗？**

可以。Ollama 支持纯 CPU，但速度较慢（每条 5–30 秒），建议至少 8 GB 内存。

**Q: OCR 一直 `unverified`？**

说明没有可用的 OCR 引擎或引擎调用失败。到管理后台检查 OCR 端点、模型和网络连通性；
也可以先人工复核，不影响报销主流程。

**Q: OCR 报“MinerU 认证失败：Token 无效或已过期”，但 Token 明明是对的？**

先看系统管理 → 发票 OCR 引擎下方的「当前生效来源」：

| 显示 | 含义 | 处理 |
|---|---|---|
| `已保存的配置（ai-config.json）` | 系统管理里保存的 Token 在生效，`.env` 里的不生效 | 在同一面板重新粘贴 Token 保存，或点「↩ 环境变量」改用 `.env` |
| `环境变量 MINERU_TOKEN` | 用的是 `.env` 的值 | 确认 `.env` 在 **API 进程的工作目录**下、且改完后重启过 API |
| `未配置` | 没有可用 Token | 在系统管理里粘贴 Token，或在 `.env` 配 `MINERU_TOKEN` 后重启 |

**Q: 打款回单只识别出「经办／复核／授权／回单编号」一行，金额和日期都是空的？**

这是引擎的版面分析跳过了整块内容：回单主体被放在带边框的矩形里，而整页留白很大时，
引擎会把该矩形判成图片块而只 OCR 框外文字。系统已内置处理——扫描件会先渲染并裁掉白边再送识别。

若仍出现：

1. 确认版本已包含 `fix(ai): render and trim scan-like documents before OCR` 之后的提交；
2. 在系统管理 → 发票 OCR 引擎 点一次「检验」，看原始识别文本是否已包含「交易金额」；
3. 若原始文本里也没有金额，说明上游引擎没抽到该字段（例如金额在扫描图里而非文本层），
   需人工复核或换用更高分辨率的原件。

**Q: 回单金额识别成了 `19`（真实金额是 19,999）？**

引擎把千分位逗号后加了空格，输出成 `19, 999.00`。系统已做归一化处理；
若仍出现，确认版本包含 `fix(ai): render and trim scan-like documents before OCR`，
并点「重新识别」重跑一次（历史结果不会自动重算）。

**Q: 发票／回单下载打不开，或链接指向 localhost？**

下载已改为由 API 代理返回文件字节，不会再出现 `localhost` 链接。
若仍看到旧链接，说明前端未重新构建——执行 `pnpm build` 并刷新浏览器缓存。

### 6.6 通知

**Q: 邮件没有发出？**

1. 确认 `EMAIL_PROVIDER=smtp`
2. 确认 `EMAIL_PASS` 是**授权码**，不是邮箱密码
3. 确认 163 邮箱已开启 SMTP
4. 检查能否访问 `smtp.163.com:465`

**Q: 短信报 `isv.TEMPLATE_PARAMS_ILLEGAL`？**

通常是把验证码模板用作了通知模板。通知必须使用**通知类模板**，
提醒/升级/驳回/打款模板变量为 `${code}`，值为报销单号。

**Q: 开发阶段不想真实发送？**

保持：

```env
SMS_PROVIDER=log
EMAIL_PROVIDER=log
```

内容只会打印到控制台。

### 6.7 MCP / 本体

**Q: MCP 调用返回未授权/无数据？**

1. 检查 `.env` 是否同时设置了 `MCP_API_KEYS` 和 `MCP_API_KEY`
2. 确认 `MCP_API_KEY` 的值存在于 `MCP_API_KEYS` 映射中
3. 确认 Agent 的 `mcp.json` 传入了正确的环境变量
4. 确认 `pnpm --filter @sse/mcp build` 成功

**Q: API 重启后本体可视化 / SPARQL 查询返回空？**

本体 Store 会从数据库和 Turtle 文件异步恢复。等待片刻，或手动同步：

```bash
TOKEN=$(curl -s -X POST http://localhost:3000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"phone":"13800000000","password":"admin123"}' \
  | python3 -c "import json,sys; print(json.load(sys.stdin)['accessToken'])")

curl -s -H "Authorization: Bearer $TOKEN" \
  http://localhost:3000/ontology/sync
```

**Q: HTTP 方式调用 MCP 返回 401 / Session not found？**

- `401`：请求未带 `Authorization: Bearer <key>`，或 key 不在 `MCP_API_KEYS` / `mcp_api_keys` 中。
- `Session not found`：客户端丢失了 `Mcp-Session-Id`，或服务重启后会话失效；重新初始化即可。
- 多 key 并发时，每个会话绑定首次初始化用的 key，不能用另一把 key 复用它。

**Q: `GET /openapi.json` 能拉到，但调用接口仍 401？**

OpenAPI 里除 `GET /openapi.json`、`GET /health`、`POST /auth/api-key-login` 外都需要 JWT。
先用 `POST /auth/api-key-login` 换 `accessToken`，再带 `Authorization: Bearer <accessToken>`。

### 6.8 Windows / PowerShell 差异

| bash 写法 | PowerShell 写法 |
|---|---|
| `cp .env.example .env` | `Copy-Item .env.example .env` |
| `DB_PORT=5433 pnpm migrate` | `$env:DB_PORT=5433; pnpm migrate` |
| `gunzip -c x.tar.gz \| docker load` | `tar -xzf x.tar.gz; docker load -i x.tar` |
| `sha256sum -c x.sha256` | `Get-FileHash .\x.tar.gz -Algorithm SHA256` |
| `export FOO=bar` | `$env:FOO="bar"` |

Windows 下 `pnpm dev` 已通过 `concurrently` 跨平台并行启动，不需要 `&` 或 `start`。

---

## 附录

### A. 环境变量速查

完整模板见 [.env.example](../.env.example)。常用变量：

| 变量 | 必填 | 默认值 | 说明 |
|---|---|---|---|
| `NODE_ENV` | 否 | `development` | 生产设为 `production` |
| `PORT` | 否 | `3000` | API 端口 |
| `DB_HOST` | 是 | `localhost` | 数据库地址 |
| `DB_PORT` | 否 | `5433` | **宿主机** PostgreSQL 端口 |
| `DB_NAME` | 是 | `sse` | 数据库名 |
| `DB_USER` | 是 | `sse` | 数据库用户 |
| `DB_PASSWORD` | 是 | `sse_dev` | 数据库密码 |
| `JWT_SECRET` | 是 | — | JWT 签名密钥，生产必须修改 |
| `MINIO_ENDPOINT` | 是 | `localhost` | MinIO 地址 |
| `MINIO_PORT` | 否 | `9002` | **宿主机** MinIO API 端口 |
| `MINIO_ACCESS_KEY` | 是 | `minioadmin` | MinIO 账号 |
| `MINIO_SECRET_KEY` | 是 | `minioadmin` | MinIO 密码 |
| `MINIO_BUCKET` | 否 | `invoices` | 发票桶；其他桶会在上传时自动创建 |
| `MCP_API_KEYS` | 否 | — | 密钥映射表，格式 `key=userId:role:department` |
| `MCP_API_KEY` | 否 | — | stdio 默认使用的 key（HTTP 不使用） |
| `MCP_HTTP_PORT` | 否 | `3001` | MCP HTTP 端口（`pnpm mcp:http`） |
| `MCP_LEGACY_SSE` | 否 | `1` | 设为 `0` 关闭旧 HTTP+SSE |
| `MCP_JSON_RESPONSE` | 否 | `0` | 设为 `1` 时 Streamable HTTP 直接返回 JSON |
| `MCP_CORS_ORIGIN` | 否 | — | 设置后开启 CORS |
| `MCP_MAX_SESSIONS` | 否 | `100` | MCP 会话上限 |
| `MCP_MAX_BODY_BYTES` | 否 | `52428800` | MCP 请求体上限（50MB） |
| `MCP_KEY_REFRESH_MS` | 否 | `60000` | DB 中 `mcp_api_keys` 的刷新周期（key 吊销/角色变更生效延迟） |
| `MCP_RATE_LIMIT_PER_MIN` | 否 | `120` | 每用户每分钟 MCP 工具调用上限 |
| `MCP_AUDIT_LOG` | 否 | `1` | 设为 `0` 关闭工具调用审计（stderr JSON） |
| `MCP_SPARQL_MAX_RESULTS` | 否 | `1000` | SPARQL 结果硬上限 |
| `SSE_API_BASE` | 否 | `http://localhost:3000` | MCP 工具委托 REST 的基址 |
| `PUBLIC_API_BASE` | 否 | — | OpenAPI `servers` 与内部 REST 基址 |
| `SMS_PROVIDER` | 否 | `log` | `log` / `aliyun` |
| `EMAIL_PROVIDER` | 否 | `log` | `log` / `smtp` |
| `EMAIL_HOST` | 否* | `smtp.163.com` | SMTP 地址 |
| `EMAIL_PORT` | 否* | `465` | SMTP 端口 |
| `EMAIL_USER` | 否* | — | SMTP 账号 |
| `EMAIL_PASS` | 否* | — | SMTP 授权码 |
| `EMAIL_FROM` | 否 | — | 发件人 |
| `ALIYUN_ACCESS_KEY_ID` | 否* | — | 阿里云 AccessKey |
| `ALIYUN_ACCESS_KEY_SECRET` | 否* | — | 阿里云 Secret |
| `ALIYUN_SMS_SIGN_NAME` | 否* | — | 短信签名 |
| `ALIYUN_SMS_TEMPLATE_*` | 否* | — | 按事件模板 CODE |
| `ALIYUN_SMS_TEMPLATE_CODE` | 否* | — | 通用回退模板 |
| `AI_ENDPOINT` | 否 | `http://localhost:11434/v1/chat/completions` | AI 端点 |
| `AI_MODEL` | 否 | `llama3.2-vision` | AI 模型 |
| `MINERU_TOKEN` | 否 | — | MinerU 云端 Token。**优先级低于系统管理里已保存的 Token**（见 §3.2） |

> \* 仅在启用对应通知服务商时必填。

### B. 常用命令速查

| 目的 | 命令 |
|---|---|
| 安装依赖 | `pnpm install` |
| 全量编译 | `pnpm build` |
| 应用迁移 | `pnpm build && pnpm migrate` |
| 启动全部开发服务 | `pnpm dev` |
| 只启动 API | `pnpm --filter @sse/api dev` |
| 只启动 Web（允许外部访问） | `pnpm --filter @sse/web dev --host` |
| 编译并启动 MCP | `pnpm mcp` |
| 启动基础设施 | `docker compose up -d` |
| 查看容器 | `docker compose ps` |
| 查看日志 | `docker compose logs -f minio` |
| 停止容器（保留数据） | `docker compose down` |
| 停止并删除数据卷（危险） | `docker compose down -v` |
| 导入 MinIO 镜像 | `cd images/minio && gunzip -c sse-minio-local.tar.gz \| docker load` |
| 校验 MinIO 镜像包 | `cd images/minio && sha256sum -c sse-minio-local.tar.gz.sha256` |

增量编译（只调试某个包时使用，按依赖顺序）：

```bash
pnpm --filter @sse/shared build
pnpm --filter @sse/core build
pnpm --filter @sse/db build
pnpm --filter @sse/auth build
pnpm --filter @sse/ocr build
pnpm --filter @sse/notifications build
pnpm --filter @sse/api build
pnpm --filter @sse/web build
```

> 依赖顺序：`shared → core → db/auth/ocr/notifications → api/web/mcp`。
> 不确定时直接用 `pnpm build` 最省事。

### C. 目录、数据卷与配置

```text
sse/
├── packages/
│   ├── api/              # Express REST API
│   ├── web/              # Vue 3 SPA（构建产物 packages/web/dist）
│   ├── mcp/              # MCP Server
│   ├── db/               # PostgreSQL 仓储与迁移
│   ├── core/ shared/ auth/ ai/ ocr/ notifications/ ontology/
├── images/minio/         # MinIO 本地镜像包
├── docs/                 # 设计与部署文档
├── .env                  # 本地配置（不入库）
├── .env.example          # 配置模板
└── docker-compose.yml    # PostgreSQL + MinIO
```

运行时产生的文件/数据：

| 位置 | 内容 | 是否入库 |
|---|---|---|
| `.env` | 环境变量 | 否 |
| `ai-config.json` | AI/OCR 配置（含 API Key） | 否 |
| `ai-test-history.json` | AI/OCR 测试历史 | 否 |
| Docker 卷 `pgdata` | 业务数据 | — |
| Docker 卷 `miniodata` | 附件对象 | — |

### D. MinerU 适配器完整脚本（自建方案，已非默认路径）

> ⚠️ **本附录描述的是"自建 MinerU 适配器"方案，当前代码已不内置该适配器。**
>
> 现行实现直接调用 **MinerU 云端 API**（`https://mineru.net`），
> 在系统管理里填 Token 即可，**不需要部署本脚本**。参见 §3.2 方案 A。
>
> 保留本节仅供以下情况参考：
> - 内网无法访问 MinerU 云端，需要完全离线部署；
> - 需要自建适配器来对接内部或第三方的文档解析服务。
>
> 若采用自建方案，需自行保证适配器的接口与系统约定一致
> （提交文件 → 返回 Markdown，字段解析由 `packages/ai` 的解析器负责）。

下面是一个最小 Flask 适配器示例，仅供自建方案参考。
保存为 `mineru_api.py`，默认监听 `8888`：

```python
import json, os, tempfile
from flask import Flask, request, jsonify
from magic_pdf.pipe.UNIPipe import UNIPipe
from magic_pdf.rw.DiskReaderWriter import DiskReaderWriter

app = Flask(__name__)

@app.route('/api/parse', methods=['POST'])
def parse():
    f = request.files.get('file')
    if not f:
        return jsonify({'error': 'no file'}), 400
    tmp = tempfile.mkdtemp()
    path = os.path.join(tmp, f.filename)
    f.save(path)
    try:
        rw = DiskReaderWriter(tmp)
        pipe = UNIPipe(path, rw, None)
        pipe.pipe_classify()
        pipe.pipe_parse()
        md = pipe.pipe_mk_markdown(tmp)
        return jsonify({'markdown': md})
    except Exception as e:
        return jsonify({'error': str(e)}), 500

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=8888)
```

运行：

```bash
pip install magic-pdf flask
magic-pdf download_models
python mineru_api.py
```

> 该脚本是参考实现，不是 SSE 官方组件。不同 MinerU 版本 API 可能变化，
> 请以实际安装版本为准。

### E. 版本与兼容性

| 组件 | 版本/说明 |
|---|---|
| Node.js | ≥ 18，推荐 20 LTS |
| pnpm | 9.x（仓库锁定 9.15.0） |
| PostgreSQL | 16（`postgres:16-alpine`） |
| MinIO | `RELEASE.2025-09-07T16-13-09Z`，`linux/amd64`，AGPLv3 |
| Docker Compose | v2（`docker compose`） |
| Ollama | 可选，建议最新稳定版 |
| MinerU / PaddleOCR | 可选，按实际安装版本 |

> **Node.js 版本说明**：扫描件 OCR 预处理需要 `pdfjs-dist` 与 `@napi-rs/canvas`，
> 两者随 `pnpm install` 自动安装（后者为预编译二进制，pnpm 会挑选对应平台产物，
> 无需原生编译）。pdfjs-dist 只提供 ESM 构建：Node 22.3 及以上用 `require(esm)` 加载，
> 更低版本自动回退到动态 `import()`，Node 18+ 均可正常运行。

MinIO 镜像安全提示：该版本早于 2025-10 的 CVE 修复。当前 SSE 用法（单 root 账号、
不启用 STS/服务账号/集群）不受影响；生产环境建议升级到
`RELEASE.2025-10-15T17-29-55Z` 或更新版本。

### F. 文档迁移说明

本文档由 `docs/2026-07-06-sse-deployment.md` 重命名而来，内容已按“必做 / 可选 / 生产 /
排障”重新整理，并修正了端口、默认账号、迁移方式、MCP 变量等过期信息。
旧版本仍可通过 Git 历史查看。
