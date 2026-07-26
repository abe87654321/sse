<template>
  <div class="dashboard">
    <div class="welcome-section">
      <div class="welcome-badge">早上好</div>
      <h1 class="welcome-name">{{ auth.user?.name }}</h1>
      <p class="welcome-date">{{ today }}</p>
    </div>

    <div class="stats-grid">
      <div class="stat-card" v-for="s in stats" :key="s.label" :style="{ borderLeftColor: s.color }">
        <div class="stat-icon-wrap" :style="{ background: s.bg }">
          <span v-html="s.emoji" style="font-size:1.5rem;"></span>
        </div>
        <div class="stat-info">
          <div class="stat-value">{{ s.value }}</div>
          <div class="stat-label">{{ s.label }}</div>
        </div>
      </div>
    </div>

    <div class="quick-actions">
      <button class="action-card" @click="$router.push('/expenses/new')">
        <span class="action-emoji">+</span>
        <div class="action-info">
          <span class="action-label">新建报销</span>
          <span class="action-desc">快速提交费用申请</span>
        </div>
      </button>
      <button class="action-card" @click="$router.push('/approvals')" v-if="showApprovals">
        <span class="action-emoji">&#10003;</span>
        <div class="action-info">
          <span class="action-label">待审批</span>
          <span class="action-desc">{{ pendingCount }} 条待处理</span>
        </div>
        <span class="action-count" v-if="pendingCount > 0">{{ pendingCount }}</span>
      </button>
      <button class="action-card" @click="$router.push('/expenses')">
        <span class="action-emoji">&#128196;</span>
        <div class="action-info">
          <span class="action-label">全部报销</span>
          <span class="action-desc">查看所有记录</span>
        </div>
      </button>
    </div>

    <div class="card section-card">
      <div class="section-header">
        <h3 class="section-title font-heading">最近报销</h3>
        <router-link to="/expenses" class="section-link">查看全部 &rarr;</router-link>
      </div>

      <table class="data-table">
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
          <tr v-for="item in recentExpenses" :key="item.id" @click="$router.push(`/expenses/${item.id}`)">
            <td class="text-muted" style="font-size:0.8rem;">{{ item.serialNo }}</td>
            <td>{{ item.title }}</td>
            <td class="text-right">&yen;{{ (item.totalAmount || item.amount || 0).toLocaleString() }}</td>
            <td><span class="badge" :class="`badge-${item.status}`">{{ statusLabels[item.status] || item.status }}</span></td>
            <td class="text-right text-muted" style="font-size:0.82rem;">{{ formatDate(item.createdAt) }}</td>
          </tr>
          <tr v-if="recentExpenses.length === 0">
            <td colspan="5">
              <div class="empty-state">
                <div class="empty-state-icon">&#128203;</div>
                <div class="empty-state-text">暂无报销记录</div>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useAuthStore } from '@/stores/auth'
import api from '../api/index'

const auth = useAuthStore()

const today = computed(() => {
  const d = new Date()
  const weekDays = ['日', '一', '二', '三', '四', '五', '六']
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 星期${weekDays[d.getDay()]}`
})

const statusLabels: Record<string, string> = {
  draft: '草稿', pending: '待审批', approved: '已通过', rejected: '已驳回', paid: '已付款'
}

const showApprovals = computed(() => {
  const role = auth.user?.role
  return role === 'dept_approver' || role === 'finance' || role === 'admin'
})

const pendingCount = ref(0)
const recentExpenses = ref<any[]>([])
const stats = ref([
  { label: '待审批', value: '0', emoji: '&#9200;', color: 'var(--accent-sky)', bg: 'var(--accent-sky-bg)' },
  { label: '本月报销', value: '0', emoji: '&#128176;', color: 'var(--accent-orange)', bg: 'var(--accent-orange-bg)' },
  { label: '已通过', value: '0', emoji: '&#9989;', color: 'var(--accent-mint)', bg: 'var(--accent-mint-bg)' },
  { label: '已付款', value: '¥0', emoji: '&#128179;', color: 'var(--accent-violet)', bg: 'var(--accent-violet-bg)' },
])

function formatDate(dateStr: string) {
  if (!dateStr) return '-'
  return dateStr.slice(0, 10).replace(/^\d{4}-/, '').replace('-', '-')
}

onMounted(async () => {
  try {
    const res = await api.get('/expenses')
    const items: any[] = res.data.results || []

    recentExpenses.value = items.slice(0, 5)

    const thisMonth = new Date().toISOString().slice(0, 7)
    const pending = items.filter((e: any) => e.status === 'pending').length
    const approved = items.filter((e: any) => e.status === 'approved').length
    const thisMonthCount = items.filter((e: any) => (e.createdAt || '').startsWith(thisMonth)).length
    const paidTotal = items
      .filter((e: any) => e.status === 'paid')
      .reduce((sum: number, e: any) => sum + (e.totalAmount || 0), 0)

    stats.value = [
      { label: '待审批', value: String(pending), emoji: '&#9200;', color: 'var(--accent-sky)', bg: 'var(--accent-sky-bg)' },
      { label: '本月报销', value: String(thisMonthCount), emoji: '&#128176;', color: 'var(--accent-orange)', bg: 'var(--accent-orange-bg)' },
      { label: '已通过', value: String(approved), emoji: '&#9989;', color: 'var(--accent-mint)', bg: 'var(--accent-mint-bg)' },
      { label: '已付款', value: '&#165;' + formatAmount(paidTotal), emoji: '&#128179;', color: 'var(--accent-violet)', bg: 'var(--accent-violet-bg)' },
    ]
  } catch {}

  if (showApprovals.value) {
    try {
      const res = await api.get('/approvals/pending')
      pendingCount.value = (res.data || []).length
    } catch {}
  }
})

function formatAmount(n: number): string {
  if (n >= 10000) return (n / 10000).toFixed(1) + 'w'
  if (n >= 1000) return (n / 1000).toFixed(1) + 'k'
  return String(n)
}
</script>

<style scoped>
.dashboard { max-width: 960px; }

.welcome-section { margin-bottom: 28px; }
.welcome-badge {
  display: inline-block;
  padding: 4px 14px;
  background: var(--accent-orange-bg);
  color: var(--accent-orange);
  font-size: 0.8rem;
  font-weight: 500;
  border-radius: var(--radius-full);
  margin-bottom: 12px;
}
.welcome-name {
  font-family: var(--font-heading);
  font-size: 1.7rem;
  color: var(--text-primary);
  letter-spacing: 0.04em;
  margin-bottom: 4px;
}
.welcome-date { font-size: 0.88rem; color: var(--text-muted); }

.stats-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 16px;
  margin-bottom: 24px;
}
.stat-card {
  background: var(--bg-card);
  border: 1px solid var(--border-light);
  border-left: 3px solid var(--border);
  border-radius: var(--radius);
  padding: 18px 20px;
  display: flex;
  align-items: center;
  gap: 14px;
  box-shadow: var(--shadow-sm);
  transition: all var(--transition);
}
.stat-card:hover { transform: translateY(-2px); box-shadow: var(--shadow); }
.stat-icon-wrap {
  width: 44px;
  height: 44px;
  border-radius: var(--radius-sm);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
.stat-value { font-size: 1.35rem; font-weight: 600; color: var(--text-primary); }
.stat-label { font-size: 0.8rem; color: var(--text-muted); margin-top: 2px; }

.quick-actions {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 14px;
  margin-bottom: 28px;
}
.action-card {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 18px 20px;
  background: var(--bg-card);
  border: 1px solid var(--border-light);
  border-radius: var(--radius);
  box-shadow: var(--shadow-sm);
  transition: all var(--transition);
  text-align: left;
}
.action-card:hover {
  border-color: var(--accent-coral);
  transform: translateY(-2px);
  box-shadow: var(--shadow);
}
.action-emoji {
  width: 40px;
  height: 40px;
  border-radius: var(--radius-sm);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 1.2rem;
  font-weight: 700;
  background: var(--accent-coral-bg);
  color: var(--accent-coral);
  flex-shrink: 0;
}
.action-info { flex: 1; }
.action-label { display: block; font-size: 0.9rem; font-weight: 600; color: var(--text-primary); }
.action-desc { display: block; font-size: 0.78rem; color: var(--text-muted); margin-top: 2px; }
.action-count {
  background: var(--accent-coral);
  color: #fff;
  font-size: 0.75rem;
  font-weight: 700;
  min-width: 24px;
  height: 24px;
  border-radius: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0 8px;
}

.section-card { padding: 0; overflow: hidden; }
.section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 20px 24px 16px;
  border-bottom: 1px solid var(--border-light);
}
.section-title { font-size: 1.1rem; color: var(--text-primary); letter-spacing: 0.03em; }
.section-link { font-size: 0.85rem; font-weight: 500; }
.section-card .data-table th { background: transparent; padding-left: 24px; padding-right: 24px; }
.section-card .data-table td { padding-left: 24px; padding-right: 24px; }
.section-card .data-table thead { background: var(--bg-warm); }

@media (max-width: 768px) {
  .stats-grid { grid-template-columns: repeat(2, 1fr); }
  .quick-actions { grid-template-columns: 1fr; }
}
</style>
