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
          <span class="serial-no">{{ expense.serialNo }}</span>
          <span class="badge" :class="`badge-${expense.status}`">{{ statusLabels[expense.status] }}</span>
        </div>
        <h1 class="header-title font-heading">{{ expense.title }}</h1>
      </div>
      <div class="header-spacer"></div>
      <div class="header-actions">
        <button v-if="expense.status === 'draft'" class="btn-secondary btn-sm" @click="$router.push(`/expenses/new`)">编辑</button>
        <button v-if="expense.status === 'draft'" class="btn-primary btn-sm">提交审批</button>
        <template v-if="expense.status === 'pending'">
          <button class="btn-primary btn-sm" style="background: linear-gradient(135deg, var(--accent-mint), #69db7c);">审批通过</button>
          <button class="btn-danger btn-sm">驳回</button>
        </template>
      </div>
    </div>

    <div class="detail-grid">
      <div class="detail-main">
        <div class="card">
          <h3 class="card-section-title font-heading">基本信息</h3>
          <div class="info-grid">
            <div class="info-item">
              <span class="info-label">提交人</span>
              <span class="info-value">{{ expense.submittedBy }}</span>
            </div>
            <div class="info-item">
              <span class="info-label">类别</span>
              <span class="info-value">{{ expense.category }}</span>
            </div>
            <div class="info-item">
              <span class="info-label">提交时间</span>
              <span class="info-value">{{ expense.createdAt }}</span>
            </div>
            <div class="info-item">
              <span class="info-label">更新时间</span>
              <span class="info-value">{{ expense.updatedAt }}</span>
            </div>
            <div class="info-item full">
              <span class="info-label">说明</span>
              <span class="info-value">{{ expense.description || '无' }}</span>
            </div>
          </div>
        </div>

        <div class="card">
          <h3 class="card-section-title font-heading">费用明细</h3>
          <table class="data-table">
            <thead>
              <tr>
                <th>项目</th>
                <th class="text-right">数量</th>
                <th>单位</th>
                <th class="text-right">金额</th>
                <th>发票</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="item in expense.items" :key="item.id">
                <td>{{ item.name }}</td>
                <td class="text-right">{{ item.quantity }}</td>
                <td class="text-secondary">{{ item.unit }}</td>
                <td class="text-right">&yen;{{ item.amount.toLocaleString() }}</td>
                <td>
                  <template v-if="item.invoice">
                    &#x1f4ce; {{ item.invoice.fileName }}
                    <span class="table-link" @click="downloadInvoice(item, item.invoice)">下载</span>
                  </template>
                  <span v-else class="no-invoice">未上传</span>
                </td>
              </tr>
            </tbody>
            <tfoot>
              <tr>
                <td colspan="4" class="text-right" style="font-weight:600;">合计</td>
                <td class="text-right" style="font-weight:700;color:var(--accent-coral);font-size:1.1rem;">&yen;{{ expense.amount.toLocaleString() }}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      <div class="detail-side">
        <div class="card">
          <h3 class="card-section-title font-heading">审批流程</h3>
          <div class="timeline">
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
          <h3 class="card-section-title font-heading">附件</h3>
          <div class="attachment-list">
            <div v-for="att in expense.attachments" :key="att" class="attachment-item">
              <span class="attachment-emoji">&#128206;</span>
              <span>{{ att }}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useRoute } from 'vue-router'
import api from '../api/index'

const route = useRoute()

const statusLabels: Record<string, string> = {
  draft: '草稿', pending: '待审批', approved: '已通过', rejected: '已驳回', paid: '已付款'
}

const expense = {
  id: '1', serialNo: 'SSE-20240701-001', title: '差旅费报销-北京出差', amount: 3850,
  status: 'approved', category: '差旅费',
  description: '赴北京参加行业技术峰会，包含往返机票、住宿及市内交通费用。',
  submittedBy: '张三', createdAt: '2024-07-01 14:30', updatedAt: '2024-07-02 09:15',
  items: [
    { id: '1', name: '往返机票', amount: 2200, quantity: 1, unit: '张', invoice: { id: 'inv-001', fileName: '机票行程单.pdf' } },
    { id: '2', name: '酒店住宿', amount: 1200, quantity: 2, unit: '晚', invoice: { id: 'inv-002', fileName: '酒店发票.pdf' } },
    { id: '3', name: '市内交通', amount: 180, quantity: 1, unit: '次' },
    { id: '4', name: '餐饮补助', amount: 270, quantity: 3, unit: '天' },
  ],
  attachments: ['机票行程单.pdf', '酒店发票.pdf', '会议邀请函.pdf'],
}

async function downloadInvoice(item: any, invoice: any) {
  try {
    const res = await api.get(`/expenses/${route.params.id}/items/${item.id}/invoice/${invoice.id}/download`)
    window.open(res.data.url, '_blank')
  } catch (e: any) {
    alert(e?.response?.data?.error?.message || '下载失败')
  }
}

const timeline = [
  { title: '提交申请', desc: '张三提交报销申请', time: '07-01 14:30', done: true, active: false },
  { title: '部门审批', desc: '李四审批通过', time: '07-01 16:20', done: true, active: false },
  { title: '财务复核', desc: '王五复核通过', time: '07-02 09:15', done: true, active: true },
  { title: '出纳付款', desc: '等待付款', time: '', done: false, active: false },
]
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
  cursor: pointer;
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
  margin-left: 4px;
}
.table-link:hover { opacity: 0.75; }

.no-invoice {
  color: var(--text-muted);
  font-size: 0.82rem;
}

@media (max-width: 900px) {
  .detail-grid { grid-template-columns: 1fr; }
}
</style>
