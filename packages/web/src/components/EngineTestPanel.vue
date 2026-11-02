<template>
  <div class="engine-test-panel">
    <div class="test-controls">
      <label class="file-picker">
        <input ref="fileInput" type="file" accept=".pdf,.ofd,.png,.jpg,.jpeg" @change="chooseFile" />
        <span>{{ file ? file.name : '选择样例发票（可选）' }}</span>
      </label>
      <button v-if="file" class="link-btn" @click="clearFile">移除</button>
      <button class="btn-secondary btn-sm" :disabled="testing" @click="runTest">
        {{ testing ? '测试中...' : '开始测试' }}
      </button>
    </div>

    <div v-if="result" class="result-card" :class="{ success: result.success, fail: !result.success }">
      <div class="result-head">
        <strong>{{ result.success ? '✓ 成功' : '✗ 失败' }}</strong>
        <span>{{ result.provider || '' }} · {{ result.endpoint || '' }}</span>
        <span>{{ formatElapsed(result.elapsedMs) }}</span>
      </div>
      <div v-if="result.fields && hasFields" class="field-grid">
        <div><span>发票号</span><b>{{ result.fields.invoiceNo || '-' }}</b></div>
        <div><span>金额</span><b>{{ money(result.fields.totalAmount || result.fields.amount) }}</b></div>
        <div><span>税额</span><b>{{ money(result.fields.taxAmount) }}</b></div>
        <div><span>日期</span><b>{{ result.fields.invoiceDate || '-' }}</b></div>
        <div><span>销方</span><b>{{ result.fields.sellerName || '-' }}</b></div>
        <div><span>购方</span><b>{{ result.fields.buyerName || '-' }}</b></div>
      </div>
      <div v-if="result.error" class="error-box">
        <b>{{ result.error.code }}：</b>{{ result.error.message }}
        <div class="suggestion">建议：{{ result.error.suggestion }}</div>
      </div>
      <div v-if="result.rawText" class="raw-text">
        <button class="link-btn" @click="showRaw = !showRaw">{{ showRaw ? '收起原始文本' : '展开原始文本' }}</button>
        <pre v-if="showRaw">{{ result.rawText }}</pre>
      </div>
    </div>

    <div class="history">
      <div class="history-head">
        <span>历史记录（最近 {{ history.length }} 条）</span>
        <button v-if="history.length" class="link-btn" @click="$emit('clear-history')">清空历史</button>
      </div>
      <div v-for="entry in history" :key="entry.id" class="history-row" :class="{ fail: !entry.success }">
        <span>{{ entry.success ? '✓' : '✗' }}</span>
        <span>{{ formatTime(entry.createdAt) }}</span>
        <span>{{ entry.provider || entry.type }}</span>
        <span>{{ formatElapsed(entry.elapsedMs) }}</span>
        <span>{{ entry.error?.code || (entry.fields?.totalAmount || entry.fields?.amount || '') }}</span>
      </div>
      <div v-if="history.length === 0" class="empty-state">暂无测试记录</div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'

const props = defineProps<{
  testing: boolean
  result: any | null
  history: any[]
}>()

const emit = defineEmits<{
  (event: 'test', payload: { file?: File }): void
  (event: 'clear-history'): void
}>()

const file = ref<File | null>(null)
const fileInput = ref<HTMLInputElement>()
const showRaw = ref(false)

const hasFields = computed(() => {
  const fields = props.result?.fields
  return !!fields && Object.values(fields).some(value => value !== undefined && value !== null && value !== '')
})

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

function formatElapsed(value: number | undefined): string {
  if (!value) return '0ms'
  return value >= 1000 ? `${(value / 1000).toFixed(2)}s` : `${value}ms`
}

function formatTime(value: string): string {
  if (!value) return ''
  const date = new Date(value)
  return `${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

function money(value: any): string {
  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? `¥${number.toFixed(2)}` : '-'
}
</script>

<style scoped>
.engine-test-panel { margin-top: 12px; border-top: 1px dashed var(--border-light); padding-top: 12px; }
.test-controls { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.file-picker { display: inline-flex; align-items: center; border: 1px dashed var(--border); border-radius: var(--radius-sm); padding: 7px 10px; font-size: .8rem; color: var(--text-secondary); cursor: pointer; }
.file-picker input { display: none; }
.link-btn { border: none; background: none; color: var(--accent-coral); font-size: .78rem; cursor: pointer; text-decoration: underline; }
.result-card { margin-top: 10px; border-radius: var(--radius-sm); padding: 10px 12px; font-size: .82rem; background: var(--bg-input); }
.result-card.success { border-left: 3px solid #2b7a3d; }
.result-card.fail { border-left: 3px solid var(--accent-coral); }
.result-head { display: flex; gap: 10px; flex-wrap: wrap; align-items: center; }
.field-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 6px 14px; margin-top: 8px; }
.field-grid span { color: var(--text-muted); margin-right: 6px; }
.error-box { margin-top: 8px; padding: 8px 10px; border-radius: var(--radius-sm); background: var(--accent-coral-bg); color: var(--accent-coral); }
.suggestion { margin-top: 4px; color: var(--text-secondary); }
.raw-text { margin-top: 8px; }
.raw-text pre { max-height: 220px; overflow: auto; white-space: pre-wrap; word-break: break-all; background: var(--bg-card); padding: 8px; border-radius: var(--radius-sm); font-size: .75rem; }
.history { margin-top: 12px; }
.history-head { display: flex; justify-content: space-between; align-items: center; font-size: .8rem; color: var(--text-muted); margin-bottom: 6px; }
.history-row { display: grid; grid-template-columns: 18px 1fr 1fr 1fr 1fr; gap: 6px; font-size: .76rem; padding: 5px 0; border-bottom: 1px solid var(--border-light); color: var(--text-secondary); }
.history-row.fail { color: var(--accent-coral); }
.empty-state { text-align: center; color: var(--text-muted); padding: 12px 0; font-size: .8rem; }
</style>
