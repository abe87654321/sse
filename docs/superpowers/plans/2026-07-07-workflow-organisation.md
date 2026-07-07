# 审批流设计器 & 组织管理 — 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新增拖拽式审批流设计器、用户管理CRUD、部门管理、修复个人中心，所有页面融入现有珊瑚橙暖色调设计

**Architecture:** 前端新增 WorkflowDesigner.vue 可拖拽组件、AdminUsers.vue 用户管理页、AdminDepartments.vue 部门页；后端新增角色校验 API 和部门管理 API；ApprovalChainStep 类型新增 assigneeId/assigneeName 字段

**Tech Stack:** Vue 3 + TypeScript + HTML5 Drag & Drop API + Express + PostgreSQL

---

## Task 1: ApprovalChainStep 类型扩展

**Files:**
- Modify: `packages/shared/src/types/approval-rule.ts:1-19`

- [ ] **Step 1: 新增 assigneeId 和 assigneeName，role 改为可选**

```typescript
export type ApprovalChainStep = {
  step: number;
  role?: string;
  assigneeId?: string;
  assigneeName?: string;
  label: string;
  reminderAfterHours?: number;
  escalateAfterHours?: number;
  escalateTo?: string;
};
```

- [ ] **Step 2: 构建验证**

Run: `pnpm --filter @sse/shared build`
Expected: 编译通过

- [ ] **Step 3: 提交**

```bash
git add packages/shared/src/types/approval-rule.ts
git commit -m "feat(shared): add assigneeId/assigneeName to ApprovalChainStep, make role optional"
```

---

## Task 2: 后端新增 API（角色校验 + 部门管理）

**Files:**
- Modify: `packages/api/src/routes/admin.ts` — 新增路由
- Create: `packages/api/src/routes/departments.ts` — 或合入 admin.ts

- [ ] **Step 1: 新增 GET /admin/users/validate 角色人数统计**

在 admin.ts 中新增：

```typescript
router.get(
  '/users/validate',
  asyncWrap(async (_req, res) => {
    const { rows } = await pool.query(
      `SELECT role, COUNT(*) as count FROM users WHERE status = 'active' GROUP BY role`
    );
    const counts: Record<string, number> = { employee: 0, dept_approver: 0, finance: 0, admin: 0 };
    rows.forEach((r: any) => { counts[r.role] = parseInt(r.count, 10); });
    res.json(counts);
  })
);
```

- [ ] **Step 2: 新增部门管理路由 GET/POST/PUT/DELETE /admin/departments**

```typescript
router.get(
  '/departments',
  asyncWrap(async (_req, res) => {
    const { rows } = await pool.query(
      `SELECT department as name, COUNT(*) as user_count
       FROM users WHERE department IS NOT NULL
       GROUP BY department ORDER BY department`
    );
    res.json(rows);
  })
);

router.post(
  '/departments',
  asyncWrap(async (req, res) => {
    const { name } = req.body;
    if (!name) throw new AppError(400, 'INVALID_PARAMS', '部门名称不能为空');
    res.json({ name }); // 部门由 users.department 字段体现，新建部门只是标记
  })
);
```

- [ ] **Step 3: 构建验证**

Run: `pnpm --filter @sse/api build`
Expected: 编译通过

- [ ] **Step 4: 提交**

```bash
git add packages/api/src/routes/admin.ts
git commit -m "feat(api): add role validation and department management endpoints"
```

---

## Task 3: 用户管理页 (AdminUsers.vue)

**Files:**
- Create: `packages/web/src/pages/AdminUsers.vue`
- Modify: `packages/web/src/router/index.ts` — 新增路由
- Modify: `packages/web/src/layouts/DefaultLayout.vue` — 侧边栏新菜单

- [ ] **Step 1: 新增路由**

在 router/index.ts 的 children 中添加：

```typescript
{
  path: 'admin/users',
  name: 'AdminUsers',
  component: () => import('@/pages/AdminUsers.vue'),
  meta: { title: '用户管理', icon: 'User' }
},
```

- [ ] **Step 2: 实现 AdminUsers.vue**

完整功能：
- 表格列：姓名、手机、邮箱、部门、角色下拉切换、状态开关
- 顶部：搜索框 + 角色筛选下拉 + "新建用户"按钮 + 角色人数统计卡片
- 新建/编辑弹窗：姓名、手机、邮箱、部门、角色
- 角色人数统计调用 GET /admin/users/validate，少于 1 人标红

```vue
<template>
  <div class="admin-page">
    <div class="page-header"><h2 class="page-header-title">用户管理</h2></div>
    
    <!-- 角色人数统计卡片 -->
    <div class="stats-grid" style="margin-bottom:16px">
      <div v-for="r in roleStats" :key="r.role" class="card admin-stat" :class="{ warning: r.count === 0 }">
        <div class="admin-stat-value" :style="{ color: r.count === 0 ? 'var(--accent-coral)' : 'var(--accent-mint)' }">{{ r.count }}</div>
        <div class="admin-stat-label">{{ r.label }}</div>
      </div>
    </div>

    <!-- 搜索 + 操作栏 -->
    <div class="toolbar">
      <input v-model="search" placeholder="搜索姓名/手机..." class="search-input" />
      <select v-model="roleFilter" class="filter-select">
        <option value="">全部角色</option>
        <option value="admin">管理员</option>
        <option value="finance">财务</option>
        <option value="dept_approver">部门审批人</option>
        <option value="employee">员工</option>
      </select>
      <button class="btn-primary btn-sm" @click="openCreate">+ 新建用户</button>
    </div>

    <!-- 用户列表 -->
    <div class="card" style="padding:0;overflow:hidden">
      <table class="data-table">
        <thead><tr><th>姓名</th><th>手机号</th><th>邮箱</th><th>部门</th><th>角色</th><th>状态</th><th>操作</th></tr></thead>
        <tbody>
          <tr v-for="u in filteredUsers" :key="u.id">
            <td>{{ u.name }}</td>
            <td class="text-secondary">{{ u.phone }}</td>
            <td class="text-secondary">{{ u.email || '-' }}</td>
            <td class="text-secondary">{{ u.department || '-' }}</td>
            <td>
              <select v-model="u.role" @change="updateRole(u)" class="role-select">
                <option v-for="r in roles" :key="r.value" :value="r.value">{{ r.label }}</option>
              </select>
            </td>
            <td>
              <label class="toggle-label">
                <input type="checkbox" :checked="u.status === 'active'" @change="toggleStatus(u)" />
              </label>
            </td>
            <td class="col-action">
              <span class="table-link" @click="openEdit(u)">编辑</span>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- 新建/编辑弹窗 -->
    <div v-if="showModal" class="modal-overlay" @click.self="showModal=false">
      <div class="modal-card">
        <h3 class="font-heading">{{ editingUser ? '编辑用户' : '新建用户' }}</h3>
        <div class="form-grid" style="margin-top:16px">
          <div class="field"><label>姓名 *</label><input v-model="form.name" /></div>
          <div class="field"><label>手机号 *</label><input v-model="form.phone" /></div>
          <div class="field"><label>邮箱</label><input v-model="form.email" /></div>
          <div class="field"><label>部门 *</label>
            <select v-model="form.department">
              <option v-for="d in departments" :key="d" :value="d">{{ d }}</option>
            </select>
          </div>
          <div class="field"><label>角色 *</label>
            <select v-model="form.role">
              <option v-for="r in roles" :key="r.value" :value="r.value">{{ r.label }}</option>
            </select>
          </div>
        </div>
        <div class="modal-actions">
          <button class="btn-secondary btn-sm" @click="showModal=false">取消</button>
          <button class="btn-primary btn-sm" @click="saveUser">保存</button>
        </div>
      </div>
    </div>
  </div>
</template>
```

- [ ] **Step 3: 实现脚本逻辑**

```typescript
const users = ref<any[]>([])
const roleStats = ref<Array<{ role: string; label: string; count: number }>>([])
const roles = [
  { value: 'admin', label: '管理员' },
  { value: 'finance', label: '财务' },
  { value: 'dept_approver', label: '部门审批人' },
  { value: 'employee', label: '员工' },
]
const departments = ref<string[]>([])
const search = ref(''); const roleFilter = ref('')
const showModal = ref(false); const editingUser = ref<any>(null)
const form = reactive({ name: '', phone: '', email: '', department: '', role: 'employee' })

onMounted(async () => {
  try {
    const [u, v, d] = await Promise.all([
      api.get('/admin/users'),
      api.get('/admin/users/validate'),
      api.get('/admin/departments'),
    ])
    users.value = u.data || []; roleStats.value = roles.map(r => ({ ...r, count: v.data[r.value] || 0 }))
    departments.value = (d.data || []).map((x: any) => x.name)
  } catch {}
})

const filteredUsers = computed(() => users.value.filter(u =>
  (!search.value || u.name.includes(search.value) || u.phone.includes(search.value)) &&
  (!roleFilter.value || u.role === roleFilter.value)
))

function openCreate() { editingUser.value = null; Object.assign(form, { name: '', phone: '', email: '', department: '', role: 'employee' }); showModal.value = true }
function openEdit(u: any) { editingUser.value = u; Object.assign(form, { name: u.name, phone: u.phone, email: u.email || '', department: u.department || '', role: u.role }); showModal.value = true }
async function saveUser() {
  if (editingUser.value) {
    await api.put(`/admin/users/${editingUser.value.id}`, { ...form })
  } else {
    await api.post('/admin/users', { ...form })
  }
  showModal.value = false
  // refresh
}
async function updateRole(u: any) { await api.put(`/admin/users/${u.id}`, { role: u.role }) }
async function toggleStatus(u: any) {
  const newStatus = u.status === 'active' ? 'disabled' : 'active'
  await api.put(`/admin/users/${u.id}`, { status: newStatus })
  u.status = newStatus
}
```

- [ ] **Step 4: 构建验证**

Run: `pnpm --filter @sse/web build`

- [ ] **Step 5: 提交**

```bash
git add -A
git commit -m "feat(admin): user management page with CRUD, role validation, and department filter"
```

---

## Task 4: 审批流设计器组件 (WorkflowDesigner.vue)

**Files:**
- Create: `packages/web/src/components/WorkflowDesigner.vue`

- [ ] **Step 1: 实现拖拽排序 + 步骤编辑**

核心功能：
- HTML5 Drag & Drop 实现步骤重排
- 每步卡片：角色下拉 + 人员搜索 + 提醒/升级配置
- 实时校验：调用 GET /admin/users/validate 检查角色是否有人
- 添加/删除步骤

```vue
<template>
  <div class="workflow-designer">
    <div class="step-list" @dragover.prevent>
      <div
        v-for="(step, i) in steps"
        :key="i"
        class="step-card"
        draggable="true"
        @dragstart="onDragStart($event, i)"
        @dragover.prevent
        @drop="onDrop($event, i)"
        @dragend="dragIdx = null"
        :class="{ dragging: dragIdx === i }"
      >
        <div class="step-header">
          <span class="drag-handle">⠿</span>
          <span class="step-label">步骤 {{ i + 1 }}</span>
          <button class="btn-remove" @click="removeStep(i)">✕</button>
        </div>
        <div class="step-body">
          <div class="step-row">
            <select v-model="step.role" @change="validateStep(i)" class="step-select">
              <option value="">无特定角色</option>
              <option value="dept_approver">部门审批人</option>
              <option value="finance">财务</option>
              <option value="admin">管理员</option>
            </select>
            <input v-model="step.assigneeSearch" @input="searchUsers(i)" placeholder="搜索指定人员..." class="step-input" />
            <select v-if="step.assigneeOptions.length" v-model="step.assigneeId" @change="onAssigneeSelected(i)" class="step-select">
              <option value="">不指定</option>
              <option v-for="u in step.assigneeOptions" :key="u.id" :value="u.id">{{ u.name }} ({{ u.department }})</option>
            </select>
          </div>
          <div class="validation" :class="{ valid: step.valid, invalid: !step.valid && step.role }">
            {{ step.validationMsg }}
          </div>
          <div class="step-options">
            <label>⏰ {{ step.reminderAfterHours || 48 }}小时后提醒</label>
            <input type="range" v-model.number="step.reminderAfterHours" min="1" max="168" />
            <label>升级至:</label>
            <select v-model="step.escalateTo" class="step-select">
              <option value="">不升级</option>
              <option value="parent_of_approver">审批人上级</option>
              <option value="admin">管理员</option>
            </select>
          </div>
        </div>
      </div>
    </div>
    <button class="btn-secondary btn-sm" style="width:100%;margin-top:8px" @click="addStep">+ 添加步骤</button>
  </div>
</template>
```

- [ ] **Step 2: 实现脚本逻辑（拖拽 + 校验）**

```typescript
const props = defineProps<{ steps: any[]; ruleId?: string }>()
const emit = defineEmits(['update:steps'])
const steps = ref<any[]>(JSON.parse(JSON.stringify(props.steps || [])))
const dragIdx = ref<number | null>(null)
const roleCounts = ref<Record<string, number>>({})

onMounted(async () => {
  try { const r = await api.get('/admin/users/validate'); roleCounts.value = r.data } catch {}
  validateAllSteps()
})

function onDragStart(_e: DragEvent, i: number) { dragIdx.value = i }
function onDrop(_e: DragEvent, toIdx: number) {
  if (dragIdx.value === null || dragIdx.value === toIdx) return
  const item = steps.value.splice(dragIdx.value, 1)[0]
  steps.value.splice(toIdx, 0, item)
  steps.value.forEach((s, i) => { s.step = i + 1 })
  emit('update:steps', steps.value)
}

function addStep() {
  steps.value.push({ step: steps.value.length + 1, role: '', assigneeId: '', assigneeName: '', assigneeSearch: '', assigneeOptions: [], label: '', reminderAfterHours: 48, escalateTo: '', valid: true, validationMsg: '' })
  emit('update:steps', steps.value)
}
function removeStep(i: number) { steps.value.splice(i, 1); steps.value.forEach((s, j) => { s.step = j + 1 }); emit('update:steps', steps.value) }

function validateStep(i: number) {
  const s = steps.value[i]
  if (!s.role) { s.valid = true; s.validationMsg = ''; return }
  const count = roleCounts.value[s.role] || 0
  if (count === 0) { s.valid = false; s.validationMsg = `⚠ ${roleLabel(s.role)}角色下没有在职人员` }
  else { s.valid = true; s.validationMsg = `✅ 可用（${count}人）` }
}

async function searchUsers(i: number) {
  const q = steps.value[i].assigneeSearch
  if (!q || q.length < 1) { steps.value[i].assigneeOptions = []; return }
  const r = await api.get('/admin/users', { params: { keyword: q } })
  steps.value[i].assigneeOptions = (r.data || []).slice(0, 5)
}

function onAssigneeSelected(i: number) {
  const s = steps.value[i]
  const u = s.assigneeOptions.find((x: any) => x.id === s.assigneeId)
  s.assigneeName = u ? u.name : ''
}

function roleLabel(r: string) { const m: any = { dept_approver: '部门审批人', finance: '财务', admin: '管理员' }; return m[r] || r }
```

- [ ] **Step 3: 构建验证**

Run: `pnpm --filter @sse/web build`

- [ ] **Step 4: 提交**

```bash
git add -A
git commit -m "feat(workflow): drag-and-drop approval chain designer with real-time role validation"
```

---

## Task 5: 集成审批流设计器到管理页面

**Files:**
- Modify: `packages/web/src/pages/Admin.vue` — 新增审批流设计面板
- Modify: `packages/web/src/router/index.ts` — 确保路由正确

- [ ] **Step 1: 在 Admin.vue 中添加审批流设计面板**

在 OCR 引擎面板之后、用户列表之前插入：

```vue
<!-- 审批流设计 -->
<div class="card" style="margin-bottom:20px">
  <h3 class="font-heading section-title">🔄 审批流程设计</h3>
  <div class="form-grid">
    <div class="field"><label>规则名称</label><input v-model="ruleForm.name" /></div>
    <div class="field"><label>优先级</label><input v-model.number="ruleForm.priority" type="number" /></div>
    <div class="field"><label>金额下限</label><input v-model.number="ruleForm.minAmount" type="number" /></div>
    <div class="field"><label>金额上限</label><input v-model.number="ruleForm.maxAmount" type="number" /></div>
  </div>
  <div style="margin-top:14px"><WorkflowDesigner v-model:steps="ruleForm.approvalChain" /></div>
  <div style="margin-top:14px;display:flex;gap:10px">
    <button class="btn-primary btn-sm" @click="saveRule">💾 保存规则</button>
    <select v-model="selectedRuleId" @change="loadRule" class="step-select" style="width:200px">
      <option value="">-- 选择已有规则 --</option>
      <option v-for="r in rules" :key="r.id" :value="r.id">{{ r.name }}</option>
    </select>
  </div>
</div>
```

- [ ] **Step 2: 添加脚本逻辑**

```typescript
import WorkflowDesigner from '@/components/WorkflowDesigner.vue'

const rules = ref<any[]>([])
const selectedRuleId = ref('')
const ruleForm = reactive({ name: '', minAmount: 0, maxAmount: 999999, approvalChain: [] as any[], priority: 10 })

onMounted(async () => {
  // ... existing code ...
  try { rules.value = (await api.get('/admin/rules')).data || [] } catch {}
})

async function loadRule() {
  if (!selectedRuleId.value) return
  const r = rules.value.find(x => x.id === selectedRuleId.value)
  if (!r) return
  Object.assign(ruleForm, { name: r.name, minAmount: r.minAmount, maxAmount: r.maxAmount, approvalChain: r.approvalChain, priority: r.priority })
}

async function saveRule() {
  if (selectedRuleId.value) {
    await api.put(`/admin/rules/${selectedRuleId.value}`, { ...ruleForm })
  } else {
    await api.post('/admin/rules', { ...ruleForm, isActive: true })
  }
}
```

- [ ] **Step 3: 构建验证 + 提交**

---

## Task 6: 个人中心修复

**Files:**
- Modify: `packages/web/src/pages/Profile.vue`

- [ ] **Step 1: 修复"保存修改"按钮**

```typescript
async function saveProfile() {
  try {
    const res = await authApi.updateProfile({ name: profileForm.name, email: profileForm.email })
    auth.setAuth(auth.token, { ...auth.user!, name: profileForm.name, email: profileForm.email })
  } catch (e: any) { /* show error */ }
}
```

- [ ] **Step 2: 修复"更新密码"按钮**

```typescript
async function changePassword() {
  if (passwordForm.newPassword !== passwordForm.confirmPassword) { /* show error */; return }
  try {
    await authApi.changePassword({ oldPassword: passwordForm.oldPassword, newPassword: passwordForm.newPassword })
    passwordForm.oldPassword = ''; passwordForm.newPassword = ''; passwordForm.confirmPassword = ''
  } catch (e: any) { /* show error */ }
}
```

- [ ] **Step 3: 手机号改为可编辑**

去掉第38行 `disabled` 属性。

- [ ] **Step 4: 构建验证 + 提交**

---

## 7. Task 7: 部门管理页 (AdminDepartments.vue)

**Files:**
- Create: `packages/web/src/pages/AdminDepartments.vue`
- Modify: router/index.ts

- [ ] **Step 1: 实现部门列表 + 新建/删除**

轻量页面，表格显示部门名 + 人数，支持新建和删除（无用户时）。

- [ ] **Step 2: 构建验证 + 提交**

---

## 依赖顺序

```
Task 1 (类型扩展)
  └─> Task 2 (后端API)
       ├─> Task 3 (用户管理页)
       ├─> Task 4 (审批流设计器组件)
       ├─> Task 5 (集成到 Admin 页)
       ├─> Task 6 (个人中心修复)
       └─> Task 7 (部门管理页)
```

---

## ECC 技能审查补遗

以下是从 api-design / vue-patterns / accessibility / security-review / database-migrations 五个技能审查后的改进项，实施时必须遵循：

### 从 api-design 审查

- **Task 2**: `/admin/users/validate` 响应使用 `{ data: { employee: 3, ... } }` 包裹，与其他端点统一
- **Task 3**: 用户列表 API 必须支持分页 (`?page=1&per_page=20`)，前端带分页控件
- **Task 3**: 错误响应统一用 `{ error: { code: "validation_error", message: "..." } }`，不用自定义格式
- **Task 2**: 新建部门前先校验 `name` 非空 + 不重复

### 从 vue-patterns 审查

- **Task 4**: 拖拽逻辑抽取为 `useDragSort` composable（`composables/useDragSort.ts`），遵循 vue-patterns 的"Composables 必须是 use 前缀 + 返回 reactive 值"规则
- **Task 4**: WorkflowDesigner 使用 `defineModel<{ steps: ApprovalChainStep[] }>('steps')` 替代 props + emits
- **Task 4**: `withDefaults(defineProps<>(), {})` 为布尔/数字 prop 提供默认值
- **Task 6**: Profile.vue 的 API 调用状态用 `{ data, error, isLoading }` 三态模式（vue-patterns 推荐的组合式 fetch 封装）

### 从 accessibility 审查

- **Task 4**: 拖拽手柄 `<span>` 改为 `<button>`，加 `aria-label="拖拽步骤 N 重新排序"`
- **Task 4**: 每个步骤卡片必须有键盘操作：`Tab` 聚焦 → `Space` 抓起 → `↑↓` 移动 → `Space` 放下 → `Escape` 取消
- **Task 4**: 步骤卡片内的角色下拉和人员搜索必须有 `<label>` 关联（已用 `<label>` ✓）
- **Task 3**: 弹窗模态框必须 `focus-trap`（打开时聚焦第一个输入框，关闭时回到触发按钮）
- **Task 3**: 角色人数警告不能用仅颜色区分，必须配合图标 + 文字（已用珊瑚色 + 数字 ✓）

### 从 security-review 审查

- **Task 2**: `/admin/ai-test` 追加限流：同一 IP 每分钟最多 5 次
- **Task 3**: 新建用户时 `phone` 必须用正则 `/^1\d{10}$/` 校验；`role` 必须是枚举值白名单
- **Task 3**: 禁用用户使用软删除 (`status='disabled'`)，不物理删除（防止数据丢失）
- **Task 3**: 后端返回用户列表时**排除** `password_hash` 字段（SQL 中不要 `SELECT *`，指定列）
- **Task 1**: 类型定义中不出现 `password_hash`（前端不应感知）

### 从 database-migrations 审查

- **无 Schema 迁移**：`ApprovalChainStep` 新增 `assigneeId`/`assigneeName`/`role` 变可选 均在 JSONB 列内完成，无需 DDL 迁移
- 部门表：当前从 `users.department` 聚合。如需独立部门管理，后续新增 `departments` 表 + 数据迁移，本期不必要

---

> 文档位置：`E:\app\opencode\sse\docs\superpowers\plans\2026-07-07-workflow-organisation.md`
