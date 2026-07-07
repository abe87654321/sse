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
            <th>标题</th>
            <th class="text-right">金额</th>
            <th>状态</th>
            <th>类别</th>
            <th class="text-right">日期</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="item in filteredExpenses" :key="item.id" @click="$router.push(`/expenses/${item.id}`)">
            <td class="text-muted" style="font-size:0.8rem;">{{ item.serialNo }}</td>
            <td class="title-cell">{{ item.title }}</td>
            <td class="text-right">&yen;{{ (item.totalAmount || 0).toLocaleString() }}</td>
            <td><span class="badge" :class="`badge-${item.status}`">{{ statusLabels[item.status] }}</span></td>
            <td class="text-secondary">{{ item.category || '-' }}</td>
            <td class="text-right text-muted" style="font-size:0.82rem;">{{ (item.submittedAt || item.createdAt || '').slice(0, 10) }}</td>
            <td class="col-action">
              <span v-if="item.status === 'draft'" class="table-link" @click.stop="$router.push(`/expenses/${item.id}`)">编辑</span>
              <span v-else class="table-link" @click.stop="$router.push(`/expenses/${item.id}`)">查看</span>
            </td>
          </tr>
          <tr v-if="filteredExpenses.length === 0">
            <td colspan="7">
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
      <span class="pagination-info">共 {{ filteredExpenses.length }} 条记录</span>
      <div class="pagination-pages">
        <button class="pagination-btn" :disabled="page <= 1" @click="page--">&lt;</button>
        <button class="pagination-btn" :class="{ active: page === 1 }" @click="page = 1">1</button>
        <button class="pagination-btn active">1</button>
        <button class="pagination-btn" @click="page++">&gt;</button>
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
import { ref, reactive, computed, onMounted } from 'vue'
import api from '../api/index'

const statusLabels: Record<string, string> = {
  draft: '草稿', pending: '待审批', approved: '已通过', rejected: '已驳回', paid: '已付款'
}

const filters = reactive({ status: '', keyword: '' })
const page = ref(1)
const allExpenses = ref<any[]>([])

onMounted(async () => {
  try {
    const res = await api.get('/expenses')
    allExpenses.value = res.data || []
  } catch {}
})

const filteredExpenses = computed(() => {
  let list = allExpenses.value
  if (filters.status) list = list.filter(e => e.status === filters.status)
  if (filters.keyword) {
    const kw = filters.keyword.toLowerCase()
    list = list.filter(e => (e.serialNo || '').toLowerCase().includes(kw) || e.title.toLowerCase().includes(kw))
  }
  return list
})
</script>

<style scoped>
.filter-select {
  width: auto;
  min-width: 130px;
}
.search-input { width: 220px; }
.title-cell { max-width: 260px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
</style>
