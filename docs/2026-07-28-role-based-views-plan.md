# 报销详情页角色拆分 — 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 按角色拆分报销详情页——提交者视图与审批者视图分离，权限由服务端 `viewerActions` 统一计算，管理员拥全部权限。

**Architecture:** 后端 `GET /expenses/:id` 新增 `viewerActions` 字段，前端按此渲染按钮。新建 `ApprovalTimeline.vue` 组件复用，新建 `ApprovalHandle.vue` 审批者页面。`DELETE /expenses/:id` 对管理员放开状态限制。

**Spec:** `docs/2026-07-28-role-based-views-design.md`

---

## 文件结构

| 文件 | 变更 | 职责 |
|------|------|------|
| `packages/api/src/routes/expenses.ts` | 修改 | GET 返回 viewerActions；DELETE 管理员可删任意状态 |
| `packages/web/src/components/ApprovalTimeline.vue` | 新建 | 审批时间线公共组件 |
| `packages/web/src/pages/ExpenseDetail.vue` | 修改 | 按钮改用 viewerActions 驱动，引用 ApprovalTimeline |
| `packages/web/src/pages/ApprovalHandle.vue` | 新建 | 审批者独立页面 |
| `packages/web/src/pages/Approvals.vue` | 修改 | 卡片点击跳 /approvals/:reportId |
| `packages/web/src/router/index.ts` | 修改 | 新增 /approvals/:reportId 路由 |

---

### Task 1: 后端 — GET /expenses/:id 新增 viewerActions

**Files:** Modify `packages/api/src/routes/expenses.ts`

Read the file first. Find the `res.json({` block at ~line 187 that currently returns:
```typescript
    res.json({
      report,
      items,
      invoices,
      approvalRecords: enrichedRecords,
      ruleName,
    });
```

- [ ] **Step 1: Compute viewerActions before res.json**

Insert this code block between the `ruleName` extraction (line 175 `} catch`) and the `const itemIds` line (line 177):

```typescript
    const { role, userId } = req.user!;
    const isOwner = report.userId === userId;
    const isAdmin = role === UserRole.ADMIN;
    const isDraftOrRejected = report.status === ReportStatus.DRAFT || report.status === ReportStatus.REJECTED;
    const isPending = report.status === ReportStatus.PENDING;

    let canApprove = false;
    let canReject = false;
    if (isPending && !isOwner) {
      const pendingRecord = records.find(r => r.result === ApprovalResult.PENDING && r.approverId === role);
      if (pendingRecord) {
        canApprove = true;
        canReject = true;
      }
    }

    const viewerActions = {
      canEdit: (isAdmin || (isOwner && isDraftOrRejected)),
      canSubmit: (isAdmin || (isOwner && isDraftOrRejected)),
      canDelete: (isAdmin || (isOwner && report.status === ReportStatus.DRAFT)),
      canApprove: isAdmin || canApprove,
      canReject: isAdmin || canReject,
    };
```

- [ ] **Step 2: Add viewerActions to the response**

Change the res.json to:
```typescript
    res.json({
      report,
      items,
      invoices,
      approvalRecords: enrichedRecords,
      ruleName,
      viewerActions,
    });
```

- [ ] **Step 3: Verify admin role import**

Ensure `UserRole` is imported at the top of the file. If not already:
```typescript
import { ReportStatus, UserRole, ApprovalResult } from '@sse/shared';
```

- [ ] **Step 4: Edit DELETE route to allow admin deletion of any status**

Find lines 332-337:
```typescript
    if (report.userId !== req.user!.userId) {
      throw new AppError(403, 'UNAUTHORIZED', '无权删除此报销单');
    }
    if (report.status !== ReportStatus.DRAFT) {
      throw new AppError(400, 'INVALID_PARAMS', '只能删除草稿状态的报销单');
    }
```

Replace with:
```typescript
    const isAdmin = req.user!.role === UserRole.ADMIN;
    if (!isAdmin && report.userId !== req.user!.userId) {
      throw new AppError(403, 'UNAUTHORIZED', '无权删除此报销单');
    }
    if (!isAdmin && report.status !== ReportStatus.DRAFT) {
      throw new AppError(400, 'INVALID_PARAMS', '只能删除草稿状态的报销单');
    }
```

- [ ] **Step 5: Build and verify**

```bash
pnpm --filter @sse/api build
```

- [ ] **Step 6: Commit**

```bash
git add packages/api/src/routes/expenses.ts
git commit -m "feat: add viewerActions to GET /expenses/:id, allow admin delete any status"
```

---

### Task 2: 前端 — 抽取 ApprovalTimeline.vue 组件

**Files:** Create `packages/web/src/components/ApprovalTimeline.vue`

- [ ] **Step 1: Read ExpenseDetail.vue timeline template and style**

From ExpenseDetail.vue, find:
- The timeline template section (lines 95-108: the `<div class="card">` with "审批流程")
- The timeline CSS styles (lines ~345-370 in `<style scoped>`)

Extract them into a new component.

- [ ] **Step 2: Create ApprovalTimeline.vue**

```vue
<template>
  <div class="card">
    <h3 class="card-section-title font-heading">审批流程</h3>
    <div v-if="ruleName" class="rule-name">规则：{{ ruleName }}</div>
    <div v-if="items.length === 0" class="no-data">暂无审批记录</div>
    <div v-else class="timeline">
      <div v-for="(step, i) in items" :key="i" class="timeline-step" :class="{ last: i === items.length - 1 }">
        <div class="timeline-dot" :class="{ done: step.done, current: step.active }"></div>
        <div class="timeline-content">
          <div class="timeline-title">{{ step.title }}</div>
          <div class="timeline-desc">{{ step.desc }}</div>
          <div class="timeline-time" v-if="step.time">{{ step.time }}</div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
defineProps<{
  items: Array<{ title: string; desc: string; time: string; done: boolean; active: boolean }>
  ruleName?: string
}>()
</script>

<style scoped>
.timeline { position: relative; padding-left: 24px; }
.timeline-step { position: relative; padding-bottom: 20px; }
.timeline-step.last { padding-bottom: 0; }
.timeline-dot {
  position: absolute; left: -20px; top: 4px;
  width: 12px; height: 12px; border-radius: 50%;
  background: var(--border); border: 2px solid var(--border);
}
.timeline-dot.done { background: var(--accent-mint); border-color: var(--accent-mint); }
.timeline-dot.current { background: var(--accent-coral); border-color: var(--accent-coral); box-shadow: 0 0 0 4px rgba(255,107,107,0.15); }
.timeline-step:not(.last)::before {
  content: ''; position: absolute; left: -15px; top: 18px;
  width: 2px; height: calc(100% - 2px); background: var(--border-light);
}
.timeline-title { font-size: 0.9rem; font-weight: 600; color: var(--text-primary); }
.timeline-desc { font-size: 0.8rem; color: var(--text-muted); margin-top: 2px; }
.rule-name { font-size: 0.78rem; color: var(--accent-sky); margin-bottom: 10px; padding: 4px 10px; background: var(--accent-sky-bg); border-radius: var(--radius-sm); display: inline-block; }
.no-data { font-size: 0.85rem; color: var(--text-muted); padding: 20px 0; text-align: center; }
</style>
```

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/components/ApprovalTimeline.vue
git commit -m "feat: extract ApprovalTimeline component from ExpenseDetail"
```

---

### Task 3: 前端 — 更新 ExpenseDetail.vue 使用 viewerActions

**Files:** Modify `packages/web/src/pages/ExpenseDetail.vue`

- [ ] **Step 1: Import ApprovalTimeline**

Add import:
```typescript
import ApprovalTimeline from '../components/ApprovalTimeline.vue'
```

- [ ] **Step 2: Update button template**

Find the header-actions section (lines 18-26). Replace with:
```html
      <div class="header-actions">
        <template v-if="viewerActions">
          <button v-if="viewerActions.canEdit" class="btn-secondary btn-sm" @click="$router.push(`/expenses/${report.id}/edit`)">编辑</button>
          <button v-if="viewerActions.canDelete" class="btn-danger-outline btn-sm" @click="handleDelete" :disabled="deleting">{{ deleting ? '删除中...' : '删除' }}</button>
          <button v-if="viewerActions.canSubmit" class="btn-primary btn-sm" @click="handleSubmit">提交审批</button>
          <button v-if="viewerActions.canApprove" class="btn-primary btn-sm" style="background: linear-gradient(135deg, var(--accent-mint), #69db7c);" @click="handleApprove">审批通过</button>
          <button v-if="viewerActions.canReject" class="btn-danger btn-sm" @click="handleReject">驳回</button>
        </template>
      </div>
```

- [ ] **Step 3: Replace timeline section with ApprovalTimeline component**

Find the timeline card section:
```html
          <div class="card">
            <h3 class="card-section-title font-heading">审批流程</h3>
            <div v-if="timeline.length > 0 && timeline[0].rule" class="rule-name">规则：{{ timeline[0].rule }}</div>
            <div v-if="timeline.length === 0" class="no-data">暂无审批记录</div>
            <div v-else class="timeline">
              ...
            </div>
          </div>
```

Replace with:
```html
          <ApprovalTimeline :items="timeline" :rule-name="timeline.length > 0 ? timeline[0].rule : ''" />
```

- [ ] **Step 4: Add viewerActions ref and load it from API response**

Add ref:
```typescript
const viewerActions = ref<{ canEdit: boolean; canSubmit: boolean; canDelete: boolean; canApprove: boolean; canReject: boolean } | null>(null)
```

In the onMounted handler, after setting `report.value`, add:
```typescript
    viewerActions.value = data.viewerActions || null
```

- [ ] **Step 5: Add handleApprove and handleReject methods** (if removed earlier, add back):

```typescript
async function handleApprove() {
  try {
    await api.post(`/approvals/${route.params.id}/approve`, {})
    router.replace('/expenses')
  } catch (e: any) {
    alert(e?.response?.data?.error?.message || '审批失败')
  }
}

async function handleReject() {
  const comment = prompt('请输入驳回原因：')
  if (!comment) return
  try {
    await api.post(`/approvals/${route.params.id}/reject`, { comment })
    router.replace('/expenses')
  } catch (e: any) {
    alert(e?.response?.data?.error?.message || '驳回失败')
  }
}
```

- [ ] **Step 6: Clean up unused timeline CSS** — remove the timeline-related CSS rules that are now in the component. Remove: `.timeline`, `.timeline-step`, `.timeline-dot`, `.rule-name`, `.timeline-title`, `.timeline-desc`.

- [ ] **Step 7: Build**

```bash
pnpm --filter @sse/web build
```

- [ ] **Step 8: Commit**

```bash
git add packages/web/src/pages/ExpenseDetail.vue
git commit -m "feat: use viewerActions for button visibility, replace inline timeline with ApprovalTimeline component"
```

---

### Task 4: 前端 — 新建 ApprovalHandle.vue

**Files:** Create `packages/web/src/pages/ApprovalHandle.vue`

- [ ] **Step 1: Create the page**

```vue
<template>
  <div class="expense-detail">
    <div class="page-header">
      <button class="btn-icon" @click="$router.back()">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="15 18 9 12 15 6"/>
        </svg>
      </button>
      <div class="header-title-area">
        <div class="header-meta">
          <span class="serial-no">{{ report?.serialNo }}</span>
          <span class="badge" :class="`badge-${report?.status}`">{{ statusLabels[report?.status || ''] }}</span>
        </div>
        <h1 class="header-title font-heading">{{ report?.title }}</h1>
      </div>
      <div class="header-spacer"></div>
      <div class="header-actions">
        <template v-if="viewerActions">
          <button v-if="viewerActions.canApprove" class="btn-primary btn-sm" style="background: linear-gradient(135deg, var(--accent-mint), #69db7c);" @click="handleApprove" :disabled="acting">{{ acting ? '处理中...' : '审批通过' }}</button>
          <button v-if="viewerActions.canReject" class="btn-danger btn-sm" @click="showRejectInput = true" :disabled="acting">{{ acting ? '处理中...' : '驳回' }}</button>
          <button v-if="viewerActions.canEdit" class="btn-secondary btn-sm" @click="$router.push(`/expenses/${report?.id}/edit`)">编辑</button>
          <button v-if="viewerActions.canDelete" class="btn-danger-outline btn-sm" @click="handleDelete">删除</button>
        </template>
      </div>
    </div>
    <div v-if="showRejectInput" class="reject-overlay" @click.self="showRejectInput = false">
      <div class="reject-dialog">
        <h3>驳回原因</h3>
        <textarea v-model="rejectComment" placeholder="请输入驳回原因" rows="3"></textarea>
        <div class="reject-actions">
          <button class="btn-secondary btn-sm" @click="showRejectInput = false">取消</button>
          <button class="btn-danger btn-sm" @click="confirmReject" :disabled="!rejectComment.trim()">确认驳回</button>
        </div>
      </div>
    </div>

    <div v-if="loading" class="loading-state">加载中...</div>

    <template v-else-if="report">
      <div class="detail-grid">
        <div class="detail-main">
          <div class="card">
            <h3 class="card-section-title font-heading">基本信息</h3>
            <div class="info-grid">
              <div class="info-item">
                <span class="info-label">申请人</span>
                <span class="info-value">{{ applicantName }}</span>
              </div>
              <div class="info-item">
                <span class="info-label">提交时间</span>
                <span class="info-value">{{ formatDate(report.submittedAt) }}</span>
              </div>
              <div class="info-item">
                <span class="info-label">更新时间</span>
                <span class="info-value">{{ formatDate(report.updatedAt) }}</span>
              </div>
              <div class="info-item full">
                <span class="info-label">说明</span>
                <span class="info-value">{{ report.description || '无' }}</span>
              </div>
            </div>
          </div>

          <div class="card">
            <h3 class="card-section-title font-heading">费用明细</h3>
            <table class="data-table">
              <thead>
                <tr>
                  <th>类别</th>
                  <th>日期</th>
                  <th>说明</th>
                  <th class="text-right">金额</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="item in report.items" :key="item.id">
                  <td>{{ getCategoryName(item.categoryId) || '费用项' }}</td>
                  <td class="text-secondary">{{ item.expenseDate }}</td>
                  <td>{{ item.description || '-' }}</td>
                  <td class="text-right">&yen;{{ item.amount.toLocaleString() }}</td>
                </tr>
              </tbody>
              <tfoot>
                <tr>
                  <td colspan="3" class="text-right" style="font-weight:600;">合计</td>
                  <td class="text-right" style="font-weight:700;color:var(--accent-coral);font-size:1.1rem;">&yen;{{ report.totalAmount.toLocaleString() }}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>

        <div class="detail-side">
          <ApprovalTimeline :items="timeline" :rule-name="timeline.length > 0 ? timeline[0].rule : ''" />
        </div>
      </div>
    </template>
    <div v-else class="loading-state">未找到报销记录</div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import api from '../api/index'
import ApprovalTimeline from '../components/ApprovalTimeline.vue'

const route = useRoute()
const router = useRouter()

const statusLabels: Record<string, string> = {
  draft: '草稿', pending: '待审批', approved: '已通过', rejected: '已驳回', paid: '已付款'
}

const loading = ref(true)
const acting = ref(false)
const showRejectInput = ref(false)
const rejectComment = ref('')
const report = ref<any>(null)
const applicantName = ref('')
const timeline = ref<Array<{ title: string; desc: string; time: string; rule?: string; done: boolean; active: boolean }>>([])
const viewerActions = ref<{ canEdit: boolean; canSubmit: boolean; canDelete: boolean; canApprove: boolean; canReject: boolean } | null>(null)
const categories = ref<any[]>([])

function formatDate(dateStr?: string) {
  if (!dateStr) return '-'
  const d = new Date(dateStr)
  if (isNaN(d.getTime())) return dateStr
  const pad = (n: number) => n.toString().padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function getCategoryName(categoryId: string) {
  return categories.value.find((c: any) => c.id === categoryId)?.name
}

async function handleApprove() {
  acting.value = true
  try {
    await api.post(`/approvals/${route.params.reportId}/approve`, {})
    router.replace('/approvals')
  } catch (e: any) {
    alert(e?.response?.data?.error?.message || '审批失败')
  } finally {
    acting.value = false
  }
}

async function confirmReject() {
  if (!rejectComment.value.trim()) return
  acting.value = true
  try {
    await api.post(`/approvals/${route.params.reportId}/reject`, { comment: rejectComment.value })
    router.replace('/approvals')
  } catch (e: any) {
    alert(e?.response?.data?.error?.message || '驳回失败')
  } finally {
    acting.value = false
  }
}

async function handleDelete() {
  if (!confirm('确认删除该报销记录？此操作不可撤销。')) return
  try {
    await api.delete(`/expenses/${route.params.reportId}`)
    router.replace('/approvals')
  } catch (e: any) {
    alert(e?.response?.data?.error?.message || '删除失败')
  }
}

onMounted(async () => {
  try {
    const expenseRes = await api.get(`/expenses/${route.params.reportId}`)
    const data = expenseRes.data
    report.value = { ...(data.report || data), items: data.items || [], invoices: data.invoices || [] }
    report.value.totalAmount = report.value.totalAmount || report.value.items?.reduce((s: number, i: any) => s + (i.amount || 0), 0) || 0
    viewerActions.value = data.viewerActions || null
    applicantName.value = data.report?.applicantName || (data.report ? '' : '')

    try {
      const catRes = await api.get('/categories')
      categories.value = catRes.data || []
    } catch { /* optional */ }

    const records = data.approvalRecords || []
    const ruleName = data.ruleName || ''
    timeline.value = records.map((r: any, i: number, arr: any[]) => ({
      title: `第${r.step}步${r.approverName ? ` — ${r.approverName}` : ''}`,
      desc: r.result === 'approved' ? `审批通过${r.comment ? `（${r.comment}）` : ''}` : r.result === 'rejected' ? `驳回${r.comment ? `：${r.comment}` : ''}` : '待审批',
      time: r.approvedAt ? formatDate(r.approvedAt) : (r.stepStartedAt ? formatDate(r.stepStartedAt) : ''),
      rule: i === 0 ? ruleName : '',
      done: r.result === 'approved',
      active: r.result === 'pending',
    }))

    // resolve applicant name
    try {
      const { data: users } = await api.get('/admin/users')
      const allUsers = users || []
      const found = allUsers.find((u: any) => u.id === (data.report?.userId || ''))
      if (found) applicantName.value = found.name
    } catch { /* optional */ }
  } catch (e: any) {
    if (e?.response?.status === 404) report.value = null
  } finally {
    loading.value = false
  }
})
</script>

<style scoped>
@import '../styles/detail-shared.css';
.header-spacer { flex: 1; }
.header-title-area { flex: 1; }
.header-meta { display: flex; align-items: center; gap: 10px; margin-bottom: 6px; }
.serial-no { font-size: 0.8rem; color: var(--text-muted); }
.header-title { font-size: 1.4rem; font-weight: 700; letter-spacing: 0.02em; }
.header-actions { display: flex; gap: 8px; flex-shrink: 0; }
.detail-grid { display: grid; grid-template-columns: 1fr 320px; gap: 20px; }
.detail-main { display: flex; flex-direction: column; gap: 16px; }
.detail-side { display: flex; flex-direction: column; gap: 16px; }
.info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
.info-item.full { grid-column: span 2; }
.info-label { display: block; font-size: 0.78rem; color: var(--text-muted); margin-bottom: 4px; }
.info-value { font-size: 0.9rem; color: var(--text-primary); }
.loading-state { text-align: center; padding: 40px; color: var(--text-muted); font-size: 1rem; }
.reject-overlay { position: fixed; inset: 0; background: rgba(45,36,32,0.4); backdrop-filter: blur(4px); display: flex; align-items: center; justify-content: center; z-index: 200; }
.reject-dialog { background: var(--bg-card); border-radius: var(--radius-lg); padding: 24px; width: 400px; max-width: 90vw; }
.reject-dialog h3 { margin-bottom: 12px; font-size: 1.1rem; }
.reject-dialog textarea { width: 100%; padding: 10px; border: 1px solid var(--border); border-radius: var(--radius-sm); resize: vertical; font-size: 0.9rem; }
.reject-actions { display: flex; gap: 8px; justify-content: flex-end; margin-top: 12px; }
@media (max-width: 768px) { .detail-grid { grid-template-columns: 1fr; } }
</style>
```

> Note: Also create `packages/web/src/styles/detail-shared.css` with the shared styles used by both ExpenseDetail and ApprovalHandle (page-header, btn-icon, card styles etc.) — extract from ExpenseDetail.vue.

- [ ] **Step 2: Build**

```bash
pnpm --filter @sse/web build
```

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/pages/ApprovalHandle.vue packages/web/src/styles/detail-shared.css
git commit -m "feat: add ApprovalHandle page for approver view with reject/approve"
```

---

### Task 5: 前端 — 更新 Approvals.vue 跳转 + 路由

**Files:** Modify `packages/web/src/pages/Approvals.vue`, `packages/web/src/router/index.ts`

- [ ] **Step 1: Update Approvals.vue navigation**

Find line 17:
```html
<div class="approval-main" @click="$router.push(`/expenses/${item.reportId}`)">
```

Change to:
```html
<div class="approval-main" @click="$router.push(`/approvals/${item.reportId}`)">
```

- [ ] **Step 2: Add route**

In `router/index.ts`, add after the `path: 'approvals'` route:
```typescript
      {
        path: 'approvals/:reportId',
        name: 'ApprovalHandle',
        component: () => import('@/pages/ApprovalHandle.vue'),
        meta: { title: '审批处理', hidden: true }
      },
```

- [ ] **Step 3: Build**

```bash
pnpm --filter @sse/web build
```

- [ ] **Step 4: Commit**

```bash
git add packages/web/src/pages/Approvals.vue packages/web/src/router/index.ts
git commit -m "feat: route approvals card clicks to ApprovalHandle page"
```

---

### Task 6: 全量编译 + 验证

- [ ] **Step 1: Full build**

```bash
pnpm build
```

- [ ] **Step 2: Manual verification**

1. 员工登录 → 创建报销 → 提交 → 报销详情页显示"编辑/提交审批"按钮（无审批按钮）
2. 部门审批人登录 → 审批管理 → 点击卡片 → 进入 ApprovalHandle 页面 → 显示"审批通过/驳回"
3. 管理员登录 → 任意入口 → 显示全部按钮（编辑/删除/审批）
4. 管理员删除非草稿报销单 → 审批记录同时清除

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "chore: full build verification for role-based expense views"
```
