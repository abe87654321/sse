# SSE 报销系统 — 开发过程记录（v2.5）

> 日期：2026-08-01 | 会话记录

---

## 阶段十四：Pi MCP 瘦客户端架构

### 背景

旧架构：Pi 扩展 spawn 本地 `packages/mcp/dist/index.js` 进程，要求客户端 git clone 整仓 + pnpm install + build + 本地 .env + DB 凭据。每台新电脑接入成本过高。

### 新架构：瘦客户端直连远端 REST

```
Pi (客户端) → sse-mcp.ts（fetch，零依赖）→ http://192.168.3.107:3000（远端 API）
```

- **客户端零依赖**：只用 Node 内置 `fetch`，无 node_modules、无本地进程、无 DB 凭据
- **认证**：`POST /auth/api-key-login` 用 MCP key 换 JWT，角色随 key 绑定的用户走
- **输出适配**：扩展内做 REST camelCase → snake_case + 分页重组
- **方案 B（备用）**：`packages/mcp/src/http.ts` 提供 HTTP+SSE transport（`:3001/mcp`），供原生 MCP 客户端使用

### 新增/修改文件

| 文件 | 变更 |
|------|------|
| `packages/api/src/routes/auth.ts` | 新增 `POST /auth/api-key-login`（key→JWT，角色随 key 绑定用户） |
| `packages/api/src/routes/expenses.ts` | 新增 `POST /expenses/validate`、`POST /expenses/from-invoice`、`?applicantName=` 参数 |
| `packages/api/src/routes/ontology.ts` | 新增 `POST /ontology/query-expense-status` |
| `packages/mcp/src/http.ts` | 新增 HTTP+SSE transport 入口（方案 B） |
| `.pi/extensions/sse-mcp.ts` | 重写：spawn 本地 MCP → fetch 远端 REST，JWT 缓存，snake_case 适配，TypeBox Optional |

### 计划与测试文档

| 文件 | 说明 |
|------|------|
| `docs/2026-07-31-pi-mcp-thin-client-plan.md` | 瘦客户端方案 + 选型决策 |
| `docs/2026-07-31-mcp-pi-test-cases.md` | Pi 接入指南 + 14 工具测试用例 + 7 key 分配表 |

---

## 阶段十五：Bug 修复 — 搜索与参数校验

### 1. 不能按姓名搜索报销单

- **问题**：`GET /expenses?keyword=李四` 只搜 `er.title`（报销标题），不搜 `users.name`
- **修复**：新增 `?applicantName=` 参数，后端查 `users` 表转 `userId` 后按正常逻辑过滤
- **涉及文件**：`expenses.ts`（GET / 路由）、`.pi/extensions/sse-mcp.ts`（`applicant_name` 参数）

### 2. TypeBox 参数全部被当必填

- **问题**：`str()` / `num()` 返回纯 JSON 对象（`{ type: "string" }`），TypeBox 无法识别为 `Optional`，全部参数被当 required → Pi 传参缺字段时校验不通过
- **修复**：改为 `Type.Optional(Type.String({...}))`，真正必填字段（`report_id`、`text` 等）用非 Optional

### 3. 配置文件加载静默失败

- **问题**：`~/.pi/agent/sse-config.json` 读取失败时无任何日志，且不处理 UTF-8 BOM
- **修复**：增加 debug 日志（显示检查路径、加载来源、key 状态），自动跳过 BOM 头

### 4. 全局扩展与项目扩展冲突

- **问题**：`~/.pi/agent/extensions/sse-mcp.ts` 和 `.pi/extensions/sse-mcp.ts` 同时加载，工具名重复注册报错
- **解决**：删除全局副本，只保留项目版本

### 5. AI 编造缺失信息（anti-hallucination）

- **问题**：Pi 在数据只有 `user_id`（UUID）没有 `name` 时自行编造"王五"
- **修复**：新增 `.pi/prompts/accuracy.md` 提示词模板，随 `.pi/settings.json` 自动加载

---

## 阶段十六：多用户权限系统

### 设计决策

- MCP API key 存入远端 DB `mcp_api_keys` 表（而非本地 .env），多客户端共享
- 每个员工一个独立 key，key 绑定用户 → 角色随用户走
- `POST /auth/api-key-login` 查 key→user 后按该用户身份签 JWT

### Key 分配

| key | 绑定用户 | 角色 | 权限范围 |
|-----|---------|------|---------|
| `mcp_admin_001` | 系统管理员 | admin | 全部 |
| `mcp_admin_002` | 孙哲林 | admin | 全部 |
| `mcp_finance_001` | 王钰 | finance | 全部 + 统计 |
| `mcp_emp_jiqiong` | 姬琼 | employee | 仅自己 |
| `mcp_emp_sunyihang` | 孙逸航 | employee | 仅自己 |
| `mcp_emp_zhangsan` | 张三 | employee | 仅自己 |
| `mcp_emp_lisi` | 李四 | employee | 仅自己 |

---

## 阶段十七：配置简化 — sse-config.json 永久配置文件

### 设计决策

扩展读取 key 的三级优先级：环境变量 `SSE_API_KEY` > `~/.pi/agent/sse-config.json` > `.pi/sse-config.json`。设了环境变量就用环境变量，没设就读配置文件，**不用每次启动手工 export**。

### 配置文件格式

```json
{
  "apiBase": "http://192.168.3.107:3000",
  "apiKey": "mcp_admin_001"
}
```

### 文档

- 文档更新为 Windows PowerShell / Linux 两种创建方式

---

## README 更新

- 新增 `pi_call_mcp.JPG` 截图（Pi 调用 MCP 工具）
- 新增 `screenshot_ontology.JPG` 截图（本体图谱可视化）

---

## 待解决

| 问题 | 状态 |
|------|------|
| Ollama `192.168.3.107:11434` 不可达 | NL/OCR 工具不可用，需确认远端 Ollama 端口 |
| vLLM 余额不足（`192.168.3.110:8000`） | Pi LLM 调用中断，非 SSE 问题 |

---

## 待办模块汇总

| 优先级 | 模块 | 说明 | 状态 |
|--------|------|------|------|
| — | 瘦客户端架构 | 零 fetch、零节点本地依赖 | ✅ 已完成 |
| — | 多用户 key 系统 | 7 key，角色随用户走 | ✅ 已完成 |
| — | 按姓名搜索报销单 | `?applicantName=` 参数 | ✅ 已完成 |
| — | TypeBox Optional 修复 | 参数默认可选 | ✅ 已完成 |
| — | 配置文件持久化 | `sse-config.json` 三级优先级 | ✅ 已完成 |
| — | 防幻觉提示词 | `.pi/prompts/accuracy.md` | ✅ 已完成 |
| P0 | 事务性消息接入 | 驳回/付款等 API 端点调用 NotificationEngine.send() | 未开始 |
| P1 | 邮件/SMS 真实通道 | 当前 dev/log 模式，需配置 SMTP + 阿里云短信 | 未开始 |

---

> 文档位置：`docs/2026-08-01-sse-process.md`
