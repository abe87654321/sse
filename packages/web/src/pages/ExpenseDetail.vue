<template>
  <div class="expense-detail">
    <div class="detail-header">
      <div class="header-left">
        <button class="back-btn" @click="$router.back()">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 18 9 12 15 6"/></svg>
        </button>
        <div>
          <div class="header-title-row">
            <span class="font-mono serial-no">{{ expense.serialNo }}</span>
            <span class="badge" :class="`badge-${expense.status}`">{{ statusLabels[expense.status] }}</span>
          </div>
          <h2 class="header-title">{{ expense.title }}</h2>
        </div>
      </div>
      <div class="header-actions">
        <button v-if="expense.status === 'draft'" class="btn-action btn-submit">提交审批</button>
        <button v-if="expense.status === 'pending'" class="btn-action btn-approve">审批通过</button>
        <button v-if="expense.status === 'pending'" class="btn-action btn-reject">驳回</button>
        <button v-if="expense.status === 'draft'" class="btn-action btn-edit">编辑</button>
      </div>
    </div>

    <div class="detail-grid">
      <div class="detail-main">
        <div class="card">
          <h3 class="card-title">基本信息</h3>
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
            <div class="info-item full-width">
              <span class="info-label">说明</span>
              <span class="info-value">{{ expense.description || '无' }}</span>
            </div>
          </div>
        </div>

        <div class="card">
          <h3 class="card-title">费用明细</h3>
          <table class="items-table">
            <thead>
              <tr>
                <th>项目</th>
                <th class="text-right">数量</th>
                <th>单位</th>
                <th class="text-right">金额</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="item in expense.items" :key="item.id">
                <td>{{ item.name }}</td>
                <td class="text-right font-mono">{{ item.quantity }}</td>
                <td class="text-muted">{{ item.unit }}</td>
                <td class="text-right font-mono">&yen;{{ item.amount.toLocaleString() }}</td>
              </tr>
            </tbody>
            <tfoot>
              <tr>
                <td colspan="3" class="text-right" style="font-weight: 600;">合计</td>
                <td class="text-right font-mono" style="font-weight: 700; color: var(--accent-amber);">&yen;{{ expense.amount.toLocaleString() }}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      <div class="detail-side">
        <div class="card">
          <h3 class="card-title">审批流程</h3>
          <div class="timeline">
            <div v-for="(step, i) in timeline" :key="i" class="timeline-step" :class="{ active: step.active, last: i === timeline.length - 1 }">
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
          <h3 class="card-title">附件</h3>
          <div class="attachment-list">
            <div v-for="att in expense.attachments" :key="att" class="attachment-item">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
              <span>{{ att }}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
const statusLabels: Record<string, string> = { draft: '草稿', pending: '待审批', approved: '已通过', rejected: '已驳回', paid: '已付款' }

const expense = {
  id: '1',
  serialNo: 'SSE-20240701-001',
  title: '差旅费报销-北京出差',
  amount: 3850,
  status: 'approved',
  category: '差旅费',
  description: '赴北京参加行业技术峰会，包含往返机票、住宿及市内交通费用。',
  submittedBy: '张三',
  createdAt: '2024-07-01 14:30',
  updatedAt: '2024-07-02 09:15',
  items: [
    { id: '1', name: '往返机票', amount: 2200, quantity: 1, unit: '张' },
    { id: '2', name: '酒店住宿', amount: 1200, quantity: 2, unit: '晚' },
    { id: '3', name: '市内交通', amount: 180, quantity: 1, unit: '次' },
    { id: '4', name: '餐饮补助', amount: 270, quantity: 3, unit: '天' },
  ],
  attachments: ['机票行程单.pdf', '酒店发票.pdf', '会议邀请函.pdf'],
}

const timeline = [
  { title: '提交申请', desc: '张三提交报销申请', time: '07-01 14:30', done: true, active: false },
  { title: '部门审批', desc: '李四审批通过', time: '07-01 16:20', done: true, active: false },
  { title: '财务复核', desc: '王五复核通过', time: '07-02 09:15', done: true, active: true },
  { title: '出纳付款', desc: '等待付款', time: '', done: false, active: false },
]
</script>

<style scoped>
.detail-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  margin-bottom: 24px;
  padding-bottom: 20px;
  border-bottom: 1px solid var(--border);
  flex-wrap: wrap;
  gap: 16px;
}
.header-left { display: flex; align-items: flex-start; gap: 12px; }
.back-btn {
  width: 36px;
  height: 36px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  color: var(--text-muted);
  border-radius: var(--radius);
  transition: all var(--transition);
  margin-top: 2px;
}
.back-btn:hover { background: rgba(255, 255, 255, 0.05); color: var(--text-primary); }
.header-title-row {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 4px;
}
.serial-no { font-size: 0.8rem; color: var(--text-muted); }
.header-title { font-family: var(--font-heading); font-size: 1.25rem; font-weight: 400; }
.header-actions { display: flex; gap: 8px; }
.btn-action {
  padding: 8px 18px;
  border-radius: var(--radius);
  font-size: 0.85rem;
  font-weight: 500;
  transition: all var(--transition);
}
.btn-submit { background: var(--accent-amber); color: #0f1117; }
.btn-submit:hover { background: var(--accent-amber-dark); }
.btn-approve { background: var(--accent-green); color: #fff; }
.btn-approve:hover { filter: brightness(1.1); }
.btn-reject { background: transparent; border: 1px solid var(--accent-red); color: var(--accent-red); }
.btn-reject:hover { background: rgba(239, 68, 68, 0.1); }
.btn-edit { background: transparent; border: 1px solid var(--border-light); color: var(--text-secondary); }
.btn-edit:hover { border-color: var(--text-muted); color: var(--text-primary); }

.detail-grid {
  display: grid;
  grid-template-columns: 1fr 320px;
  gap: 20px;
}
.detail-main { display: flex; flex-direction: column; gap: 20px; }
.detail-side { display: flex; flex-direction: column; gap: 20px; }

.card {
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 20px 24px;
}
.card-title {
  font-family: var(--font-heading);
  font-size: 1rem;
  font-weight: 400;
  color: var(--text-primary);
  margin-bottom: 16px;
  padding-bottom: 12px;
  border-bottom: 1px solid var(--border);
}

.info-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
}
.info-item { display: flex; flex-direction: column; gap: 4px; }
.info-item.full-width { grid-column: 1 / -1; }
.info-label { font-size: 0.75rem; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.05em; }
.info-value { font-size: 0.9rem; color: var(--text-primary); }

.items-table { width: 100%; border-collapse: collapse; }
.items-table th {
  padding: 10px 12px;
  font-size: 0.75rem;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  text-align: left;
  border-bottom: 1px solid var(--border);
}
.items-table td, .items-table tfoot td {
  padding: 10px 12px;
  font-size: 0.9rem;
  border-bottom: 1px solid var(--border);
}
.items-table tbody tr:last-child td { border-bottom: none; }
.items-table tfoot tr td { border-bottom: none; border-top: 1px solid var(--border); padding-top: 14px; }
.text-right { text-align: right; }

.timeline { position: relative; padding-left: 8px; }
.timeline-step {
  position: relative;
  padding-left: 24px;
  padding-bottom: 20px;
}
.timeline-step.last { padding-bottom: 0; }
.timeline-step::before {
  content: '';
  position: absolute;
  left: 7px;
  top: 12px;
  bottom: 0;
  width: 2px;
  background: var(--border);
}
.timeline-step.last::before { display: none; }
.timeline-step.active::before { background: var(--accent-amber); }

.timeline-dot {
  position: absolute;
  left: 0;
  top: 6px;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  border: 2px solid var(--border);
  background: var(--bg-card);
  z-index: 1;
  transition: all var(--transition);
}
.timeline-dot.done { border-color: var(--accent-green); background: var(--accent-green); }
.timeline-dot.current { border-color: var(--accent-amber); box-shadow: 0 0 0 3px rgba(240, 185, 11, 0.15); }

.timeline-title { font-size: 0.9rem; font-weight: 500; color: var(--text-primary); }
.timeline-desc { font-size: 0.8rem; color: var(--text-muted); margin-top: 2px; }
.timeline-time { font-size: 0.75rem; color: var(--text-muted); margin-top: 2px; font-family: var(--font-mono); }

.attachment-list { display: flex; flex-direction: column; gap: 8px; }
.attachment-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  background: var(--bg-input);
  border-radius: var(--radius);
  color: var(--text-secondary);
  font-size: 0.85rem;
  cursor: pointer;
  transition: all var(--transition);
}
.attachment-item:hover { color: var(--accent-amber); background: rgba(240, 185, 11, 0.08); }
</style>
