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
docker-compose up -d
```

启动 PostgreSQL (端口 5432) 和 MinIO (API: 9000, Console: 9001)。

### 2.3 初始化数据库

```bash
pnpm build          # 编译所有包
pnpm migrate        # 执行数据库迁移
```

### 2.4 配置 MinIO

1. 打开 http://localhost:9001（账号 minioadmin / minioadmin）
2. 创建存储桶 `invoices`
3. 生成 Access Key / Secret Key

### 2.5 配置环境变量

创建 `.env` 文件：

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
# 启动 API 服务 (端口 3000)
pnpm --filter @sse/api dev

# 启动前端开发服务 (端口 5173)
pnpm --filter @sse/web dev

# 或同时启动
pnpm dev
```

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
| DB_PORT | 否 | 5432 | 数据库端口 |
| DB_NAME | 是 | sse | 数据库名 |
| DB_USER | 是 | sse | 数据库用户 |
| DB_PASSWORD | 是 | — | 数据库密码 |
| JWT_SECRET | 是 | — | JWT 签名密钥 |
| MINIO_ENDPOINT | 是 | localhost | 对象存储地址 |
| MINIO_ACCESS_KEY | 是 | — | MinIO Access Key |
| MINIO_SECRET_KEY | 是 | — | MinIO Secret Key |
| MINIO_BUCKET | 否 | invoices | 发票存储桶 |
| SMS_PROVIDER | 否 | log | SMS 服务商 |
| EMAIL_PROVIDER | 否 | log | 邮件服务商 |

## 4. 默认账户

迁移脚本会创建默认管理员：

| 字段 | 值 |
|------|-----|
| 手机号 | 13800000001 |
| 角色 | 管理员 |

首次登录后请立即修改密码。

## 5. 常见问题

**Q: 数据库迁移失败**
A: 确认 PostgreSQL 已启动：`docker-compose ps`

**Q: 前端无法连接 API**
A: 检查 Vite 代理配置，确认 API 服务在 3000 端口运行

**Q: MinIO 无法连接**
A: 确认 MinIO 控制台 http://localhost:9001 可访问

---

> 文档位置：`E:\app\opencode\sse\docs\2026-07-06-sse-deployment.md`
