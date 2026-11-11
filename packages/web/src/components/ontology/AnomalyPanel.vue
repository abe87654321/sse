<template>
  <section class="anomaly-panel card">
    <header class="panel-header">
      <div>
        <h3>异常监控</h3>
        <p>检查金额不一致、重复发票号与缺失审批人等图数据异常。</p>
      </div>
      <div class="panel-actions">
        <select v-model="codeFilter" class="input-sm" aria-label="按异常代码筛选">
          <option value="">全部代码</option>
          <option v-for="code in codeOptions" :key="code" :value="code">{{ code }}</option>
        </select>
        <button class="btn-secondary btn-sm" :disabled="loading" @click="loadAnomalies">
          {{ loading ? '加载中...' : '刷新' }}
        </button>
      </div>
    </header>

    <p v-if="error" class="panel-error">{{ error }}</p>

    <div v-if="summary" class="anomaly-summary">
      <span class="summary-chip">总计 {{ summary.total }}</span>
      <span class="summary-chip severity-error">错误 {{ summary.error }}</span>
      <span class="summary-chip severity-warning">警告 {{ summary.warning }}</span>
      <span class="summary-chip severity-info">提示 {{ summary.info }}</span>
    </div>

    <div v-if="!loading && anomalies.length === 0 && !error" class="panel-muted">
      没有发现异常
    </div>

    <ul v-else class="anomaly-list">
      <li v-for="(anomaly, index) in anomalies" :key="`${anomaly.code}-${index}`" class="anomaly-item">
        <div class="anomaly-head">
          <span class="severity-badge" :class="`severity-${anomaly.severity}`">
            {{ severityLabel(anomaly.severity) }}
          </span>
          <span class="anomaly-code">{{ anomaly.code }}</span>
          <span class="anomaly-message">{{ anomaly.message }}</span>
        </div>
        <div class="anomaly-links">
          <template v-if="anomaly.entities.length > 0">
            <span class="links-label">实体：</span>
            <button
              v-for="(uri, entityIndex) in anomaly.entities"
              :key="`entity-${index}-${entityIndex}`"
              type="button"
              class="link-button"
              @click="emit('select', uri)"
            >
              {{ shortUri(uri) }}
            </button>
          </template>
          <template v-if="anomaly.evidence.length > 0">
            <span class="links-label">证据：</span>
            <button
              v-for="(uri, evidenceIndex) in anomaly.evidence"
              :key="`evidence-${index}-${evidenceIndex}`"
              type="button"
              class="link-button evidence-link"
              @click="emit('select', uri)"
            >
              {{ shortUri(uri) }}
            </button>
          </template>
        </div>
      </li>
    </ul>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import {
  ontologyApi,
  type Anomaly,
  type AnomalyResult,
  type AnomalySummary,
} from '../../api/ontology'
import { localName } from './utils'

const KNOWN_CODES = ['amount_mismatch', 'duplicate_invoice_no', 'missing_approver']

const emit = defineEmits<{
  (event: 'select', uri: string): void
}>()

const anomalies = ref<Anomaly[]>([])
const summary = ref<AnomalySummary | null>(null)
const codeFilter = ref('')
const loading = ref(false)
const error = ref<string | null>(null)

const codeOptions = computed(() => {
  const codes = new Set<string>(KNOWN_CODES)
  for (const code of Object.keys(summary.value?.byCode ?? {})) codes.add(code)
  return [...codes].sort((a, b) => a.localeCompare(b))
})

function errorMessage(err: unknown): string {
  const anyErr = err as {
    response?: { data?: { error?: { message?: string }; message?: string } }
    message?: string
  }
  return (
    anyErr?.response?.data?.error?.message ||
    anyErr?.response?.data?.message ||
    anyErr?.message ||
    '请求失败'
  )
}

function shortUri(uri: string): string {
  return localName(uri) || uri
}

function severityLabel(severity: Anomaly['severity']): string {
  if (severity === 'error') return '错误'
  if (severity === 'warning') return '警告'
  return '提示'
}

async function loadAnomalies(): Promise<void> {
  loading.value = true
  error.value = null
  try {
    const response = await ontologyApi.anomalies({
      ...(codeFilter.value ? { codes: codeFilter.value } : {}),
      limit: 500,
    })
    const data = response.data as AnomalyResult
    anomalies.value = data.anomalies ?? []
    summary.value = data.summary ?? null
  } catch (err) {
    anomalies.value = []
    summary.value = null
    error.value = errorMessage(err)
  } finally {
    loading.value = false
  }
}

watch(codeFilter, () => {
  void loadAnomalies()
})

onMounted(() => {
  void loadAnomalies()
})
</script>

<style scoped>
.anomaly-panel {
  padding: 18px 20px;
}
.panel-header {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  gap: 12px;
  align-items: flex-start;
}
.panel-header h3 {
  margin: 0 0 4px;
  font-size: 1rem;
  color: var(--text-primary);
}
.panel-header p {
  margin: 0;
  font-size: 0.82rem;
  color: var(--text-secondary);
}
.panel-actions {
  display: flex;
  gap: 8px;
  align-items: center;
}
.panel-actions .input-sm {
  height: 32px;
  font-size: 0.8rem;
  padding: 0 8px;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-sm);
  background: var(--bg-card);
  color: var(--text-primary);
}
.panel-error {
  margin: 12px 0 0;
  color: #b42318;
  font-size: 0.82rem;
}
.anomaly-summary {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin: 14px 0 6px;
}
.summary-chip {
  padding: 2px 10px;
  border-radius: 999px;
  font-size: 0.74rem;
  background: rgba(100, 116, 139, 0.12);
  color: var(--text-secondary);
}
.summary-chip.severity-error {
  background: rgba(220, 38, 38, 0.12);
  color: #b42318;
}
.summary-chip.severity-warning {
  background: rgba(245, 158, 11, 0.14);
  color: #b45309;
}
.summary-chip.severity-info {
  background: rgba(37, 99, 235, 0.1);
  color: #1d4ed8;
}
.anomaly-list {
  list-style: none;
  margin: 10px 0 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.anomaly-item {
  padding: 10px 12px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border-color);
  background: rgba(248, 250, 252, 0.6);
  font-size: 0.8rem;
}
.anomaly-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}
.severity-badge {
  display: inline-block;
  padding: 1px 8px;
  border-radius: 999px;
  font-size: 0.72rem;
  font-weight: 600;
}
.severity-error {
  background: rgba(220, 38, 38, 0.14);
  color: #b42318;
}
.severity-warning {
  background: rgba(245, 158, 11, 0.16);
  color: #b45309;
}
.severity-info {
  background: rgba(37, 99, 235, 0.12);
  color: #1d4ed8;
}
.anomaly-code {
  font-family: monospace;
  font-size: 0.74rem;
  color: var(--text-secondary);
}
.anomaly-message {
  color: var(--text-primary);
}
.anomaly-links {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  margin-top: 6px;
}
.links-label {
  font-size: 0.72rem;
  color: var(--text-secondary);
}
.link-button {
  border: none;
  background: none;
  padding: 0;
  color: #2563eb;
  font-size: 0.76rem;
  cursor: pointer;
  word-break: break-all;
}
.link-button:hover {
  text-decoration: underline;
}
.evidence-link {
  opacity: 0.9;
}
.panel-muted {
  margin: 16px 0 0;
  font-size: 0.82rem;
  color: var(--text-secondary);
}
</style>
