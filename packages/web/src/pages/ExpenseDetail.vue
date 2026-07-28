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
        <template v-if="report?.status === 'draft' || report?.status === 'rejected'">
          <button class="btn-secondary btn-sm" @click="$router.push(`/expenses/${report.id}/edit`)">编辑</button>
          <button v-if="report?.status !== 'rejected'" class="btn-danger-outline btn-sm" @click="handleDelete" :disabled="deleting">{{ deleting ? '删除中...' : '删除' }}</button>
          <button class="btn-primary btn-sm" @click="handleSubmit">提交审批</button>
        </template>
        <template v-if="report?.status === 'pending'">
          <button class="btn-primary btn-sm" style="background: linear-gradient(135deg, var(--accent-mint), #69db7c);" @click="handleApprove">审批通过</button>
          <button class="btn-danger btn-sm" @click="handleReject">驳回</button>
        </template>
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
          <div class="card">
            <h3 class="card-section-title font-heading">审批流程</h3>
            <div v-if="timeline.length === 0" class="no-data">暂无审批记录</div>
            <div v-else class="timeline">
              <div v-for="(step, i) in timeline" :key="i" class="timeline-step" :class="{ last: i === timeline.length - 1 }">
                <div class="timeline-dot" :class="{ done: step.done, current: step.active }"></div>
                <div class="timeline-content">
                  <div class="timeline-title">{{ step.title }}</div>
                  <div class="timeline-desc">{{ step.desc }}</div>
                  <div class="timeline-time" v-if="step.time">{{ step.time }}</div>
                </div>
              </div>
            </div>
          </div>

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
  items: ExpenseItem[]
  invoices?: InvoiceItem[]
}

const loading = ref(true)
const report = ref<Report | null>(null)
const categories = ref<Category[]>([])
const timeline = ref<Array<{ title: string; desc: string; time: string; done: boolean; active: boolean }>>([])
const deleting = ref(false)

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

async function handleDelete() {
  if (!confirm('确认删除该报销记录？此操作不可撤销。')) return
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
    report.value.totalAmount = report.value.totalAmount || report.value.items?.reduce((s: number, i: any) => s + (i.amount || 0), 0) || 0

    try {
      const catRes = await api.get('/categories')
      categories.value = catRes.data || []
    } catch { /* categories optional */ }

    if (report.value && report.value.status !== 'draft') {
      try {
        const records = data.approvalRecords || []
        timeline.value = records.map((r: any, i: number, arr: any[]) => ({
          title: r.step || `审批步骤${i + 1}`,
          desc: r.result === 'approved' ? '审批通过' : r.result === 'rejected' ? '已驳回' : '待审批',
          time: r.stepStartedAt ? formatDate(r.stepStartedAt) : '',
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

/* Timeline */
.timeline { position: relative; }
.timeline-step {
  position: relative;
  padding-left: 28px;
  padding-bottom: 20px;
}
.timeline-step.last { padding-bottom: 0; }
.timeline-step::before {
  content: '';
  position: absolute;
  left: 8px;
  top: 14px;
  bottom: 0;
  width: 2px;
  background: var(--border);
  border-radius: 1px;
}
.timeline-step.last::before { display: none; }

.timeline-dot {
  position: absolute;
  left: 0;
  top: 6px;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  border: 2px solid var(--border);
  background: var(--bg-card);
  z-index: 1;
  transition: all var(--transition);
}
.timeline-dot.done { border-color: var(--accent-mint); background: var(--accent-mint); }
.timeline-dot.current {
  border-color: var(--accent-coral);
  background: var(--bg-card);
  box-shadow: 0 0 0 4px rgba(255, 107, 107, 0.12);
}

.timeline-title { font-size: 0.9rem; font-weight: 600; color: var(--text-primary); }
.timeline-desc { font-size: 0.8rem; color: var(--text-muted); margin-top: 2px; }
.timeline-time { font-size: 0.75rem; color: var(--text-muted); margin-top: 2px; }

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

.no-data {
  color: var(--text-muted);
  font-size: 0.85rem;
  text-align: center;
  padding: 20px 0;
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

@media (max-width: 900px) {
  .detail-grid { grid-template-columns: 1fr; }
}
</style>
