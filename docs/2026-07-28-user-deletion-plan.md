# 人员删除功能 — 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现三种用户删除方式（硬删除 / 软删除 / 级联硬删除），扩展 status 枚举增加 deleted 状态，前端支持删除下拉菜单和已删除标签页。

**Architecture:** 最小侵入——迁移脚本新增 deleted_at 列；接口层补三个删除方法；仓库层实现关联校验、软删除、级联删除；API 路由改造现有 DELETE 端点支持 type 参数；前端 AdminUsers.vue 删除按钮改为下拉 + 新增标签页。

**Tech Stack:** PostgreSQL + TypeScript + Vue 3 + Element Plus 风格 CSS

**Spec:** `docs/2026-07-28-user-deletion-design.md`

---

## 文件结构

| 文件 | 变更 | 职责 |
|------|------|------|
| `packages/db/src/migrations/005_user_deleted_at.sql` | 新建 | 新增 deleted_at 列 |
| `packages/shared/src/types/user.ts` | 修改 | User 类型新增 deletedAt |
| `packages/core/src/ports/iuser-repo.ts` | 修改 | 接口新增 4 个方法 |
| `packages/db/src/repositories/pg-user-repo.ts` | 修改 | 实现 delete + 校验方法，更新 mapUser/列名 |
| `packages/api/src/routes/admin.ts` | 修改 | DELETE 路由改造，PUT 增加 deleted 保护，list 支持 include |
| `packages/web/src/pages/AdminUsers.vue` | 修改 | 删除按钮改为下拉菜单，新增已删除标签页 |

---

### Task 1: 数据库迁移 — 新增 deleted_at 列

**Files:**
- Create: `packages/db/src/migrations/005_user_deleted_at.sql`

- [ ] **Step 1: 创建迁移脚本**

```sql
ALTER TABLE users ADD COLUMN deleted_at TIMESTAMPTZ;
```

- [ ] **Step 2: 提交**

```bash
git add packages/db/src/migrations/005_user_deleted_at.sql
git commit -m "feat: add deleted_at column to users table"
```

---

### Task 2: 共享类型 — User 新增 deletedAt

**Files:**
- Modify: `packages/shared/src/types/user.ts:9-20`

- [ ] **Step 1: 添加 deletedAt 字段**

```typescript
export type User = {
  id: string;
  name: string;
  phone: string;
  email?: string;
  department: string;
  role: string;
  parentId?: string;
  status: string;
  notify_prefs?: NotifyPrefs;
  deletedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
};
```

- [ ] **Step 2: 编译验证**

```bash
pnpm --filter @sse/shared build
```

Expected: 编译通过，无类型错误

- [ ] **Step 3: 提交**

```bash
git add packages/shared/src/types/user.ts
git commit -m "feat: add deletedAt field to User type"
```

---

### Task 3: 核心接口 — IUserRepo 新增方法

**Files:**
- Modify: `packages/core/src/ports/iuser-repo.ts:1-9`

- [ ] **Step 1: 添加四个新方法**

```typescript
import type { User } from '@sse/shared';

export interface IUserRepo {
  findById(id: string): Promise<User | null>;
  findByPhone(phone: string): Promise<User | null>;
  findDeptApprovers(department: string): Promise<User[]>;
  findByRole(role: string, department?: string): Promise<User[]>;
  findAll(): Promise<User[]>;
  softDelete(id: string): Promise<void>;
  hardDelete(id: string): Promise<void>;
  cascadeDelete(id: string): Promise<void>;
  getRelatedDataCount(id: string): Promise<number>;
}
```

- [ ] **Step 2: 编译验证**

```bash
pnpm --filter @sse/core build
```

Expected: 编译通过

- [ ] **Step 3: 提交**

```bash
git add packages/core/src/ports/iuser-repo.ts
git commit -m "feat: add user delete methods to IUserRepo interface"
```

---

### Task 4: 数据库仓库 — 实现删除方法 + 更新映射

**Files:**
- Modify: `packages/db/src/repositories/pg-user-repo.ts:1-60`

- [ ] **Step 1: 更新 USER_COLUMNS 和 mapUser 以包含 deleted_at**

将第 5 行 `mapUser` 增加 `deletedAt` 映射，将第 20 行 `USER_COLUMNS` 增加 `deleted_at`：

```typescript
function mapUser(row: any): User {
  return {
    id: row.id,
    name: row.name,
    phone: row.phone,
    email: row.email ?? undefined,
    department: row.department,
    role: row.role,
    parentId: row.parent_id ?? undefined,
    status: row.status,
    deletedAt: row.deleted_at ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const USER_COLUMNS = 'id, name, phone, email, department, role, parent_id, status, deleted_at, created_at, updated_at';
```

- [ ] **Step 2: 添加四个新方法到 PgUserRepo 类**

在 `findAll()` 方法之后、类闭合 `}` 之前插入：

```typescript
  async softDelete(id: string): Promise<void> {
    await pool.query(
      "UPDATE users SET status = 'deleted', deleted_at = NOW(), updated_at = NOW() WHERE id = $1",
      [id]
    );
  }

  async hardDelete(id: string): Promise<void> {
    await pool.query('DELETE FROM users WHERE id = $1', [id]);
  }

  async cascadeDelete(id: string): Promise<void> {
    await pool.query('DELETE FROM identity_mappings WHERE local_user_id = $1', [id]);
    await pool.query('DELETE FROM notification_logs WHERE recipient_id = $1', [id]);
    await pool.query('DELETE FROM notification_logs WHERE sender_id = $1', [id]);
    await pool.query('DELETE FROM system_messages WHERE sender_id = $1', [id]);
    await pool.query('DELETE FROM invoices WHERE item_id IN (SELECT id FROM expense_items WHERE report_id IN (SELECT id FROM expense_reports WHERE user_id = $1))', [id]);
    await pool.query('DELETE FROM expense_items WHERE report_id IN (SELECT id FROM expense_reports WHERE user_id = $1)', [id]);
    await pool.query('DELETE FROM approval_records WHERE report_id IN (SELECT id FROM expense_reports WHERE user_id = $1)', [id]);
    await pool.query('DELETE FROM expense_reports WHERE user_id = $1', [id]);
    await pool.query('DELETE FROM users WHERE id = $1', [id]);
  }

  async getRelatedDataCount(id: string): Promise<number> {
    const { rows } = await pool.query(
      `SELECT
        COALESCE((SELECT COUNT(*) FROM expense_reports WHERE user_id = $1), 0) +
        COALESCE((SELECT COUNT(*) FROM approval_records WHERE approver_id = $1), 0) +
        COALESCE((SELECT COUNT(*) FROM notification_logs WHERE recipient_id = $1), 0) +
        COALESCE((SELECT COUNT(*) FROM notification_logs WHERE sender_id = $1), 0) +
        COALESCE((SELECT COUNT(*) FROM system_messages WHERE sender_id = $1), 0) +
        COALESCE((SELECT COUNT(*) FROM identity_mappings WHERE local_user_id = $1), 0)
        AS total`,
      [id]
    );
    return parseInt(rows[0].total, 10);
  }
```

- [ ] **Step 3: 编译验证**

```bash
pnpm --filter @sse/db build
```

- [ ] **Step 4: 提交**

```bash
git add packages/db/src/repositories/pg-user-repo.ts
git commit -m "feat: implement user delete methods and update mapUser for deleted_at"
```

---

### Task 5: API 路由 — DELETE 改造 + PUT 保护 + list 支持 deleted

**Files:**
- Modify: `packages/api/src/routes/admin.ts:16-17,91-180`

- [ ] **Step 1: 更新 USER_COLUMNS 和 mapUserRow**

将第 16 行的 `USER_COLUMNS` 和第 510 行的 `mapUserRow` 增加 `deleted_at`：

```typescript
const USER_COLUMNS = 'id, name, phone, email, department, role, parent_id, status, deleted_at, created_at, updated_at';
```

```typescript
function mapUserRow(row: any) {
  return {
    id: row.id,
    name: row.name,
    phone: row.phone,
    email: row.email ?? undefined,
    department: row.department,
    role: row.role,
    parentId: row.parent_id ?? undefined,
    status: row.status,
    deletedAt: row.deleted_at ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
```

- [ ] **Step 2: 修改 GET /users 支持 include=deleted 参数**

将第 91-97 行的 GET `/users` 改为：

```typescript
router.get(
  '/users',
  asyncWrap(async (req, res) => {
    const include = req.query.include as string | undefined;
    if (include === 'deleted') {
      const { rows } = await pool.query(
        `SELECT ${USER_COLUMNS} FROM users WHERE status = 'deleted' ORDER BY name`
      );
      res.json(rows.map(mapUserRow));
      return;
    }
    const { rows } = await pool.query(
      `SELECT ${USER_COLUMNS} FROM users WHERE status != 'deleted' ORDER BY name`
    );
    res.json(rows.map(mapUserRow));
  })
);
```

- [ ] **Step 3: 修改 PUT /users/:id 禁止恢复已删除用户**

在第 124-161 行的 PUT 路由中，在校验用户存在后、修改字段前，新增 `status` 变更校验：

在第 133 行 `throw new AppError(404, 'NOT_FOUND', '用户不存在');` 之后插入：

```typescript
    if (status !== undefined && user.status === 'deleted') {
      throw new AppError(400, 'INVALID_PARAMS', '已删除的用户不可修改状态');
    }
```

- [ ] **Step 4: 重写 DELETE /users/:id 支持三种删除类型**

将第 163-180 行的 DELETE 路由替换为：

```typescript
router.delete(
  '/users/:id',
  asyncWrap(async (req, res) => {
    const { id } = req.params;
    const deleteType = (req.query.type as string) || 'soft';

    const user = await userRepo.findById(id);
    if (!user) {
      throw new AppError(404, 'NOT_FOUND', '用户不存在');
    }

    if (deleteType === 'hard') {
      const relatedCount = await userRepo.getRelatedDataCount(id);
      if (relatedCount > 0) {
        throw new AppError(409, 'HAS_RELATED_DATA',
          `该用户存在 ${relatedCount} 条业务数据（报销单/审批记录/通知日志），请使用软删除或级联删除`);
      }
      await userRepo.hardDelete(id);
      res.json({ message: '用户已永久删除' });
    } else if (deleteType === 'cascade') {
      await userRepo.cascadeDelete(id);
      res.json({ message: '用户及所有关联数据已永久删除' });
    } else {
      await userRepo.softDelete(id);
      res.json({ message: '用户已删除', deletedAt: new Date().toISOString() });
    }
  })
);
```

- [ ] **Step 5: 编译验证**

```bash
pnpm --filter @sse/api build
```

- [ ] **Step 6: 提交**

```bash
git add packages/api/src/routes/admin.ts
git commit -m "feat: implement three user deletion types (hard/soft/cascade) in admin routes"
```

---

### Task 6: 前端 — 删除下拉菜单 + 已删除标签页

**Files:**
- Modify: `packages/web/src/pages/AdminUsers.vue:1-610`

- [ ] **Step 1: 在操作列添加删除下拉按钮，替换第 94-96 行**

将第 94-96 行的：
```html
              <td class="col-action">
                <span class="table-link" role="button" tabindex="0" @click="openEditModal(u)" @keydown.enter="openEditModal(u)">编辑</span>
              </td>
```

替换为：
```html
              <td class="col-action">
                <span v-if="u.status === 'deleted'" class="text-secondary" style="font-size:0.85rem">已删除于 {{ formatDate(u.deletedAt) }}</span>
                <template v-else>
                  <span class="table-link" role="button" tabindex="0" @click="openEditModal(u)" @keydown.enter="openEditModal(u)">编辑</span>
                  <div class="delete-dropdown">
                    <button class="table-link btn-delete" @click="toggleDeleteMenu(u.id)" :aria-label="`删除 ${u.name} 的选项`">删除</button>
                    <div v-if="deleteMenuOpen === u.id" class="delete-menu" @mouseleave="deleteMenuOpen = null">
                      <button @click="confirmDelete(u, 'hard')" :disabled="userRelatedCounts[u.id] > 0" :title="userRelatedCounts[u.id] > 0 ? '存在业务数据，无法硬删除' : ''">硬删除（无业务数据时可用）</button>
                      <button @click="confirmDelete(u, 'soft')">软删除（员工离职/失效）</button>
                      <button @click="confirmDelete(u, 'cascade')">级联删除（彻底清除所有数据）</button>
                    </div>
                  </div>
                </template>
              </td>
```

- [ ] **Step 2: 在工具栏中添加状态标签页，替换第 30-51 行**

将第 30-51 行工具栏改为：
```html
    <!-- 状态标签页 -->
    <div class="tabs-bar">
      <button class="tab-btn" :class="{ active: activeTab === 'active' }" @click="switchTab('active')">
        活跃<span class="tab-count">{{ activeCount }}</span>
      </button>
      <button class="tab-btn" :class="{ active: activeTab === 'disabled' }" @click="switchTab('disabled')">
        已禁用<span class="tab-count">{{ disabledCount }}</span>
      </button>
      <button class="tab-btn" :class="{ active: activeTab === 'deleted' }" @click="switchTab('deleted')">
        已删除<span class="tab-count">{{ deletedCount }}</span>
      </button>
    </div>

    <!-- 工具栏 -->
    <div class="toolbar">
      <select v-model="roleFilter" class="filter-select" aria-label="按角色筛选">
        <option value="">全部角色</option>
        <option v-for="r in roleOptions" :key="r.value" :value="r.value">{{ r.label }}</option>
      </select>
      <input
        v-model.trim="searchQuery"
        type="text"
        placeholder="搜索姓名或手机号..."
        class="search-input"
        aria-label="搜索用户"
      />
      <div class="toolbar-spacer"></div>
      <button v-if="activeTab !== 'deleted'" class="btn-primary" @click="openCreateModal">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
          <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
        </svg>
        新建用户
      </button>
    </div>
```

- [ ] **Step 3: 更新状态开关逻辑，deleted 用户不可操作**

将第 83-93 行的状态开关改为：
```html
            <td>
              <template v-if="u.status === 'deleted'">
                <span class="badge-deleted">已删除</span>
              </template>
              <template v-else>
                <label class="toggle-wrap" :title="u.status === 'active' ? '点击禁用' : '点击启用'">
                  <input
                    type="checkbox"
                    :checked="u.status === 'active'"
                    @change="toggleStatus(u)"
                    :aria-label="`${u.status === 'active' ? '禁用' : '启用'} ${u.name}`"
                  />
                  <span class="toggle-slider"></span>
                </label>
              </template>
            </td>
```

- [ ] **Step 4: 在 script 中添加新的响应式变量和方法**

在第 220-228 行变量声明区域添加：

```typescript
const activeTab = ref<'active' | 'disabled' | 'deleted'>('active')
const deleteMenuOpen = ref<string | null>(null)
const userRelatedCounts = ref<Record<string, number>>({})
const activeCount = ref(0)
const disabledCount = ref(0)
const deletedCount = ref(0)
```

修改 `fetchUsers`（第 260-267 行）以获取所有状态的用户：

```typescript
async function fetchUsers() {
  try {
    const { data: activeData } = await api.get('/admin/users')
    const activeUsers = activeData.users || activeData || []
    const { data: deletedData } = await api.get('/admin/users', { params: { include: 'deleted' } })
    const deletedUsers = (deletedData.users || deletedData || [])

    allUsers.value = [...activeUsers, ...deletedUsers]
    if (activeTab.value === 'deleted') {
      users.value = deletedUsers
    } else if (activeTab.value === 'disabled') {
      users.value = activeUsers.filter((u: any) => u.status === 'disabled')
    } else {
      users.value = activeUsers.filter((u: any) => u.status === 'active')
    }
    activeCount.value = activeUsers.filter((u: any) => u.status === 'active').length
    disabledCount.value = activeUsers.filter((u: any) => u.status === 'disabled').length
    deletedCount.value = deletedUsers.length
  } catch {
    users.value = []
  }
}
```

添加 `allUsers` 变量（在第 220 行 `const users` 之后）：

```typescript
const allUsers = ref<any[]>([])
```

添加 `switchTab` 方法：

```typescript
function switchTab(tab: 'active' | 'disabled' | 'deleted') {
  activeTab.value = tab
  fetchUsers()
}
```

添加 `toggleDeleteMenu` 方法：

```typescript
function toggleDeleteMenu(userId: string) {
  deleteMenuOpen.value = deleteMenuOpen.value === userId ? null : userId
}
```

添加 `confirmDelete` 方法：

```typescript
async function confirmDelete(u: any, type: 'hard' | 'soft' | 'cascade') {
  deleteMenuOpen.value = null
  const confirmTexts: Record<string, string> = {
    hard: '确定要永久删除该用户？',
    soft: '确定要删除该用户？删除后该用户无法登录和查看。',
    cascade: '⚠ 此操作将永久删除该用户及其所有报销单、审批记录、通知日志等数据，不可恢复！请输入用户名确认：'
  }
  if (type === 'cascade') {
    const input = prompt(confirmTexts[type])
    if (input !== u.name) {
      alert('用户名不匹配，操作已取消')
      return
    }
  } else {
    if (!confirm(confirmTexts[type])) return
  }
  try {
    await api.delete(`/admin/users/${u.id}`, { params: { type } })
    await Promise.all([fetchUsers(), fetchStats()])
  } catch (e: any) {
    const msg = e?.response?.data?.error?.message || e?.response?.data?.error || e?.message || '操作失败'
    alert(msg)
  }
}
```

添加 `formatDate` 方法：

```typescript
function formatDate(d?: string) {
  if (!d) return ''
  return new Date(d).toLocaleDateString('zh-CN')
}
```

- [ ] **Step 5: 修改 toggleStatus，deleted 用户不可切换**

将第 377-387 行的 `toggleStatus` 开头增加保护：

```typescript
async function toggleStatus(u: any) {
  if (u.status === 'deleted') return
  const newStatus = u.status === 'active' ? 'disabled' : 'active'
  // ... 其余不变
```

- [ ] **Step 6: 添加样式**

在 `</style>` 标签前（第 610 行前）添加：

```css
.tabs-bar {
  display: flex;
  gap: 4px;
  margin-bottom: 16px;
  border-bottom: 1px solid var(--border-light);
  padding-bottom: 0;
}
.tab-btn {
  padding: 8px 16px;
  background: none;
  border: none;
  border-bottom: 2px solid transparent;
  color: var(--text-secondary);
  font-size: 0.9rem;
  cursor: pointer;
  transition: all var(--transition);
  display: flex;
  align-items: center;
  gap: 6px;
}
.tab-btn:hover {
  color: var(--text-primary);
  border-bottom-color: var(--border);
}
.tab-btn.active {
  color: var(--accent-coral);
  border-bottom-color: var(--accent-coral);
  font-weight: 600;
}
.tab-count {
  font-size: 0.75rem;
  background: var(--bg-hover);
  padding: 1px 8px;
  border-radius: 10px;
  font-weight: 500;
}
.delete-dropdown {
  position: relative;
  display: inline-block;
}
.btn-delete {
  color: var(--accent-coral);
  opacity: 0.7;
}
.btn-delete:hover {
  opacity: 1;
}
.delete-menu {
  position: absolute;
  right: 0;
  top: 100%;
  background: var(--bg-card);
  border: 1px solid var(--border-light);
  border-radius: var(--radius);
  box-shadow: var(--shadow-lg);
  z-index: 50;
  min-width: 220px;
  padding: 4px 0;
}
.delete-menu button {
  display: block;
  width: 100%;
  padding: 8px 16px;
  text-align: left;
  background: none;
  border: none;
  color: var(--text-primary);
  font-size: 0.85rem;
  cursor: pointer;
  transition: background var(--transition);
}
.delete-menu button:hover:not(:disabled) {
  background: var(--bg-hover);
}
.delete-menu button:disabled {
  color: var(--text-muted);
  cursor: not-allowed;
}
.badge-deleted {
  display: inline-block;
  padding: 2px 8px;
  border-radius: var(--radius-sm);
  background: var(--bg-hover);
  color: var(--text-muted);
  font-size: 0.8rem;
}
```

- [ ] **Step 7: 编译验证**

```bash
pnpm --filter @sse/web build
```

- [ ] **Step 8: 提交**

```bash
git add packages/web/src/pages/AdminUsers.vue
git commit -m "feat: add delete dropdown menu, status tabs, and deleted user handling"
```

---

### Task 7: 全量编译 + 集成验证

- [ ] **Step 1: 全量编译**

```bash
pnpm build
```

Expected: 所有 12 个包编译通过

- [ ] **Step 2: 执行数据库迁移**

```bash
sudo docker exec -i sse-postgres-1 psql -U sse -d sse < packages/db/src/migrations/005_user_deleted_at.sql
```

- [ ] **Step 3: 手动验证三个删除场景**

1. 创建一个测试用户（无任何报销），使用"硬删除"——应成功
2. 创建一个测试用户，提交一条报销，使用"硬删除"——应被拦截提示有关联数据
3. 对该用户使用"软删除"——应成功，status 变 deleted，deleted_at 有值
4. 切换到"已删除"标签页——应能看到该用户
5. 在已删除标签页尝试编辑/切换状态——应不可操作
6. 使用"级联删除"——输入用户名确认后该用户及所有关联数据清除

- [ ] **Step 4: 提交**

```bash
git add -A
git commit -m "chore: full build and manual verification of user deletion"
```
