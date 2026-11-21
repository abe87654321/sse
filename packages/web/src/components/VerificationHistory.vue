<template>
  <div class="card verification-history">
    <div class="history-header">
      <h3 class="card-section-title font-heading">核对历史</h3>
      <button class="btn-secondary btn-sm" :disabled="loading" @click="load">
        {{ loading ? '加载中...' : '刷新' }}
      </button>
    </div>

    <div v-if="loading && runs.length === 0" class="history-empty">加载中...</div>
    <div v-else-if="runs.length === 0" class="history-empty">暂无核对历史</div>

    <div v-else class="history-list">
      <div v-for="run in runs" :key="run.id" class="history-run">
        <div class="run-head" @click="toggle(run.id)">
          <div class="run-main">
            <span class="run-event" :class="`event-${run.eventType}`">{{ historyEventLabel(run.eventType) }}</span>
            <span class="run-time">{{ formatHistoryTime(run.checkedAt) }}</span>
            <span class="run-badge" :class="`status-${run.status}`">{{ historyStatusLabel(run.status) }}</span>
            <span v-if="run.legacy" class="run-legacy">历史回填</span>
            <span v-if="!run.hashValid" class="run-tamper">哈希校验失败</span>
          </div>
          <div class="run-actor">{{ historyActorLabel(run) }} · {{ historyCauseLabel(run.cause) }}</div>
        </div>

        <p class="run-summary">{{ historySummary(run) }}</p>
        <p v-if="run.reason" class="run-reason">{{ run.reason }}</p>

        <div v-if="expanded[run.id]" class="run-items">
          <div v-if="run.items.length === 0" class="history-empty">本次核对无发票/回单</div>
          <div v-for="item in run.items" :key="item.id" class="run-item">
            <div class="item-head">
              <span class="item-file">📎 {{ item.fileName || item.subjectId }}</span>
              <span class="run-badge" :class="`status-${item.status}`">{{ historyStatusLabel(item.status) }}</span>
            </div>
            <div v-if="item.result?.event === 'invalidated'" class="item-meta">
              原状态：{{ historyStatusLabel(itemPreviousStatus(item)) }}
              <span v-if="item.result?.previousVerifiedAt"> · {{ formatHistoryTime(item.result.previousVerifiedAt) }}</span>
            </div>
            <ul v-else-if="item.result?.checks?.length" class="item-checks">
              <li v-for="check in item.result.checks" :key="check.key" :class="{ fail: !check.ok }">
                {{ check.ok ? '✓' : '✗' }} {{ check.label }}<template v-if="check.message">：{{ check.message }}</template>
              </li>
            </ul>
            <p v-else-if="item.result?.summary" class="item-meta">{{ item.result.summary }}</p>
            <div v-if="item.result?.ocr?.invoiceNo" class="item-meta">
              发票号：{{ item.result.ocr.invoiceNo }}
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import api from '../api/index'
import { useAuthStore } from '../stores/auth'
import {
  formatHistoryTime,
  historyActorLabel,
  historyCauseLabel,
  historyEventLabel,
  historyStatusLabel,
  historySummary,
  itemPreviousStatus,
} from '../utils/verification-history'

const props = defineProps<{ reportId: string }>()

const auth = useAuthStore()
const runs = ref<any[]>([])
const loading = ref(false)
const expanded = reactive<Record<string, boolean>>({})

function canSeeReceipts() {
  return auth.user?.role === 'finance' || auth.user?.role === 'admin'
}

async function load() {
  loading.value = true
  try {
    const { data } = await api.get(`/expenses/${props.reportId}/verification-history`, {
      params: { kind: canSeeReceipts() ? 'all' : 'invoice', limit: 50 },
    })
    runs.value = data.items || []
  } catch {
    runs.value = []
  } finally {
    loading.value = false
  }
}

function toggle(id: string) {
  expanded[id] = !expanded[id]
}

onMounted(load)
</script>

<style scoped>
.verification-history { display: flex; flex-direction: column; gap: 12px; }
.history-header { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.history-header .card-section-title { margin: 0; padding: 0; border: none; }
.history-empty { color: var(--text-muted); font-size: 0.82rem; }
.history-list { display: flex; flex-direction: column; gap: 10px; }
.history-run { border: 1px solid var(--border-light); border-radius: var(--radius-sm); padding: 10px 12px; }
.run-head { cursor: pointer; display: flex; flex-wrap: wrap; justify-content: space-between; gap: 6px; }
.run-main { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.run-event { font-weight: 600; font-size: 0.85rem; }
.run-event.event-invalidate { color: var(--accent-coral); }
.run-time { font-size: 0.78rem; color: var(--text-muted); }
.run-badge { font-size: 0.78rem; }
.run-badge.status-pass { color: #2b7a3d; }
.run-badge.status-warning,
.run-badge.status-error,
.run-badge.status-invalidated { color: var(--accent-coral); }
.run-badge.status-unverified,
.run-badge.status-no_invoices { color: var(--text-muted); }
.run-legacy,
.run-tamper { font-size: 0.72rem; padding: 1px 6px; border-radius: 999px; background: var(--bg-warm); color: var(--text-secondary); }
.run-tamper { color: var(--accent-coral); }
.run-actor { font-size: 0.76rem; color: var(--text-muted); }
.run-summary { margin: 6px 0 0; font-size: 0.82rem; color: var(--text-secondary); }
.run-reason { margin: 4px 0 0; font-size: 0.78rem; color: var(--text-muted); }
.run-items { margin-top: 10px; display: flex; flex-direction: column; gap: 8px; }
.run-item { border-top: 1px dashed var(--border-light); padding-top: 8px; }
.item-head { display: flex; justify-content: space-between; gap: 8px; }
.item-file { font-size: 0.82rem; color: var(--text-primary); }
.item-meta { margin-top: 4px; font-size: 0.78rem; color: var(--text-muted); }
.item-checks { margin: 6px 0 0; padding-left: 18px; font-size: 0.78rem; color: var(--text-secondary); }
.item-checks li.fail { color: var(--accent-coral); }
</style>
