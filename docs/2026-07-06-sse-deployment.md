# SSE 报销系统 — 部署文档

> 日期：2026-07-06 | 版本：v1.0

---

## 1. 环境要求

| 组件 | 版本 | 说明 |
|------|------|------|
| Node.js | ≥ 18 | 运行环境 |
| pnpm | ≥ 9 | 包管理器 |
| Docker + Docker Compose | 最新 | 运行 PostgreSQL + MinIO |
| Git | 任意 | 版本管理 |

## 2. 快速启动

### 2.1 克隆并安装

```bash
git clone <repo-url>
cd sse
pnpm install
```

### 2.2 更新代码并编译

```bash
# 拉取最新代码
git pull origin master

# 安装可能新增的依赖
pnpm install
```

**全量编译（推荐，TypeScript 增量编译很快）：**

```bash
pnpm build
```

**增量编译（只编译改动的模块，按依赖顺序）：**

```bash
# 基础层（被其他包依赖，如有改动必须先编译）
pnpm --filter @sse/shared build
pnpm --filter @sse/core build

# 实现层（依赖 core/shared）
pnpm --filter @sse/db build
pnpm --filter @sse/auth build
pnpm --filter @sse/ocr build
pnpm --filter @sse/notifications build

# 应用层（依赖上面所有）
pnpm --filter @sse/api build
pnpm --filter @sse/web build
```

> **依赖关系**：`shared` → `core` → `db/auth/ocr/notifications` → `api/web/mcp`。上游包改动后，下游包必须重新编译。不确定时直接用 `pnpm build` 编译全部最省事。

### 2.3 启动基础设施

```bash
# 注意：用 "docker compose"（空格，v2版本），不是 "docker-compose"（横杠，v1版本）
sudo docker compose up -d
```

启动 PostgreSQL（宿主机端口 5433 → 容器 5432）和 MinIO（API: 9002, Console: 9003）。

### 2.4 初始化数据库

```bash
# 编译所有包（首次或改代码后需要）
pnpm build

# 创建 .env（从模板复制，首次需要）
cp .env.example .env

# 执行数据库迁移
DB_PORT=5433 pnpm migrate
```

> **说明**：`.env.example` 中 `DB_PORT` 已设为 5433，但 migrate 脚本未加载 dotenv，首次迁移前需手动传 `DB_PORT=5433`。配置 `.env` 后启动 API 时自动读取。

### 2.5 配置 MinIO

1. 浏览器打开 `http://<server-ip>:9003`（账号 minioadmin / minioadmin）
2. 创建存储桶 `invoices`（Bucket Name 填 `invoices`，点 Create Bucket）

### 2.6 部署 AI 模型（OCR + 智能填单）

SSE 的发票 OCR 和智能填单功能依赖本地大语言模型。

#### 2.6.1 安装 Ollama

```bash
curl -fsSL https://ollama.com/install.sh | sh
```

#### 2.6.2 拉取视觉模型

```bash
# 推荐 llama3.2-vision（同时支持文字和图像识别）
ollama pull llama3.2-vision:11b

# 或使用其他兼容 OpenAI API 的视觉模型
```

#### 2.6.3 验证模型可用

```bash
ollama list
curl http://localhost:11434/v1/models
```

#### 2.6.4 在管理后台配置

1. 打开 SSE 管理后台 → **AI 模型配置**
2. 默认端点：`http://localhost:11434/v1/chat/completions`
3. 默认模型：`llama3.2-vision`
4. 点击「💾 保存配置」
5. 点击「📝 检验文字识别」→ 应返回识别成功
6. 点击「🖼️ 检验图像OCR」→ 应返回接口连通

#### 2.6.5 环境变量（可选）

`.env` 中可预置 AI 默认值（首次部署后可在后台修改）：

```env
# AI 模型
AI_ENDPOINT=http://localhost:11434/v1/chat/completions
AI_MODEL=llama3.2-vision
```

> **说明**：配置文件保存在项目根目录 `ai-config.json`，后台修改后即时生效，无需重启服务。也可以通过环境变量 `AI_ENDPOINT` 和 `AI_MODEL` 预设初始值。

### 2.7 部署发票 OCR 引擎（可选，三选一）

SSE 支持三种 OCR 引擎，在管理后台 `🧾 发票OCR引擎` 面板切换。

#### 方案 A：MinerU（推荐）

MinerU 擅长文档智能解析，PDF 发票直接输出结构化数据，中文支持好。

**Linux 部署：**

```bash
pip install magic-pdf flask
magic-pdf download_models

cat > mineru_api.py << 'PYEOF'
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
PYEOF

python mineru_api.py &
```

**Windows 部署（铭凡 S1-Max 等独立机器）：**

```powershell
pip install magic-pdf flask
magic-pdf download_models
python mineru_api.py
```

启动后在 SSE 管理后台配置：

```
引擎: MinerU
端点: http://<mineru-ip>:8888
```

#### 方案 B：PaddleOCR

```bash
pip install paddlepaddle paddleocr flask
# API 服务结构同 MinerU，端口 8899
```

配置：

```
引擎: PaddleOCR
端点: http://<paddle-ip>:8899
```

#### 方案 C：视觉模型

直接使用 Ollama 视觉模型（如 glm-ocr），无需额外部署。

```
引擎: 视觉模型
端点: http://192.168.3.117:11434/v1/chat/completions
模型: glm-ocr
```

### 2.8 配置环境变量

确保 `.env` 文件存在（已从 `.env.example` 复制）：

```env
# 数据库
DB_HOST=localhost
DB_PORT=5432
DB_NAME=sse
DB_USER=sse
DB_PASSWORD=sse_dev

# JWT
JWT_SECRET=your-secret-key-change-in-production

# MinIO
MINIO_ENDPOINT=localhost
MINIO_PORT=9000
MINIO_ACCESS_KEY=minioadmin
MINIO_SECRET_KEY=minioadmin
MINIO_BUCKET=invoices

# 通知 (可选, 开发环境不需要)
SMS_PROVIDER=log
EMAIL_PROVIDER=log
```

### 2.9 启动服务

```bash
# 启动 API 服务（默认端口 3000）
pnpm --filter @sse/api dev

# 启动前端开发服务（另开终端，--host 允许外部访问）
pnpm --filter @sse/web dev --host

# 或同时启动
pnpm dev
```

> **关键**：前端必须加 `--host` 参数才能从其他机器访问，否则仅监听 `localhost`。

### 2.10 启动 MCP Server（如需 Agent 调用）

```bash
pnpm --filter @sse/mcp build
node packages/mcp/dist/server.js
```

### 2.11 启动通知调度器（现已自动启动）

> **v2.1 更新**：审批提醒调度器现已集成到 API 服务中，`pnpm --filter @sse/api dev` 启动后自动运行，每 15 分钟扫描超时待审批记录并发送提醒。无需手动启动。

```bash
# 如需独立调试调度器（可选）
pnpm --filter @sse/notifications build
node packages/notifications/dist/scheduler.js
```

## 3. 生产部署

### 3.1 构建

```bash
pnpm build
```

编译产物在各包的 `dist/` 目录。

### 3.2 Docker 部署（推荐）

创建 `Dockerfile`：

```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/api/package.json packages/api/
COPY packages/core/package.json packages/core/
COPY packages/db/package.json packages/db/
COPY packages/auth/package.json packages/auth/
COPY packages/shared/package.json packages/shared/
RUN corepack enable && pnpm install --frozen-lockfile
COPY . .
RUN pnpm build
EXPOSE 3000
CMD ["node", "packages/api/dist/index.js"]
```

### 3.3 环境变量清单

| 变量 | 必填 | 默认值 | 说明 |
|------|------|--------|------|
| NODE_ENV | 否 | development | 运行环境 |
| PORT | 否 | 3000 | API 端口 |
| DB_HOST | 是 | localhost | 数据库地址 |
| DB_PORT | 否 | 5433 | 数据库端口 |
| DB_NAME | 是 | sse | 数据库名 |
| DB_USER | 是 | sse | 数据库用户 |
| DB_PASSWORD | 是 | — | 数据库密码 |
| JWT_SECRET | 是 | — | JWT 签名密钥 |
| MINIO_ENDPOINT | 是 | localhost | 对象存储地址 |
| MINIO_PORT | 否 | 9002 | MinIO API 端口 |
| MINIO_ACCESS_KEY | 是 | — | MinIO Access Key |
| MINIO_SECRET_KEY | 是 | — | MinIO Secret Key |
| MINIO_BUCKET | 否 | invoices | 发票存储桶 |
| SMS_PROVIDER | 否 | log | SMS 服务商：`log` / `aliyun` |
| EMAIL_PROVIDER | 否 | log | 邮件服务商：`log` / `smtp` |
| EMAIL_HOST | 否* | smtp.163.com | SMTP 服务器地址 |
| EMAIL_PORT | 否* | 465 | SMTP 端口 |
| EMAIL_USER | 否* | — | SMTP 登录账号 |
| EMAIL_PASS | 否* | — | SMTP 授权码（非邮箱密码） |
| EMAIL_FROM | 否 | — | 发件人显示地址 |
| ALIYUN_ACCESS_KEY_ID | 否* | — | 阿里云 AccessKey |
| ALIYUN_ACCESS_KEY_SECRET | 否* | — | 阿里云 Secret |
| ALIYUN_SMS_SIGN_NAME | 否* | — | 阿里云短信签名 |
| ALIYUN_SMS_TEMPLATE_CODE | 否* | — | 阿里云短信模板编号 |

> \* 仅在 `EMAIL_PROVIDER=smtp` 或 `SMS_PROVIDER=aliyun` 时必填。

### 3.4 端口映射

docker-compose 对外暴露端口已避开常见冲突：

| 服务 | 容器内端口 | 宿主机端口 |
|------|-----------|-----------|
| PostgreSQL | 5432 | 5433 |
| MinIO API | 9000 | 9002 |
| MinIO Console | 9001 | 9003 |

环境变量 `DB_PORT` 和 `MINIO_PORT` 需与宿主机端口一致。

## 4. 通知通道配置

SSE 通知系统支持邮件和短信两种补充送达通道（页面内通知始终启用）。

### 4.1 邮件通道 — 163 邮箱 SMTP

#### 开通步骤

1. 登录 [163邮箱](https://mail.163.com)（没有则注册一个）
2. 进入 **设置 → POP3/SMTP/IMAP**
3. 勾选开启 **SMTP 服务** 和/或 **IMAP服务**
4. 在弹出窗口中完成验证 → 获取 **授权码**（一串字母，不是邮箱密码！）
5. 保存授权码

#### 配置 .env

```env
EMAIL_PROVIDER=smtp
EMAIL_HOST=smtp.163.com
EMAIL_PORT=465
EMAIL_USER=your-email@163.com
EMAIL_PASS=your-auth-code        # 上面获取的授权码
EMAIL_FROM=your-email@163.com    # （可选）发件人显示地址
```

> **注意**：`EMAIL_PASS` 是**授权码**，不是邮箱登录密码。QQ邮箱等其他 SMTP 同理，只需改 `EMAIL_HOST` 和 `EMAIL_PORT`：
> - QQ邮箱: `smtp.qq.com:465`，需在 QQ 邮箱设置里生成授权码
> - Gmail: `smtp.gmail.com:587`，需开启两步验证 + 应用专用密码

#### 测试

启动后调度器发送第一封邮件时，日志会显示发送结果：

```
[Email] To: user@example.com | Subject: 报销审批提醒 - xxx
```

如失败，检查：
- `.env` 中 `EMAIL_USER` 和 `EMAIL_PASS` 是否正确
- 163 邮箱是否已开启 SMTP 服务
- 网络是否能访问 `smtp.163.com:465`

### 4.2 短信通道 — 阿里云短信

#### 开通步骤

1. 登录 [阿里云控制台](https://console.aliyun.com)
2. 进入 **短信服务** → 如果没有开通，点击"免费开通"
3. 进入 **国内消息 → 签名管理** → 添加签名（需审核，1-2 个工作日内）
4. 进入 **国内消息 → 模板管理** → 添加模板，内容示例：

   ```
   您的报销单"${title}"有新动态：${content}。请登录系统查看。
   ```

5. 进入 **AccessKey管理** → 获取 `AccessKey ID` 和 `AccessKey Secret`

#### 配置 .env

```env
SMS_PROVIDER=aliyun
ALIYUN_ACCESS_KEY_ID=your-access-key-id
ALIYUN_ACCESS_KEY_SECRET=your-access-key-secret
ALIYUN_SMS_SIGN_NAME=审批通知            # 已审核的签名名称
ALIYUN_SMS_TEMPLATE_CODE=SMS_123456789   # 已审核的模板编号
```

#### 安装 SDK

```bash
pnpm --filter @sse/notifications add @alicloud/dysmsapi20170525
```

#### 测试

启动后发送短信时，阿里云控制台可查看发送记录。开发阶段建议保持 `SMS_PROVIDER=log`，短信内容输出到控制台。

> **未开通短信时**：将 `SMS_PROVIDER` 设为 `log`（默认），短信不实际发送，内容仅打印到控制台。

## 5. 默认账户

迁移脚本会创建默认管理员：

| 字段 | 值 |
|------|-----|
| 手机号 | 13800000001 |
| 角色 | 管理员 |

首次登录后请立即修改密码。

## 6. 常见问题

### Docker 相关

**Q: `permission denied while trying to connect to the Docker daemon socket`**

当前用户不在 docker 组，二选一：

```bash
# 方式一：临时提权
sudo docker compose up -d

# 方式二：永久加入 docker 组（需重新登录）
sudo usermod -aG docker $USER
```

**Q: `port is already allocated`**

宿主机端口被占用。确认端口释放：

```bash
# 查看占用进程
sudo lsof -i :5432
sudo lsof -i :9000
sudo lsof -i :9001

# 若为其他容器占用，清理
sudo docker rm -f <container-name>
```

本项目已使用非标准端口（PG:5433, MinIO:9002/9003）避免冲突。

**Q: `docker-compose` 报错 `'ContainerConfig'` 或 `KeyError`**

你可能在用 Python 版 `docker-compose`（v1，有横杠）。改用 Docker 内置的 v2 版（空格）：

```bash
# 错误
sudo docker-compose up -d        # v1 (Python)

# 正确
sudo docker compose up -d         # v2 (Docker 内置)
```

确认版本：

```bash
docker compose version            # ≥ 2.0 即可
```

**Q: 旧容器残留导致失败**

```bash
sudo docker rm -f sse_postgres_1 sse_minio_1
sudo docker compose up -d
```

### 数据库相关

**Q: 数据库迁移失败**

确认 PostgreSQL 已启动：`docker compose ps`，然后检查连接：

```bash
# 测试连接（端口 5433）
psql -h localhost -p 5433 -U sse -d sse
```

**Q: 迁移报错 `role "sse" does not exist`**

```bash
sudo docker compose down -v       # 清除旧数据卷
sudo docker compose up -d         # 重建
pnpm migrate
```

### 前端相关

**Q: 前端无法连接 API**

检查 Vite 代理配置，确认 API 服务在 3000 端口运行。

**Q: Web 构建失败**

确认 `vue-tsc` 版本 ≥ 2.0（最新代码已修复）。

### API / 服务相关

**Q: 启动 API 报 `EADDRINUSE: address already in use 0.0.0.0:3000`**

端口 3000 被之前的进程（或僵尸进程）占用。释放端口：

```bash
# 查看占用进程
fuser 3000/tcp

# 强制释放
fuser -k 3000/tcp
```

如果 `fuser` 不可用：

```bash
# 备选方案
lsof -ti:3000 | xargs kill -9
```

释放后重新启动：

```bash
pnpm --filter @sse/api dev
```

> **原因**：Express 绑定到 `0.0.0.0:3000`，上一个 `ts-node` 进程未正常退出时端口不会立即释放。`fuser -k` 可直接终止占用进程。

### AI / OCR 相关

**Q: AI 检验按钮报"连接失败"**

确认 Ollama 服务已启动：

```bash
ollama serve                # 前台启动
# 或
systemctl start ollama      # systemd 启动
```

检查端口：

```bash
curl http://localhost:11434/v1/models
```

**Q: 智能填单返回"未解析到结构化数据"**

模型已连接但识别能力不足。尝试：

1. 更换更强的视觉模型（如 `llama3.2-vision:90b`，需更多显存）
2. 检查输入文字是否包含可识别的金额信息
3. 在管理后台调整模型名称并重新检验

**Q: 没有 GPU 能跑吗**

可以。Ollama 支持纯 CPU 运行，但速度较慢（每条识别 5-30 秒）。推荐至少 8GB 内存。

**Q: 想用云端 API 替代本地模型**

在管理后台将端点改为 OpenAI 兼容地址即可：

```
端点: https://api.openai.com/v1/chat/completions
模型: gpt-4o
```

需在 `.env` 中设置 `OPENAI_API_KEY`，或后台增加 API Key 配置（后续版本支持）。

### MinIO 相关

**Q: MinIO 控制台无法访问**

浏览器打开 `http://<server>:9003`（不是 9001），账号 minioadmin / minioadmin。首次使用需创建存储桶 `invoices`。

### 前端相关

**Q: 前端无法从其他机器访问（只显示 localhost:5173）**

Vite 默认只监听本地。启动时加 `--host`：

```bash
pnpm --filter @sse/web dev --host
```

### 数据库相关

**Q: migrate 报错 `ECONNREFUSED 127.0.0.1:5432`**

默认端口已改为 5433。首次迁移时手动指定：

```bash
DB_PORT=5433 pnpm migrate
```

后续启动 API 时会从 `.env` 自动读取。

**Q: migrate 报错 `ENOENT: .../dist/migrations/001_initial.sql`**

TS 编译不复制 `.sql` 文件。确认 `migrate.ts` 的路径指向 `src/migrations/`：

```typescript
// 正确路径
join(__dirname, '..', 'src', 'migrations', '001_initial.sql')

// 错误路径（dist 下没有）
join(__dirname, 'migrations', '001_initial.sql')
```

重新 `pnpm --filter @sse/db build` 后再 migrate。

---

> 文档位置：`E:\app\opencode\sse\docs\2026-07-06-sse-deployment.md`
