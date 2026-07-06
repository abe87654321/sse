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

### 2.2 启动基础设施

```bash
# 注意：用 "docker compose"（空格，v2版本），不是 "docker-compose"（横杠，v1版本）
sudo docker compose up -d
```

启动 PostgreSQL（宿主机端口 5433 → 容器 5432）和 MinIO（API: 9002, Console: 9003）。

### 2.3 初始化数据库

```bash
# 编译所有包（首次或改代码后需要）
pnpm build

# 创建 .env（从模板复制，首次需要）
cp .env.example .env

# 执行数据库迁移
DB_PORT=5433 pnpm migrate
```

> **说明**：`.env.example` 中 `DB_PORT` 已设为 5433，但 migrate 脚本未加载 dotenv，首次迁移前需手动传 `DB_PORT=5433`。配置 `.env` 后启动 API 时自动读取。

### 2.4 配置 MinIO

1. 浏览器打开 `http://<server-ip>:9003`（账号 minioadmin / minioadmin）
2. 创建存储桶 `invoices`（Bucket Name 填 `invoices`，点 Create Bucket）

### 2.5 配置环境变量

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

### 2.6 启动服务

```bash
# 启动 API 服务（默认端口 3000）
pnpm --filter @sse/api dev

# 启动前端开发服务（另开终端，--host 允许外部访问）
pnpm --filter @sse/web dev -- --host

# 或同时启动
pnpm dev
```

> **关键**：前端必须加 `--host` 参数才能从其他机器访问，否则仅监听 `localhost`。

### 2.7 启动 MCP Server（如需 Agent 调用）

```bash
pnpm --filter @sse/mcp build
node packages/mcp/dist/server.js
```

### 2.8 启动通知调度器（如需审批提醒）

```bash
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
| SMS_PROVIDER | 否 | log | SMS 服务商 |
| EMAIL_PROVIDER | 否 | log | 邮件服务商 |

### 3.4 端口映射

docker-compose 对外暴露端口已避开常见冲突：

| 服务 | 容器内端口 | 宿主机端口 |
|------|-----------|-----------|
| PostgreSQL | 5432 | 5433 |
| MinIO API | 9000 | 9002 |
| MinIO Console | 9001 | 9003 |

环境变量 `DB_PORT` 和 `MINIO_PORT` 需与宿主机端口一致。
## 4. 默认账户

迁移脚本会创建默认管理员：

| 字段 | 值 |
|------|-----|
| 手机号 | 13800000001 |
| 角色 | 管理员 |

首次登录后请立即修改密码。

## 5. 常见问题

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

### MinIO 相关

**Q: MinIO 控制台无法访问**

浏览器打开 `http://<server>:9003`（不是 9001），账号 minioadmin / minioadmin。首次使用需创建存储桶 `invoices`。

### 前端相关

**Q: 前端无法从其他机器访问（只显示 localhost:5173）**

Vite 默认只监听本地。启动时加 `--host`：

```bash
pnpm --filter @sse/web dev -- --host
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
