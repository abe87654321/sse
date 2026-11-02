<template>
  <div class="expense-list-page">
    <div class="toolbar">
      <select v-model="filters.status" class="filter-select">
        <option value="">全部状态</option>
        <option value="draft">草稿</option>
        <option value="pending">待审批</option>
        <option value="approved">已通过</option>
        <option value="rejected">已驳回</option>
        <option value="paid">已付款</option>
      </select>
      <input v-model="filters.keyword" type="text" placeholder="搜索编号或标题..." class="search-input" />
      <div class="toolbar-spacer"></div>
      <button class="btn-primary" @click="$router.push('/expenses/new')">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
          <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
        </svg>
        新建报销
      </button>
    </div>

    <div class="table-wrap">
      <table class="data-table">
        <thead>
          <tr>
            <th>编号</th>
            <th>报销人</th>
            <th>标题</th>
            <th class="text-right">金额</th>
            <th>状态</th>
            <th>类别</th>
            <th class="text-right">日期</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="item in expenses" :key="item.id" @click="$router.push(`/expenses/${item.id}`)">
            <td class="text-muted" style="font-size:0.8rem;">{{ item.serialNo }}</td>
            <td class="text-secondary">{{ item.applicantName || '-' }}</td>
            <td class="title-cell">{{ item.title }}</td>
            <td class="text-right">&yen;{{ (item.totalAmount || 0).toLocaleString() }}</td>
            <td><span class="badge" :class="`badge-${item.status}`">{{ statusLabels[item.status] }}</span></td>
            <td>
              <div
                v-if="item.categoryNames && item.categoryNames.length"
                class="category-tags"
                :title="item.categoryNames.join('、')"
              >
                <span v-for="name in item.categoryNames.slice(0, 3)" :key="name" class="category-tag">{{ name }}</span>
                <span v-if="item.categoryNames.length > 3" class="category-more">+{{ item.categoryNames.length - 3 }}</span>
              </div>
              <span v-else class="text-secondary">-</span>
            </td>
            <td class="text-right text-muted" style="font-size:0.82rem;">{{ (item.submittedAt || item.createdAt || '').slice(0, 10) }}</td>
            <td class="col-action">
              <span v-if="item.status === 'draft' || item.status === 'rejected'" class="table-link" @click.stop="$router.push(`/expenses/${item.id}/edit`)">编辑</span>
              <span v-else class="table-link" @click.stop="$router.push(`/expenses/${item.id}`)">查看</span>
            </td>
          </tr>
          <tr v-if="loading">
            <td colspan="8">
              <div class="empty-state">
                <div class="empty-state-text">加载中...</div>
              </div>
            </td>
          </tr>
          <tr v-else-if="expenses.length === 0">
            <td colspan="8">
              <div class="empty-state">
                <div class="empty-state-icon">&#128203;</div>
                <div class="empty-state-text">暂无报销记录</div>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <div class="pagination">
      <span class="pagination-info">共 {{ total }} 条记录</span>
      <div class="pagination-pages">
        <button class="pagination-btn" :disabled="page <= 1 || loading" @click="goToPage(page - 1)">&lt;</button>
        <button
          v-for="p in pageNumbers"
          :key="p"
          class="pagination-btn"
          :class="{ active: p === page }"
          :disabled="loading"
          @click="goToPage(p)"
        >{{ p }}</button>
        <button class="pagination-btn" :disabled="page >= totalPages || loading" @click="goToPage(page + 1)">&gt;</button>
      </div>
    </div>

    <button class="fab" @click="$router.push('/expenses/new')" title="新建报销">
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
        <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
      </svg>
    </button>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted, onBeforeUnmount, watch } from 'vue'
import api from '../api/index'

const statusLabels: Record<string, string> = {
  draft: '草稿', pending: '待审批', approved: '已通过', rejected: '已驳回', paid: '已付款'
}

const filters = reactive({ status: '', keyword: '' })
const page = ref(1)
const pageSize = 20
const total = ref(0)
const loading = ref(false)
const expenses = ref<any[]>([])

const totalPages = computed(() => Math.max(1, Math.ceil(total.value / pageSize)))

const pageNumbers = computed(() => {
  const last = totalPages.value
  if (last <= 7) return Array.from({ length: last }, (_, i) => i + 1)
  const start = Math.max(1, Math.min(page.value - 3, last - 6))
  return Array.from({ length: 7 }, (_, i) => start + i)
})

let searchTimer: ReturnType<typeof setTimeout> | null = null

async function fetchExpenses() {
  loading.value = true
  try {
    const params: Record<string, string | number> = { page: page.value, pageSize }
    if (filters.status) params.status = filters.status
    if (filters.keyword.trim()) params.keyword = filters.keyword.trim()
    const res = await api.get('/expenses', { params })
    expenses.value = res.data.results || []
    total.value = res.data.total || 0
  } catch {
    expenses.value = []
    total.value = 0
  } finally {
    loading.value = false
  }
}

function goToPage(next: number) {
  if (next < 1 || next > totalPages.value || next === page.value) return
  page.value = next
  fetchExpenses()
}

watch(() => filters.status, () => {
  page.value = 1
  fetchExpenses()
})

watch(() => filters.keyword, () => {
  page.value = 1
  if (searchTimer) clearTimeout(searchTimer)
  searchTimer = setTimeout(fetchExpenses, 300)
})

onMounted(fetchExpenses)

onBeforeUnmount(() => {
  if (searchTimer) clearTimeout(searchTimer)
})
</script>

<style scoped>
.filter-select {
  width: auto;
  min-width: 130px;
}
.search-input { width: 220px; }
.title-cell { max-width: 260px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.category-tags { display: flex; flex-wrap: wrap; align-items: center; gap: 4px; max-width: 220px; }
.category-tag {
  display: inline-block;
  padding: 1px 8px;
  border-radius: 999px;
  background: var(--bg-warm);
  color: var(--text-secondary);
  font-size: 0.75rem;
  white-space: nowrap;
}
.category-more { font-size: 0.72rem; color: var(--text-muted); }
</style>
