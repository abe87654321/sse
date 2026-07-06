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
      <div class="bar-chart">
        <div class="bar-item" v-for="m in months" :key="m.label">
          <div class="bar-value text-muted" style="margin-bottom:4px;">&#165;{{ m.amount.toLocaleString() }}</div>
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
      <div class="category-list">
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
const summaries = [
  { label: '本月总支出', value: '&#165;24,500', sub: '较上月 +12%', color: 'var(--accent-coral)' },
  { label: '报销次数', value: '12', sub: '较上月 +2', color: 'var(--accent-sky)' },
  { label: '平均金额', value: '&#165;2,042', sub: '每笔平均', color: 'var(--accent-orange)' },
  { label: '审批通过率', value: '92%', sub: '12/13 已通过', color: 'var(--accent-mint)' },
]

const months = [
  { label: '1月', amount: 18000, color: 'var(--accent-coral)' },
  { label: '2月', amount: 21000, color: 'var(--accent-orange)' },
  { label: '3月', amount: 15500, color: 'var(--accent-sky)' },
  { label: '4月', amount: 23500, color: 'var(--accent-violet)' },
  { label: '5月', amount: 19000, color: 'var(--accent-mint)' },
  { label: '6月', amount: 24500, color: 'var(--accent-coral)' },
]
const maxAmount = Math.max(...months.map(m => m.amount))

const categories = [
  { name: '差旅费', amount: 9800, color: 'linear-gradient(90deg, var(--accent-coral), var(--accent-coral-light))' },
  { name: '办公费', amount: 5200, color: 'linear-gradient(90deg, var(--accent-sky), #74c0fc)' },
  { name: '招待费', amount: 3600, color: 'linear-gradient(90deg, var(--accent-orange), #ffc078)' },
  { name: '培训费', amount: 2800, color: 'linear-gradient(90deg, var(--accent-violet), #b197fc)' },
  { name: '交通费', amount: 1800, color: 'linear-gradient(90deg, var(--accent-mint), #69db7c)' },
  { name: '其他', amount: 1300, color: 'linear-gradient(90deg, var(--text-muted), var(--border))' },
]
const maxCatAmount = Math.max(...categories.map(c => c.amount))
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
