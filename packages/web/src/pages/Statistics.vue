<template>
  <div class="statistics-page">
    <div class="page-header">
      <h2 class="page-header-title">统计分析</h2>
    </div>

    <div class="stats-grid">
      <div class="card stat-summary" v-for="s in summaries" :key="s.label">
        <div class="stat-summary-value" :style="{ color: s.color }">{{ s.value }}</div>
        <div class="stat-summary-label">{{ s.label }}</div>
        <div class="stat-summary-sub" :style="{ color: s.color }">{{ s.sub }}</div>
      </div>
    </div>

    <div class="card" style="margin-top: 20px;">
      <h3 class="form-section-title font-heading" style="margin-bottom: 20px; padding-bottom: 14px; border-bottom: 1px solid var(--border-light);">月度趋势</h3>
      <div v-if="months.length === 0" class="empty-state">
        <div class="empty-state-text">暂无数据</div>
      </div>
      <div v-else class="bar-chart">
        <div class="bar-item" v-for="m in months" :key="m.label">
          <div class="bar-value text-muted" style="margin-bottom:4px;">&#165;{{ formatK(m.amount) }}</div>
          <div class="bar-track">
            <div
              class="bar-fill"
              :style="{ height: (m.amount / maxAmount * 100) + '%', background: m.color }"
            ></div>
          </div>
          <div class="bar-label text-muted" style="margin-top:6px;">{{ m.label }}</div>
        </div>
      </div>
    </div>

    <div class="card" style="margin-top: 20px;">
      <h3 class="form-section-title font-heading" style="margin-bottom: 20px; padding-bottom: 14px; border-bottom: 1px solid var(--border-light);">类别分布</h3>
      <div v-if="categories.length === 0" class="empty-state">
        <div class="empty-state-text">暂无数据</div>
      </div>
      <div v-else class="category-list">
        <div class="category-item" v-for="c in categories" :key="c.name">
          <div class="category-header">
            <span class="category-name">{{ c.name }}</span>
            <span class="category-amount">&#165;{{ c.amount.toLocaleString() }}</span>
          </div>
          <div class="category-bar">
            <div class="category-fill" :style="{ width: (c.amount / maxCatAmount * 100) + '%', background: c.color }"></div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import api from '../api/index'

const barColors = [
  'var(--accent-coral)',
  'var(--accent-orange)',
  'var(--accent-sky)',
  'var(--accent-violet)',
  'var(--accent-mint)',
  'var(--text-muted)',
]

const summaries = ref([
  { label: '本月总支出', value: '¥0', sub: '', color: 'var(--accent-coral)' },
  { label: '报销次数', value: '0', sub: '', color: 'var(--accent-sky)' },
  { label: '审批通过率', value: '-', sub: '', color: 'var(--accent-mint)' },
  { label: '待审批', value: '0', sub: '', color: 'var(--accent-orange)' },
])

const months = ref<any[]>([])
const categories = ref<any[]>([])
const maxAmount = ref(1)
const maxCatAmount = ref(1)

function formatK(n: number): string {
  if (n >= 10000) return (n / 10000).toFixed(1) + 'w'
  if (n >= 1000) return (n / 1000).toFixed(1) + 'k'
  return String(n)
}

function formatMonth(ym: string): string {
  const parts = ym.split('-')
  return String(parseInt(parts[1], 10)) + '月'
}

onMounted(async () => {
  try {
    const res = await api.get('/statistics')
    const data = res.data

    const { overview, byCategory, monthly } = data
    const approvedCount = overview.approvedCount || 0
    const rejectedCount = overview.rejectedCount || 0
    const totalCount = overview.totalCount || 0
    const done = approvedCount + rejectedCount
    const passRate = done > 0 ? Math.round(approvedCount / done * 100) : 0

    summaries.value = [
      { label: '总支出', value: '¥' + formatK(overview.totalAmount || 0), sub: `${totalCount} 笔报销`, color: 'var(--accent-coral)' },
      { label: '已通过', value: String(approvedCount), sub: '笔', color: 'var(--accent-sky)' },
      { label: '通过率', value: totalCount > 0 ? passRate + '%' : '-', sub: '', color: 'var(--accent-mint)' },
      { label: '待审批', value: String(overview.pendingCount || 0), sub: '笔待处理', color: 'var(--accent-orange)' },
    ]

    months.value = (monthly || []).map((m: any, i: number) => ({
      label: formatMonth(m.month),
      amount: m.totalAmount,
      color: barColors[i % barColors.length],
    }))
    maxAmount.value = Math.max(1, ...months.value.map((m: any) => m.amount))

    categories.value = (byCategory || []).map((c: any, i: number) => ({
      name: c.category,
      amount: c.totalAmount,
      color: `linear-gradient(90deg, ${barColors[i % barColors.length]}, ${barColors[(i + 3) % barColors.length]})`,
    }))
    maxCatAmount.value = Math.max(1, ...categories.value.map((c: any) => c.amount))
  } catch {}
})
</script>

<style scoped>
.statistics-page { max-width: 900px; }

.stats-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 16px;
}
.stat-summary { text-align: center; padding: 24px 16px; }
.stat-summary-value { font-size: 1.5rem; font-weight: 700; margin-bottom: 6px; }
.stat-summary-label { font-size: 0.85rem; color: var(--text-secondary); }
.stat-summary-sub { font-size: 0.78rem; margin-top: 4px; }

.form-section-title {
  font-size: 1rem;
  color: var(--text-primary);
  letter-spacing: 0.03em;
}

.bar-chart {
  display: flex;
  align-items: flex-end;
  gap: 16px;
  justify-content: center;
  padding: 8px 0;
}
.bar-item { display: flex; flex-direction: column; align-items: center; flex: 1; max-width: 80px; }
.bar-track {
  width: 100%;
  height: 120px;
  background: var(--bg-warm);
  border-radius: var(--radius-sm);
  display: flex;
  align-items: flex-end;
  overflow: hidden;
}
.bar-fill {
  width: 100%;
  border-radius: var(--radius-sm) var(--radius-sm) 0 0;
  transition: height 0.6s ease;
  min-height: 4px;
}
.bar-value, .bar-label { font-size: 0.75rem; }

.category-list { display: flex; flex-direction: column; gap: 14px; }
.category-header { display: flex; justify-content: space-between; margin-bottom: 6px; font-size: 0.9rem; }
.category-name { color: var(--text-primary); font-weight: 500; }
.category-amount { color: var(--text-secondary); font-weight: 600; }
.category-bar { height: 8px; background: var(--bg-warm); border-radius: 4px; overflow: hidden; }
.category-fill { height: 100%; border-radius: 4px; transition: width 0.6s ease; }

@media (max-width: 768px) {
  .stats-grid { grid-template-columns: repeat(2, 1fr); }
}
</style>
