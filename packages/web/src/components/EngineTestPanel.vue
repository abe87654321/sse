<template>
  <div class="engine-test-panel">
    <div class="test-controls">
      <input ref="fileInput" class="file-input" type="file" accept=".pdf,.ofd,.png,.jpg,.jpeg" @change="chooseFile" />
      <button type="button" class="file-picker" @click="openPicker">
        {{ file ? file.name : '选择样例发票（可选）' }}
      </button>
      <button v-if="file" type="button" class="link-btn" @click="clearFile">移除</button>
      <button type="button" class="btn-secondary btn-sm" :disabled="testing" @click="runTest">
        {{ testing ? '测试中...' : '开始测试' }}
      </button>
    </div>

    <div
      v-if="result"
      class="result-card"
      :class="{ success: result.success, fail: !result.success }"
      role="status"
      aria-live="polite"
    >
      <div class="result-head">
        <strong>{{ result.success ? '✓ 成功' : '✗ 失败' }}</strong>
        <span v-if="result.provider || result.endpoint">
          {{ [result.provider, result.endpoint].filter(Boolean).join(' · ') }}
        </span>
        <span>{{ formatElapsed(result.elapsedMs) }}</span>
      </div>
      <div v-if="result.fields && hasFields" class="field-grid">
        <div><span>发票号</span><b>{{ result.fields.invoiceNo || '-' }}</b></div>
        <div><span>金额</span><b>{{ money(amountOf(result.fields)) }}</b></div>
        <div><span>税额</span><b>{{ money(result.fields.taxAmount) }}</b></div>
        <div><span>日期</span><b>{{ result.fields.invoiceDate || '-' }}</b></div>
        <div><span>销方</span><b>{{ result.fields.sellerName || '-' }}</b></div>
        <div><span>购方</span><b>{{ result.fields.buyerName || '-' }}</b></div>
      </div>
      <div v-if="result.error" class="error-box" role="alert">
        <b>{{ result.error.code }}：</b>{{ result.error.message }}
        <div v-if="result.error.suggestion" class="suggestion">建议：{{ result.error.suggestion }}</div>
      </div>
      <div v-if="result.rawText" class="raw-text">
        <button type="button" class="link-btn" @click="showRaw = !showRaw">{{ showRaw ? '收起原始文本' : '展开原始文本' }}</button>
        <pre v-if="showRaw" tabindex="0">{{ result.rawText }}</pre>
      </div>
    </div>

    <div class="history">
      <div class="history-head">
        <span>历史记录（最近 {{ history.length }} 条）</span>
        <button v-if="history.length" type="button" class="link-btn" @click="clearHistory">清空历史</button>
      </div>
      <div v-for="entry in history" :key="entry.id" class="history-row" :class="{ fail: !entry.success }">
        <span>{{ entry.success ? '✓' : '✗' }}</span>
        <span>{{ formatTime(entry.createdAt) }}</span>
        <span>{{ entry.provider || typeLabel(entry.type) }}</span>
        <span>{{ formatElapsed(entry.elapsedMs) }}</span>
        <span>{{ entry.error?.code || historyAmount(entry) }}</span>
      </div>
      <div v-if="history.length === 0" class="empty-state">暂无测试记录</div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'

const props = withDefaults(defineProps<{
  testing: boolean
  result: any | null
  history?: any[]
}>(), {
  result: null,
  history: () => [],
})

const emit = defineEmits<{
  (event: 'test', payload: { file?: File }): void
  (event: 'clear-history'): void
}>()

const file = ref<File | null>(null)
const fileInput = ref<HTMLInputElement>()
const showRaw = ref(false)

watch(() => props.result, () => { showRaw.value = false })

const hasFields = computed(() => {
  const fields = props.result?.fields
  return !!fields && Object.values(fields).some(value => value !== undefined && value !== null && value !== '')
})

function openPicker() {
  fileInput.value?.click()
}

function chooseFile(event: Event) {
  const input = event.target as HTMLInputElement
  file.value = input.files?.[0] || null
}

function clearFile() {
  file.value = null
  if (fileInput.value) fileInput.value.value = ''
}

function runTest() {
  emit('test', { file: file.value || undefined })
}

function clearHistory() {
  emit('clear-history')
}

function typeLabel(type: string): string {
  const labels: Record<string, string> = { ocr: 'OCR', fill: '填单', connection: '连接' }
  return labels[type] || type || ''
}

function amountOf(fields: any): any {
  return fields?.totalAmount ?? fields?.amount
}

function historyAmount(entry: any): string {
  if (!entry?.fields) return ''
  return money(amountOf(entry.fields))
}

function formatElapsed(value: number | undefined): string {
  if (value === undefined || value === null || Number.isNaN(Number(value))) return '-'
  if (value === 0) return '0ms'
  return value >= 1000 ? `${(value / 1000).toFixed(2)}s` : `${value}ms`
}

function formatTime(value: string): string {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return `${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

function money(value: any): string {
  if (value === undefined || value === null || value === '') return '-'
  const number = Number(String(value).replace(/,/g, ''))
  if (!Number.isFinite(number)) return '-'
  return `${number < 0 ? '-' : ''}¥${Math.abs(number).toFixed(2)}`
}
</script>

<style scoped>
.engine-test-panel { margin-top: 12px; border-top: 1px dashed var(--border-light); padding-top: 12px; }
.test-controls { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.file-picker { display: inline-flex; align-items: center; border: 1px dashed var(--border); border-radius: var(--radius-sm); padding: 7px 10px; font-size: .8rem; color: var(--text-secondary); cursor: pointer; background: transparent; font-family: inherit; text-align: left; min-width: 0; overflow-wrap: anywhere; }
.file-input { display: none; }
.link-btn { border: none; background: none; color: var(--accent-coral); font-size: .78rem; cursor: pointer; text-decoration: underline; }
.result-card { margin-top: 10px; border-radius: var(--radius-sm); padding: 10px 12px; font-size: .82rem; background: var(--bg-input); }
.result-card.success { border-left: 3px solid #2b7a3d; }
.result-card.fail { border-left: 3px solid var(--accent-coral); }
.result-head { display: flex; gap: 10px; flex-wrap: wrap; align-items: center; }
.field-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 6px 14px; margin-top: 8px; }
.field-grid span { color: var(--text-muted); margin-right: 6px; }
.field-grid b { overflow-wrap: anywhere; }
.error-box { margin-top: 8px; padding: 8px 10px; border-radius: var(--radius-sm); background: var(--accent-coral-bg); color: var(--accent-coral); }
.suggestion { margin-top: 4px; color: var(--text-secondary); }
.raw-text { margin-top: 8px; }
.raw-text pre { max-height: 220px; overflow: auto; white-space: pre-wrap; word-break: break-all; background: var(--bg-card); padding: 8px; border-radius: var(--radius-sm); font-size: .75rem; }
.history { margin-top: 12px; }
.history-head { display: flex; justify-content: space-between; align-items: center; font-size: .8rem; color: var(--text-muted); margin-bottom: 6px; }
.history-row { display: grid; grid-template-columns: 18px 1fr 1fr 1fr 1fr; gap: 6px; font-size: .76rem; padding: 5px 0; border-bottom: 1px solid var(--border-light); color: var(--text-secondary); }
.history-row span { min-width: 0; overflow-wrap: anywhere; }
.history-row.fail { color: var(--accent-coral); }
.empty-state { text-align: center; color: var(--text-muted); padding: 12px 0; font-size: .8rem; }
</style>
