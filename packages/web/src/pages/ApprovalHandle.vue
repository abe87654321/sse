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
                <tr><th>类别</th><th>日期</th><th>说明</th><th class="text-right">金额</th></tr>
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
    applicantName.value = data.report?.applicantName || ''

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
