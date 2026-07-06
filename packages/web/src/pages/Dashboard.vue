<template>
  <div class="dashboard">
    <div class="welcome-section">
      <h1 class="welcome-title">
        <span class="welcome-greeting">你好，</span>
        <span class="welcome-name">{{ auth.user?.name }}</span>
      </h1>
      <p class="welcome-date">{{ today }}</p>
    </div>

    <div class="stats-grid">
      <div class="stat-card" v-for="s in stats" :key="s.label">
        <div class="stat-icon" :style="{ background: s.bg, color: s.color }" v-html="s.icon"></div>
        <div class="stat-info">
          <div class="stat-value font-mono">{{ s.value }}</div>
          <div class="stat-label">{{ s.label }}</div>
        </div>
      </div>
    </div>

    <div class="quick-actions">
      <button class="action-card" @click="$router.push('/expenses/new')">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
        </svg>
        <span>新建报销</span>
      </button>
      <button class="action-card" @click="$router.push('/approvals')">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>
        </svg>
        <span>待审批</span>
        <span class="action-badge">3</span>
      </button>
    </div>

    <div class="section">
      <div class="section-header">
        <h3 class="section-title">最近报销</h3>
        <router-link to="/expenses" class="section-link">查看全部 &rarr;</router-link>
      </div>

      <div class="recent-table-wrap">
        <table class="recent-table">
          <thead>
            <tr>
              <th>编号</th>
              <th>标题</th>
              <th class="text-right">金额</th>
              <th>状态</th>
              <th class="text-right">日期</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="item in recentExpenses" :key="item.id" @click="$router.push(`/expenses/${item.id}`)" class="clickable-row">
              <td class="font-mono">{{ item.serialNo }}</td>
              <td>{{ item.title }}</td>
              <td class="text-right font-mono">&yen;{{ item.amount.toLocaleString() }}</td>
              <td><span class="badge" :class="`badge-${item.status}`">{{ statusLabels[item.status] }}</span></td>
              <td class="text-right text-muted">{{ item.date }}</td>
            </tr>
            <tr v-if="recentExpenses.length === 0">
              <td colspan="5" class="empty-cell">暂无报销记录</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useAuthStore } from '@/stores/auth'

const auth = useAuthStore()

const today = computed(() => {
  const d = new Date()
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 ${['日','一','二','三','四','五','六'][d.getDay()]}`
})

const statusLabels: Record<string, string> = { draft: '草稿', pending: '待审批', approved: '已通过', rejected: '已驳回', paid: '已付款' }

const stats = [
  {
    label: '待审批',
    value: '3',
    bg: 'rgba(59, 130, 246, 0.12)',
    color: 'var(--accent-blue)',
    icon: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>'
  },
  {
    label: '本月报销',
    value: '12',
    bg: 'rgba(240, 185, 11, 0.12)',
    color: 'var(--accent-amber)',
    icon: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>'
  },
  {
    label: '已通过',
    value: '8',
    bg: 'rgba(0, 192, 135, 0.12)',
    color: 'var(--accent-green)',
    icon: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>'
  },
  {
    label: '已付款',
    value: '¥24.5k',
    bg: 'rgba(139, 92, 246, 0.12)',
    color: 'var(--accent-purple)',
    icon: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/></svg>'
  }
]

const recentExpenses = [
  { id: '1', serialNo: 'SSE-20240701-001', title: '差旅费报销-北京出差', amount: 3850, status: 'approved', date: '07-01' },
  { id: '2', serialNo: 'SSE-20240703-002', title: '办公用品采购', amount: 1260, status: 'paid', date: '07-03' },
  { id: '3', serialNo: 'SSE-20240704-003', title: '招待费-客户用餐', amount: 890, status: 'pending', date: '07-04' },
  { id: '4', serialNo: 'SSE-20240703-004', title: '交通费报销', amount: 345, status: 'approved', date: '07-03' },
  { id: '5', serialNo: 'SSE-20240702-005', title: '培训费-技术峰会门票', amount: 2800, status: 'rejected', date: '07-02' },
]
</script>

<style scoped>
.dashboard {
  max-width: 960px;
}

.welcome-section {
  margin-bottom: 28px;
}
.welcome-greeting {
  font-size: 1rem;
  color: var(--text-muted);
}
.welcome-name {
  font-family: var(--font-heading);
  font-size: 1.5rem;
  color: var(--accent-amber);
}
.welcome-date {
  font-size: 0.85rem;
  color: var(--text-muted);
  margin-top: 4px;
}

.stats-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 16px;
  margin-bottom: 24px;
}
.stat-card {
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 20px;
  display: flex;
  align-items: center;
  gap: 16px;
  transition: all var(--transition);
}
.stat-card:hover {
  border-color: var(--border-light);
  transform: translateY(-1px);
  box-shadow: var(--shadow);
}
.stat-icon {
  width: 44px;
  height: 44px;
  border-radius: var(--radius);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
.stat-value {
  font-size: 1.4rem;
  font-weight: 500;
  color: var(--text-primary);
}
.stat-label {
  font-size: 0.8rem;
  color: var(--text-muted);
  margin-top: 2px;
}

.quick-actions {
  display: flex;
  gap: 12px;
  margin-bottom: 32px;
}
.action-card {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 16px 20px;
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  color: var(--text-primary);
  font-size: 0.95rem;
  font-weight: 500;
  transition: all var(--transition);
}
.action-card:hover {
  border-color: var(--accent-amber);
  background: var(--bg-card-hover);
}
.action-badge {
  margin-left: auto;
  background: var(--accent-amber);
  color: #0f1117;
  font-size: 0.7rem;
  font-weight: 700;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
}

.section { margin-top: 8px; }
.section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 16px;
}
.section-title {
  font-family: var(--font-heading);
  font-size: 1.1rem;
  font-weight: 400;
  color: var(--text-primary);
  letter-spacing: 0.02em;
}
.section-link {
  font-size: 0.85rem;
  color: var(--accent-amber);
  transition: color var(--transition);
}
.section-link:hover { color: var(--accent-amber-dark); }

.recent-table-wrap {
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  overflow: hidden;
}
.recent-table {
  width: 100%;
  border-collapse: collapse;
}
.recent-table th {
  padding: 12px 16px;
  font-size: 0.75rem;
  font-weight: 500;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  text-align: left;
  border-bottom: 1px solid var(--border);
}
.recent-table td {
  padding: 12px 16px;
  font-size: 0.9rem;
  border-bottom: 1px solid var(--border);
}
.recent-table tr:last-child td { border-bottom: none; }
.text-right { text-align: right; }
.clickable-row { cursor: pointer; transition: background var(--transition); }
.clickable-row:hover { background: rgba(255, 255, 255, 0.03); }
.empty-cell { text-align: center; color: var(--text-muted); padding: 40px 16px !important; }
</style>
