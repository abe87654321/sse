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
          <button v-if="viewerActions.canEdit" class="btn-secondary btn-sm" @click="$router.push(`/expenses/${report.id}/edit`)">编辑</button>
          <button v-if="viewerActions.canDelete" class="btn-danger-outline btn-sm" @click="confirmAction = 'delete'" :disabled="deleting">{{ deleting ? '删除中...' : '删除' }}</button>
          <button v-if="viewerActions.canSubmit" class="btn-primary btn-sm" @click="handleSubmit">提交审批</button>
          <button v-if="viewerActions.canApprove" class="btn-primary btn-sm" style="background: linear-gradient(135deg, var(--accent-mint), #69db7c);" @click="handleApprove">审批通过</button>
          <button v-if="viewerActions.canReject" class="btn-danger btn-sm" @click="confirmAction = 'reject'">驳回</button>
          <button v-if="viewerActions.canPay" class="btn-primary btn-sm" style="background: linear-gradient(135deg, var(--accent-sky), #4dabf7);" @click="handlePay">确认打款</button>
        </template>
      </div>
    </div>

    <div v-if="confirmAction" class="confirm-overlay" @click.self="confirmAction = null">
      <div class="confirm-dialog">
        <h3 v-if="confirmAction === 'delete'">确认删除</h3>
        <h3 v-else>驳回原因</h3>
        <p v-if="confirmAction === 'delete'" style="color:var(--text-secondary);margin-bottom:16px;">确认删除该报销记录？此操作不可撤销。</p>
        <textarea v-if="confirmAction === 'reject'" v-model="rejectComment" placeholder="请输入驳回原因" rows="3"></textarea>
        <div class="confirm-actions">
          <button class="btn-secondary btn-sm" @click="confirmAction = null; rejectComment = ''">取消</button>
          <button v-if="confirmAction === 'delete'" class="btn-danger btn-sm" @click="execDelete">确认删除</button>
          <button v-else class="btn-danger btn-sm" @click="execReject" :disabled="!rejectComment.trim()">确认驳回</button>
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
                <span class="info-label">提交时间</span>
                <span class="info-value">{{ formatDate(report.submittedAt) }}</span>
              </div>
              <div class="info-item">
                <span class="info-label">创建时间</span>
                <span class="info-value">{{ formatDate(report.createdAt) }}</span>
              </div>
              <div class="info-item">
                <span class="info-label">更新时间</span>
                <span class="info-value">{{ formatDate(report.updatedAt) }}</span>
              </div>
              <div class="info-item">&nbsp;</div>
              <div class="info-item full">
                <span class="info-label">说明</span>
                <span class="info-value">{{ report.description || '无' }}</span>
              </div>
              <template v-if="report.paidAt">
                <div class="info-item">
                  <span class="info-label">打款时间</span>
                  <span class="info-value">{{ formatDate(report.paidAt) }}</span>
                </div>
                <div class="info-item">
                  <span class="info-label">打款凭证</span>
                  <span class="info-value">{{ report.paymentRef || '-' }}</span>
                </div>
              </template>
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
                  <th>发票</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="item in report.items" :key="item.id">
                  <td>{{ getCategoryName(item.categoryId) || '费用项' }}</td>
                  <td class="text-secondary">{{ item.expenseDate }}</td>
                  <td>{{ item.description || '-' }}</td>
                  <td class="text-right">&yen;{{ item.amount.toLocaleString() }}</td>
                  <td>
                    <template v-if="getInvoice(item.id)">
                      &#x1f4ce; {{ getInvoice(item.id)!.fileName }}
                      <span class="table-link" @click="downloadInvoice(item.id, getInvoice(item.id)!)">下载</span>
                    </template>
                    <span v-else class="no-invoice">未上传</span>
                  </td>
                </tr>
              </tbody>
              <tfoot>
                <tr>
                  <td colspan="4" class="text-right" style="font-weight:600;">合计</td>
                  <td class="text-right" style="font-weight:700;color:var(--accent-coral);font-size:1.1rem;">&yen;{{ report.totalAmount.toLocaleString() }}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>

        <div class="detail-side">
          <ApprovalTimeline :items="timeline" :rule-name="timeline.length > 0 ? timeline[0].rule : ''" />

          <div class="card">
            <h3 class="card-section-title font-heading">发票文件</h3>
            <div v-if="report.invoices?.length" class="attachment-list">
              <div v-for="inv in report.invoices" :key="inv.id" class="attachment-item">
                <span class="attachment-emoji">&#128206;</span>
                <span>{{ inv.fileName }}</span>
                <span class="table-link" @click="downloadInvoiceFile(inv)">下载</span>
              </div>
            </div>
            <div v-else class="no-data">暂无发票文件</div>
          </div>
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

interface Category { id: string; name: string }
interface InvoiceItem { id: string; itemId: string; fileName: string }
interface ExpenseItem { id: string; categoryId: string; amount: number; expenseDate: string; description: string }
interface Report {
  id: string; serialNo: string; title: string; totalAmount: number; status: string
  description?: string; submittedAt?: string; createdAt?: string; updatedAt?: string
  paidAt?: string; paymentRef?: string
  items: ExpenseItem[]
  invoices?: InvoiceItem[]
}

const loading = ref(true)
const report = ref<Report | null>(null)
const categories = ref<Category[]>([])
const timeline = ref<Array<{ title: string; desc: string; time: string; rule?: string; done: boolean; active: boolean }>>([])
const viewerActions = ref<{ canEdit: boolean; canSubmit: boolean; canDelete: boolean; canApprove: boolean; canReject: boolean; canPay: boolean } | null>(null)
const deleting = ref(false)
const confirmAction = ref<'delete' | 'reject' | null>(null)
const rejectComment = ref('')

function formatDate(dateStr?: string) {
  if (!dateStr) return '-'
  const d = new Date(dateStr)
  if (isNaN(d.getTime())) return dateStr
  const pad = (n: number) => n.toString().padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function getCategoryName(categoryId: string) {
  return categories.value.find(c => c.id === categoryId)?.name
}

function getInvoice(itemId: string) {
  return report.value?.invoices?.find(inv => inv.itemId === itemId)
}

async function downloadInvoice(itemId: string, invoice: InvoiceItem) {
  try {
    const res = await api.get(`/expenses/${route.params.id}/items/${itemId}/invoice/${invoice.id}/download`)
    window.open(res.data.url, '_blank')
  } catch (e: any) {
    alert(e?.response?.data?.error?.message || '下载失败')
  }
}

async function downloadInvoiceFile(invoice: InvoiceItem) {
  try {
    const res = await api.get(`/expenses/${route.params.id}/items/${invoice.itemId}/invoice/${invoice.id}/download`)
    window.open(res.data.url, '_blank')
  } catch (e: any) {
    alert(e?.response?.data?.error?.message || '下载失败')
  }
}

async function execDelete() {
  confirmAction.value = null
  deleting.value = true
  try {
    await api.delete(`/expenses/${route.params.id}`)
    router.replace('/expenses')
  } catch (e: any) {
    alert(e?.response?.data?.error?.message || '删除失败')
  } finally {
    deleting.value = false
  }
}

async function execReject() {
  if (!rejectComment.value.trim()) return
  confirmAction.value = null
  try {
    await api.post(`/approvals/${route.params.id}/reject`, { comment: rejectComment.value })
    rejectComment.value = ''
    router.replace('/expenses')
  } catch (e: any) {
    alert(e?.response?.data?.error?.message || '驳回失败')
  }
}

async function handleSubmit() {
  try {
    await api.post(`/expenses/${route.params.id}/submit`)
    router.replace('/expenses')
  } catch (e: any) {
    alert(e?.response?.data?.error?.message || '提交失败')
  }
}

async function handleApprove() {
  try {
    await api.post(`/approvals/${route.params.id}/approve`, {})
    router.replace('/expenses')
  } catch (e: any) {
    alert(e?.response?.data?.error?.message || '审批失败')
  }
}

async function handlePay() {
  const ref = prompt('打款凭证号（可选）：')
  try {
    await api.post(`/expenses/${route.params.id}/pay`, { paymentRef: ref || undefined })
    router.replace('/expenses')
  } catch (e: any) {
    alert(e?.response?.data?.error?.message || '打款失败')
  }
}

onMounted(async () => {
  try {
    const expenseRes = await api.get(`/expenses/${route.params.id}`)
    const data = expenseRes.data
    report.value = {
      ...(data.report || data),
      items: data.items || [],
      invoices: data.invoices || [],
      approvalRecords: data.approvalRecords || [],
    }
    viewerActions.value = data.viewerActions || null
    report.value.totalAmount = report.value.totalAmount || report.value.items?.reduce((s: number, i: any) => s + (i.amount || 0), 0) || 0

    try {
      const catRes = await api.get('/categories')
      categories.value = catRes.data || []
    } catch { /* categories optional */ }

    if (report.value && report.value.status !== 'draft') {
      try {
        const records = data.approvalRecords || []
        const ruleName = data.ruleName || ''
        timeline.value = records.map((r: any, i: number, arr: any[]) => ({
          title: `第${r.step}步${r.approverName ? ` — ${r.approverName}` : ''}`,
          desc: r.result === 'approved'
            ? `审批通过${r.comment ? `（${r.comment}）` : ''}`
            : r.result === 'rejected'
              ? `驳回${r.comment ? `：${r.comment}` : ''}`
              : '待审批',
          time: r.approvedAt ? formatDate(r.approvedAt) : (r.stepStartedAt ? formatDate(r.stepStartedAt) : ''),
          rule: i === 0 ? ruleName : '',
          done: r.result === 'approved',
          active: r.result === 'pending',
        }))
      } catch { /* approvals optional */ }
    }
  } catch (e: any) {
    console.error('ExpenseDetail error:', e)
    if (e?.response?.status === 404) {
      report.value = null
    }
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
.header-title { font-size: 1.35rem; color: var(--text-primary); letter-spacing: 0.04em; }
.header-actions { display: flex; gap: 8px; flex-shrink: 0; }

.detail-grid {
  display: grid;
  grid-template-columns: 1fr 320px;
  gap: 20px;
}
.detail-main { display: flex; flex-direction: column; gap: 20px; }
.detail-side { display: flex; flex-direction: column; gap: 20px; }

.card-section-title {
  font-size: 1rem;
  color: var(--text-primary);
  letter-spacing: 0.03em;
  margin-bottom: 16px;
  padding-bottom: 12px;
  border-bottom: 1px solid var(--border-light);
}

.info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
.info-item { display: flex; flex-direction: column; gap: 4px; }
.info-item.full { grid-column: 1 / -1; }
.info-label { font-size: 0.78rem; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.04em; }
.info-value { font-size: 0.92rem; color: var(--text-primary); }

.data-table tfoot tr td { border-top: 1px solid var(--border); padding-top: 14px; }

.attachment-list { display: flex; flex-direction: column; gap: 8px; }
.attachment-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 14px;
  background: var(--bg-warm);
  border-radius: var(--radius-sm);
  color: var(--text-secondary);
  font-size: 0.85rem;
  cursor: default;
  transition: all var(--transition);
  border: 1px solid transparent;
}
.attachment-item:hover { color: var(--accent-coral); background: var(--accent-coral-bg); border-color: var(--accent-coral-bg); }
.attachment-emoji { font-size: 1.1rem; }

.table-link {
  color: var(--accent-coral);
  cursor: pointer;
  text-decoration: underline;
  transition: opacity 0.15s;
  font-size: 0.85rem;
  margin-left: auto;
}
.table-link:hover { opacity: 0.75; }

.no-invoice {
  color: var(--text-muted);
  font-size: 0.82rem;
}

.loading-state {
  color: var(--text-muted);
  text-align: center;
  padding: 60px 0;
  font-size: 0.9rem;
}

.btn-danger-outline {
  background: transparent;
  border: 1px solid var(--danger, #e53e3e);
  color: var(--danger, #e53e3e);
  padding: 6px 16px;
  border-radius: var(--radius-sm);
  font-size: 0.85rem;
  cursor: pointer;
  transition: all var(--transition);
}
.btn-danger-outline:hover { background: var(--danger, #e53e3e); color: #fff; }
.btn-danger-outline:disabled { opacity: 0.5; cursor: not-allowed; }

.confirm-overlay { position: fixed; inset: 0; background: rgba(45,36,32,0.4); backdrop-filter: blur(4px); display: flex; align-items: center; justify-content: center; z-index: 200; }
.confirm-dialog { background: var(--bg-card); border-radius: var(--radius-lg); padding: 24px; width: 400px; max-width: 90vw; }
.confirm-dialog h3 { margin-bottom: 12px; font-size: 1.1rem; }
.confirm-dialog textarea { width: 100%; padding: 10px; border: 1px solid var(--border); border-radius: var(--radius-sm); resize: vertical; font-size: 0.9rem; }
.confirm-actions { display: flex; gap: 8px; justify-content: flex-end; margin-top: 12px; }

@media (max-width: 900px) {
  .detail-grid { grid-template-columns: 1fr; }
}
</style>
