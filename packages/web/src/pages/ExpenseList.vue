<template>
  <div class="expense-list-page">
    <div class="page-toolbar">
      <div class="filter-group">
        <el-select v-model="filters.status" placeholder="全部状态" size="default" clearable>
          <el-option label="草稿" value="draft" />
          <el-option label="待审批" value="pending" />
          <el-option label="已通过" value="approved" />
          <el-option label="已驳回" value="rejected" />
          <el-option label="已付款" value="paid" />
        </el-select>
        <el-date-picker
          v-model="filters.dateRange"
          type="daterange"
          range-separator="至"
          start-placeholder="开始日期"
          end-placeholder="结束日期"
          size="default"
        />
        <el-input
          v-model="filters.keyword"
          placeholder="搜索编号或标题..."
          size="default"
          clearable
          class="search-input"
        />
      </div>
      <button class="btn-new-expense" @click="$router.push('/expenses/new')">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
        </svg>
        <span>新建报销</span>
      </button>
    </div>

    <div class="table-wrap">
      <table class="data-table">
        <thead>
          <tr>
            <th>编号</th>
            <th>标题</th>
            <th class="text-right">金额</th>
            <th>状态</th>
            <th>类别</th>
            <th class="text-right">日期</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(item, i) in expenses" :key="item.id" class="data-row" :style="{ animationDelay: `${i * 0.04}s` }">
            <td class="font-mono text-muted">{{ item.serialNo }}</td>
            <td class="title-cell">{{ item.title }}</td>
            <td class="text-right font-mono">&yen;{{ item.amount.toLocaleString() }}</td>
            <td><span class="badge" :class="`badge-${item.status}`">{{ statusLabels[item.status] }}</span></td>
            <td class="text-muted">{{ item.category }}</td>
            <td class="text-right text-muted">{{ item.date }}</td>
            <td>
              <button class="row-action" @click="$router.push(`/expenses/${item.id}`)">查看</button>
            </td>
          </tr>
          <tr v-if="expenses.length === 0">
            <td colspan="7" class="empty-cell">暂无报销记录</td>
          </tr>
        </tbody>
      </table>
    </div>

    <div class="pagination-row">
      <span class="pagination-info">共 {{ total }} 条记录</span>
      <el-pagination
        v-model:current-page="page"
        :page-size="pageSize"
        :total="total"
        background
        layout="prev, pager, next"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive } from 'vue'

const statusLabels: Record<string, string> = { draft: '草稿', pending: '待审批', approved: '已通过', rejected: '已驳回', paid: '已付款' }

const filters = reactive({ status: '', dateRange: null as any, keyword: '' })
const page = ref(1)
const pageSize = ref(10)
const total = ref(5)

const expenses = [
  { id: '1', serialNo: 'SSE-20240701-001', title: '差旅费报销-北京出差', amount: 3850, status: 'approved', category: '差旅费', date: '2024-07-01' },
  { id: '2', serialNo: 'SSE-20240703-002', title: '办公用品采购', amount: 1260, status: 'paid', category: '办公费', date: '2024-07-03' },
  { id: '3', serialNo: 'SSE-20240704-003', title: '招待费-客户用餐', amount: 890, status: 'pending', category: '招待费', date: '2024-07-04' },
  { id: '4', serialNo: 'SSE-20240703-004', title: '交通费报销', amount: 345, status: 'approved', category: '交通费', date: '2024-07-03' },
  { id: '5', serialNo: 'SSE-20240702-005', title: '培训费-技术峰会门票', amount: 2800, status: 'rejected', category: '培训费', date: '2024-07-02' },
]
</script>

<style scoped>
.page-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 20px;
  flex-wrap: wrap;
  gap: 12px;
}
.filter-group {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}
.filter-group :deep(.el-input__wrapper),
.filter-group :deep(.el-select .el-input__wrapper) {
  background: var(--bg-card) !important;
  border: 1px solid var(--border) !important;
  box-shadow: none !important;
  border-radius: var(--radius) !important;
  transition: border-color var(--transition);
}
.filter-group :deep(.el-input__wrapper:hover),
.filter-group :deep(.el-select .el-input__wrapper:hover) {
  border-color: var(--border-light) !important;
}
.filter-group :deep(.el-input__inner) { color: var(--text-primary) !important; }
.filter-group :deep(.el-input__inner::placeholder) { color: var(--text-muted) !important; }
.search-input { width: 220px; }

.btn-new-expense {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 8px 18px;
  background: var(--accent-amber);
  color: #0f1117;
  font-weight: 600;
  font-size: 0.9rem;
  border-radius: var(--radius);
  transition: all var(--transition);
}
.btn-new-expense:hover { background: var(--accent-amber-dark); }

.table-wrap {
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  overflow: hidden;
}
.data-table {
  width: 100%;
  border-collapse: collapse;
}
.data-table th {
  padding: 14px 16px;
  font-size: 0.75rem;
  font-weight: 500;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  text-align: left;
  border-bottom: 1px solid var(--border);
}
.data-table td {
  padding: 14px 16px;
  font-size: 0.9rem;
  border-bottom: 1px solid var(--border);
}
.data-row {
  animation: fadeSlideIn 0.4s ease both;
  cursor: pointer;
  transition: background var(--transition);
}
.data-row:hover { background: rgba(255, 255, 255, 0.03); }
.data-row:last-child td { border-bottom: none; }
@keyframes fadeSlideIn {
  from { opacity: 0; transform: translateY(8px); }
  to { opacity: 1; transform: translateY(0); }
}

.text-right { text-align: right; }
.empty-cell { text-align: center; color: var(--text-muted); padding: 48px 16px !important; }
.title-cell { max-width: 240px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

.row-action {
  padding: 4px 12px;
  background: transparent;
  color: var(--accent-amber);
  font-size: 0.85rem;
  border-radius: var(--radius);
  transition: all var(--transition);
}
.row-action:hover { background: rgba(240, 185, 11, 0.1); }

.pagination-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 20px;
}
.pagination-info { font-size: 0.85rem; color: var(--text-muted); }
.pagination-row :deep(.el-pager li) {
  background: var(--bg-card) !important;
  color: var(--text-secondary) !important;
  border: 1px solid var(--border) !important;
}
.pagination-row :deep(.el-pager li.is-active) {
  background: var(--accent-amber) !important;
  color: #0f1117 !important;
  border-color: var(--accent-amber) !important;
}
.pagination-row :deep(.btn-prev),
.pagination-row :deep(.btn-next) {
  background: var(--bg-card) !important;
  color: var(--text-secondary) !important;
  border: 1px solid var(--border) !important;
}
</style>
