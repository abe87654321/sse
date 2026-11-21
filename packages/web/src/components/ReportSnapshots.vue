<template>
  <div class="card">
    <h3 class="card-section-title font-heading">内容快照</h3>
    <div v-if="loading" class="no-data">加载中…</div>
    <div v-else-if="items.length === 0" class="no-data">暂无快照</div>
    <div v-else class="snapshot-list">
      <div v-for="item in items" :key="item.id" class="snapshot-row">
        <div class="snapshot-row-main">
          <span class="snapshot-type">{{ snapshotTypeLabel(item.snapshotType) }}</span>
          <span class="snapshot-time">{{ formatSnapshotTime(item.createdAt) }}</span>
          <span class="snapshot-actor">{{ snapshotActorLabel(item) }}</span>
          <span v-if="item.legacy" class="badge badge-draft">历史回填</span>
        </div>
        <button class="table-link" :disabled="loadingDetail === item.id" @click="open(item.id)">
          {{ loadingDetail === item.id ? '加载中…' : '查看' }}
        </button>
      </div>
    </div>

    <SnapshotViewer v-model="showViewer" :snapshot="selected" />
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
import api from '../api/index'
import SnapshotViewer from './SnapshotViewer.vue'
import { formatSnapshotTime, snapshotActorLabel, snapshotTypeLabel } from '../utils/snapshot'

const props = defineProps<{ reportId: string }>()

const items = ref<any[]>([])
const loading = ref(true)
const loadingDetail = ref('')
const showViewer = ref(false)
const selected = ref<any>(null)

async function load() {
  loading.value = true
  try {
    const res = await api.get(`/expenses/${props.reportId}/snapshots`)
    items.value = res.data.items || []
  } catch {
    items.value = []
  } finally {
    loading.value = false
  }
}

async function open(id: string) {
  loadingDetail.value = id
  try {
    const res = await api.get(`/expenses/${props.reportId}/snapshots/${id}`)
    selected.value = res.data
    showViewer.value = true
  } catch (e: any) {
    alert(e?.response?.data?.error?.message || '加载快照失败')
  } finally {
    loadingDetail.value = ''
  }
}

onMounted(load)
</script>

<style scoped>
.snapshot-list { display: flex; flex-direction: column; gap: 8px; }
.snapshot-row { display: flex; justify-content: space-between; align-items: center; gap: 12px; padding: 8px 0; border-bottom: 1px solid var(--border-light); }
.snapshot-row:last-child { border-bottom: none; }
.snapshot-row-main { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; }
.snapshot-type { font-size: 0.85rem; font-weight: 600; color: var(--text-primary); }
.snapshot-time, .snapshot-actor { font-size: 0.78rem; color: var(--text-muted); }
.no-data { font-size: 0.85rem; color: var(--text-muted); padding: 20px 0; text-align: center; }
</style>
