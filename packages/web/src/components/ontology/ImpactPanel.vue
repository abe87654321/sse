<template>
  <section class="impact-panel card">
    <header class="panel-header">
      <div>
        <h3>影响分析</h3>
        <p>模拟规则、类别、部门或金额变化会影响到哪些报销单与人员。</p>
      </div>
    </header>

    <form class="panel-form" @submit.prevent="runImpact">
      <label>
        规则 ID
        <input v-model="ruleId" class="input-sm" placeholder="如 rule-1（可选）" />
      </label>
      <label>
        费用类别
        <select v-model="categoryId" class="input-sm">
          <option value="">全部类别</option>
          <option v-for="category in categories" :key="category.id" :value="category.id">
            {{ category.name }}（{{ category.id }}）
          </option>
        </select>
      </label>
      <label>
        部门
        <input v-model="department" class="input-sm" placeholder="如 研发（可选）" />
      </label>
      <label>
        金额变化
        <input v-model.number="amountDelta" type="number" step="0.01" class="input-sm" placeholder="如 100 或 -50" />
      </label>
      <button type="submit" class="btn-primary btn-sm" :disabled="loading">
        {{ loading ? '分析中...' : '分析' }}
      </button>
    </form>

    <p v-if="error" class="panel-error">{{ error }}</p>

    <template v-if="result">
      <div class="count-grid">
        <div class="count-card">
          <span class="count-value">{{ result.counts.reports }}</span>
          <span class="count-label">受影响报销单</span>
        </div>
        <div class="count-card">
          <span class="count-value">{{ result.counts.people }}</span>
          <span class="count-label">受影响人员</span>
        </div>
        <div class="count-card">
          <span class="count-value">{{ result.counts.pending }}</span>
          <span class="count-label">待审批</span>
        </div>
        <div class="count-card" :class="{ hypothetical: result.hypothetical }">
          <span class="count-value">{{ result.hypothetical ? '模拟' : '现状' }}</span>
          <span class="count-label">结果类型</span>
        </div>
      </div>

      <div class="result-block">
        <h4>受影响报销单</h4>
        <div v-if="result.affected_reports.length === 0" class="panel-muted">没有匹配的报销单</div>
        <table v-else class="result-table">
          <thead>
            <tr>
              <th>单号</th>
              <th>金额</th>
              <th>状态</th>
              <th>原因</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="report in result.affected_reports" :key="report.uri">
              <td>
                <button type="button" class="link-button" @click="emit('select', report.uri)">
                  {{ report.serialNo || shortUri(report.uri) }}
                </button>
              </td>
              <td class="numeric">{{ report.amount }}</td>
              <td>{{ report.status }}</td>
              <td class="reason">{{ report.reason }}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div class="result-block">
        <h4>受影响人员</h4>
        <div v-if="result.affected_people.length === 0" class="panel-muted">没有匹配的人员</div>
        <table v-else class="result-table">
          <thead>
            <tr>
              <th>姓名</th>
              <th>部门</th>
              <th>URI</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="person in result.affected_people" :key="person.uri">
              <td>{{ person.name }}</td>
              <td>{{ person.department }}</td>
              <td>
                <button type="button" class="link-button" @click="emit('select', person.uri)">
                  {{ shortUri(person.uri) }}
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>
  </section>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { ontologyApi, type ImpactResult } from '../../api/ontology'
import { localName } from './utils'

interface CategoryOption {
  id: string
  name: string
}

const emit = defineEmits<{
  (event: 'select', uri: string): void
}>()

const ruleId = ref('')
const categoryId = ref('')
const department = ref('')
const amountDelta = ref<number | null>(null)
const categories = ref<CategoryOption[]>([])
const loading = ref(false)
const error = ref<string | null>(null)
const result = ref<ImpactResult | null>(null)

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

function categoryIdFromUri(uri: string): string {
  return localName(uri)
}

async function loadCategories(): Promise<void> {
  try {
    const response = await ontologyApi.entities({ type: 'ExpenseCategory' })
    const payload = response.data as unknown
    const rows = Array.isArray(payload)
      ? payload
      : ((payload as { results?: unknown[] })?.results ?? [])
    categories.value = (rows as Array<{ uri?: string; properties?: Record<string, string> }>)
      .map((row) => {
        const uri = row.uri ?? ''
        return {
          id: categoryIdFromUri(uri),
          name: row.properties?.name || categoryIdFromUri(uri),
        }
      })
      .filter((category) => !!category.id)
  } catch {
    categories.value = []
  }
}

async function runImpact(): Promise<void> {
  loading.value = true
  error.value = null
  try {
    const body: Record<string, unknown> = {}
    if (ruleId.value.trim()) body.rule_id = ruleId.value.trim()
    if (categoryId.value) body.category_id = categoryId.value
    if (department.value.trim()) body.department = department.value.trim()
    if (amountDelta.value !== null && Number.isFinite(amountDelta.value)) {
      body.amount_delta = amountDelta.value
    }
    const response = await ontologyApi.impact(body)
    result.value = response.data
  } catch (err) {
    result.value = null
    error.value = errorMessage(err)
  } finally {
    loading.value = false
  }
}

onMounted(() => {
  void loadCategories()
})
</script>

<style scoped>
.impact-panel {
  padding: 18px 20px;
}
.panel-header h3 {
  margin: 0 0 4px;
  font-size: 1rem;
  color: var(--text-primary);
}
.panel-header p {
  margin: 0 0 14px;
  font-size: 0.82rem;
  color: var(--text-secondary);
}
.panel-form {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  align-items: flex-end;
}
.panel-form label {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 0.78rem;
  color: var(--text-secondary);
}
.panel-form .input-sm {
  height: 32px;
  min-width: 150px;
  font-size: 0.82rem;
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
.count-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(130px, 1fr));
  gap: 10px;
  margin-top: 16px;
}
.count-card {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 10px 12px;
  border-radius: var(--radius-sm);
  background: rgba(72, 184, 168, 0.08);
  border: 1px solid rgba(72, 184, 168, 0.2);
}
.count-card.hypothetical {
  background: rgba(245, 158, 11, 0.1);
  border-color: rgba(245, 158, 11, 0.3);
}
.count-value {
  font-size: 1.2rem;
  font-weight: 700;
  color: var(--text-primary);
}
.count-label {
  font-size: 0.74rem;
  color: var(--text-secondary);
}
.result-block {
  margin-top: 18px;
}
.result-block h4 {
  margin: 0 0 6px;
  font-size: 0.82rem;
  color: var(--text-secondary);
}
.result-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.8rem;
}
.result-table th,
.result-table td {
  text-align: left;
  padding: 6px 8px;
  border-bottom: 1px solid var(--border-color);
  vertical-align: top;
}
.result-table th {
  color: var(--text-secondary);
  font-weight: 600;
  font-size: 0.74rem;
}
.result-table .numeric {
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.result-table .reason {
  color: var(--text-secondary);
}
.link-button {
  border: none;
  background: none;
  padding: 0;
  color: #2563eb;
  font-size: inherit;
  cursor: pointer;
  text-align: left;
}
.link-button:hover {
  text-decoration: underline;
}
.panel-muted {
  margin: 0;
  font-size: 0.82rem;
  color: var(--text-secondary);
}
</style>
