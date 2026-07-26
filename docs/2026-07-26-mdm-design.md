# SSE 主数据管理（MDM）— 整合设计

> 日期：2026-07-26 | 版本：v1.0 | 状态：待评审

---

## 1. 概述

SSE 当前的组织（部门）和角色直接存储在 `users` 表中。未来接入其他系统（HR、LDAP、企业微信）时，需要统一的主数据管理（MDM）方案，支持 MDM 服务和 SCIM 2.0 协议并行。

---

## 2. 统一架构

```
外部系统（企业微信 / LDAP / HR系统）
       │
       ├── SCIM 2.0 ──────────────┐
       │                          ▼
       └── MDM Service ──→ 事件总线 (Webhook)
                                  │
                                  ▼
                          SSE Identity Bridge
                         ┌──────────────────┐
                         │ users（本地缓存）  │
                         │ + 扩展字段        │
                         │ (notify_prefs等)  │
                         └──────────────────┘
```

---

## 3. Identity Bridge 设计

### 3.1 新增表

```sql
CREATE TABLE identity_mappings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  local_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  external_id TEXT NOT NULL,           -- SCIM externalId 或 MDM UUID
  source TEXT NOT NULL,                -- 'scim' / 'mdm_service' / 'wechat_work'
  external_metadata JSONB DEFAULT '{}',
  last_synced_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(local_user_id, source)
);
```

### 3.2 同步流程

```
Webhook 事件到达 (user.created / user.updated / user.deleted / org.changed)
  ↓
EventRouter → 分发到对应 handler
  ↓
UserHandler:
  - created: INSERT INTO users + identity_mappings
  - updated: UPDATE users (仅同步主数据字段: name, phone, email, department, role, status)
             保留扩展字段: notify_prefs, parent_id
  - deleted: UPDATE users SET status = 'disabled'
OrgHandler:
  - 组织树变更 → 更新 users.department（不改 role）
```

### 3.3 冲突解决

| 来源 | 优先级 | 说明 |
|------|--------|------|
| MDM Service | 最高 | 组织级变更覆盖所有 |
| SCIM 直连 | 中 | 小系统直连同步 |
| SSE 本地管理 | 最低 | admin 手动修改仅在 MDM 断开时生效 |

优先级：`MDM > SCIM > SSE Local`

### 3.4 并行策略

MDM Webhook 和 SCIM 直连可以同时运行。Identity Bridge 先到先处理，最终以 MDM 为准。

---

## 4. SCIM 2.0 接口

### 4.1 端点

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/scim/Users` | 创建用户 |
| GET | `/scim/Users/:id` | 查询用户 |
| PUT | `/scim/Users/:id` | 全量更新 |
| PATCH | `/scim/Users/:id` | 部分更新 |
| GET | `/scim/Users` | 列表（支持 `filter` 查询） |
| GET | `/scim/Schemas` | 返回支持的模式 |

### 4.2 用户资源映射

```
SCIM User                →   SSE users
├── userName             →   phone（或用户名）
├── name.familyName      →   name
├── emails[0].value      →   email
├── phoneNumbers[0]      →   phone
├── active               →   status = 'active' / 'disabled'
├── "urn:sse:role"        →   role（SSE 扩展属性）
└── "urn:sse:department"  →   department
```

---

## 5. Webhook 事件契约

MDM Service 推送以下事件到 SSE：

| 事件 | 载荷 |
|------|------|
| `user.created` | `{ userId, name, phone, email, department, role }` |
| `user.updated` | 同上 + `changedFields[]` |
| `user.deleted` | `{ userId }` |
| `org.created` | `{ deptId, name, parentId }` |
| `org.updated` | `{ deptId, changedFields[] }` |
| `org.deleted` | `{ deptId }` |

---

## 6. 文件变更

| 文件 | 类型 | 说明 |
|------|------|------|
| `packages/db/src/migrations/003_identity_mappings.sql` | 新建 | identity_mappings 表 |
| `packages/api/src/routes/scim.ts` | 新建 | SCIM 2.0 端点 |
| `packages/api/src/routes/webhook.ts` | 新建 | MDM Webhook 接收 |
| `packages/api/src/services/identity-bridge.ts` | 新建 | 同步逻辑 |
| `packages/api/src/index.ts` | 修改 | 注册新路由 |

---

> 评审完成后与本体层方案一并进入实施计划阶段。
