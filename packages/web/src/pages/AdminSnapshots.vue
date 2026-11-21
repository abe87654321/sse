<template>
  <div class="page">
    <h2 class="font-heading page-title">内容快照</h2>

    <div class="card filters">
      <input v-model="filters.reportId" class="input" placeholder="报销单 ID" />
      <select v-model="filters.snapshotType" class="input">
        <option value="">全部类型</option>
        <option value="submit">提交</option>
        <option value="approve">审批通过</option>
        <option value="reject">驳回</option>
        <option value="pay">付款</option>
        <option value="backfill">历史回填</option>
      </select>
      <select v-model="filters.legacy" class="input">
        <option value="">全部来源</option>
        <option value="false">运行时</option>
        <option value="true">历史回填</option>
      </select>
      <input v-model="filters.from" class="input" type="date" />
      <input v-model="filters.to" class="input" type="date" />
      <button class="btn-primary btn-sm" @click="search">查询</button>
    </div>

    <div class="card">
      <div v-if="loading" class="no-data">加载中…</div>
      <div v-else-if="items.length === 0" class="no-data">暂无快照</div>
      <table v-else class="data-table">
        <thead>
          <tr><th>类型</th><th>报销单</th><th>操作人</th><th>哈希</th><th>来源</th><th>时间</th><th></th></tr>
        </thead>
        <tbody>
          <tr v-for="item in items" :key="item.id">
            <td>{{ snapshotTypeLabel(item.snapshotType) }}</td>
            <td class="mono">{{ item.reportId }}</td>
            <td>{{ snapshotActorLabel(item) }}</td>
            <td class="mono">{{ shortHash(item.contentHash) }}</td>
            <td><span v-if="item.legacy" class="badge badge-draft">历史回填</span><span v-else>运行时</span></td>
            <td>{{ formatSnapshotTime(item.createdAt) }}</td>
            <td><button class="table-link" @click="open(item.id)">查看</button></td>
          </tr>
        </tbody>
      </table>

      <div class="pager">
        <button class="btn-secondary btn-sm" :disabled="offset === 0" @click="prev">上一页</button>
        <span>共 {{ total }} 条</span>
        <button class="btn-secondary btn-sm" :disabled="offset + limit >= total" @click="next">下一页</button>
      </div>
    </div>

    <SnapshotViewer v-model="showViewer" :snapshot="selected" />
  </div>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import api from '../api/index'
import SnapshotViewer from '../components/SnapshotViewer.vue'
import {
  formatSnapshotTime,
  shortHash,
  snapshotActorLabel,
  snapshotTypeLabel,
} from '../utils/snapshot'

const items = ref<any[]>([])
const total = ref(0)
const limit = 20
const offset = ref(0)
const loading = ref(true)
const showViewer = ref(false)
const selected = ref<any>(null)

const filters = reactive({
  reportId: '',
  snapshotType: '',
  legacy: '',
  from: '',
  to: '',
})

async function load() {
  loading.value = true
  try {
    const params: Record<string, any> = { limit, offset: offset.value }
    if (filters.reportId) params.reportId = filters.reportId
    if (filters.snapshotType) params.snapshotType = filters.snapshotType
    if (filters.legacy) params.legacy = filters.legacy
    if (filters.from) params.from = `${filters.from}T00:00:00`
    if (filters.to) params.to = `${filters.to}T23:59:59.999`
    const res = await api.get('/admin/snapshots', { params })
    items.value = res.data.items || []
    total.value = res.data.total || 0
  } catch {
    items.value = []
    total.value = 0
  } finally {
    loading.value = false
  }
}

function search() {
  offset.value = 0
  load()
}

function prev() {
  offset.value = Math.max(offset.value - limit, 0)
  load()
}

function next() {
  offset.value += limit
  load()
}

async function open(id: string) {
  try {
    const res = await api.get(`/admin/snapshots/${id}`)
    selected.value = res.data
    showViewer.value = true
  } catch (e: any) {
    alert(e?.response?.data?.error?.message || '加载快照失败')
  }
}

onMounted(load)
</script>

<style scoped>
.page-title { font-size: 1.2rem; margin-bottom: 16px; }
.filters { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; margin-bottom: 16px; }
.filters .input { max-width: 180px; }
.no-data { font-size: 0.85rem; color: var(--text-muted); padding: 24px 0; text-align: center; }
.mono { font-family: monospace; font-size: 0.78rem; }
.pager { display: flex; justify-content: flex-end; align-items: center; gap: 12px; margin-top: 12px; font-size: 0.8rem; color: var(--text-muted); }
</style>
