<template>
  <section class="validation-panel card">
    <header class="panel-header">
      <div>
        <h3>报销校验</h3>
        <p>按金额与费用类别匹配审批规则，并给出可追溯的证据。</p>
      </div>
    </header>

    <form class="panel-form" @submit.prevent="runValidation">
      <label>
        金额
        <input v-model.number="amount" type="number" min="0" step="0.01" class="input-sm" placeholder="如 1200" />
      </label>
      <label>
        费用类别
        <input v-model="category" class="input-sm" placeholder="类别名称或 ID（可选）" />
      </label>
      <button type="submit" class="btn-primary btn-sm" :disabled="loading || !amount">
        {{ loading ? '校验中...' : '校验' }}
      </button>
    </form>

    <p v-if="error" class="panel-error">{{ error }}</p>

    <template v-if="result">
      <div class="result-summary">
        <span class="badge" :class="result.valid ? 'badge-valid' : 'badge-invalid'">
          {{ result.valid ? '通过' : '未通过' }}
        </span>
        <span v-if="result.category" class="result-meta">
          类别：{{ result.category.name }}（{{ result.category.id }}）
        </span>
        <span class="result-meta">来源：{{ result.source }}</span>
      </div>

      <div v-if="result.matched_rule" class="matched-rule">
        <h4>命中规则</h4>
        <p>
          <strong>{{ result.matched_rule.name || result.matched_rule.id }}</strong>
          <span class="rule-range">金额区间 {{ result.matched_rule.amount_range }}</span>
        </p>
        <p class="rule-meta">
          规则 ID：{{ result.matched_rule.id }} · 审批步骤 {{ result.matched_rule.approval_steps }}
        </p>
        <ol v-if="result.matched_rule.approval_chain.length > 0" class="chain-list">
          <li v-for="(step, index) in result.matched_rule.approval_chain" :key="index">
            第 {{ step.step ?? index + 1 }} 步：{{ step.label || step.role || '未知审批人' }}
          </li>
        </ol>
      </div>
      <p v-else class="panel-muted">未匹配到审批规则</p>

      <div v-if="result.issues.length > 0" class="issues">
        <h4>问题</h4>
        <ul>
          <li v-for="(issue, index) in result.issues" :key="`${issue.code}-${index}`">
            <span class="issue-code">{{ issue.code }}</span>
            <span class="issue-message">{{ issue.message }}</span>
            <span class="issue-evidence">
              <button
                v-for="(uri, evidenceIndex) in issue.evidence"
                :key="`${index}-${evidenceIndex}`"
                type="button"
                class="link-button"
                @click="emit('select', uri)"
              >
                {{ shortUri(uri) }}
              </button>
            </span>
          </li>
        </ul>
      </div>

      <div v-if="result.suggestions.length > 0" class="suggestions">
        <h4>建议</h4>
        <ul>
          <li v-for="(suggestion, index) in result.suggestions" :key="index">{{ suggestion }}</li>
        </ul>
      </div>
    </template>
  </section>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { ontologyApi, type ValidateResult } from '../../api/ontology'
import { localName } from './utils'

const emit = defineEmits<{
  (event: 'select', uri: string): void
}>()

const amount = ref<number | null>(null)
const category = ref('')
const loading = ref(false)
const error = ref<string | null>(null)
const result = ref<ValidateResult | null>(null)

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

async function runValidation(): Promise<void> {
  const value = Number(amount.value)
  if (!Number.isFinite(value) || value <= 0) {
    error.value = '请输入有效的金额'
    return
  }
  loading.value = true
  error.value = null
  try {
    const response = await ontologyApi.validate({
      amount: value,
      ...(category.value.trim() ? { category_name: category.value.trim() } : {}),
    })
    result.value = response.data
  } catch (err) {
    result.value = null
    error.value = errorMessage(err)
  } finally {
    loading.value = false
  }
}
</script>

<style scoped>
.validation-panel {
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
  min-width: 160px;
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
.result-summary {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
  margin-top: 16px;
}
.badge {
  display: inline-block;
  padding: 2px 10px;
  border-radius: 999px;
  font-size: 0.78rem;
  font-weight: 600;
}
.badge-valid {
  background: rgba(34, 197, 94, 0.15);
  color: #15803d;
}
.badge-invalid {
  background: rgba(220, 38, 38, 0.12);
  color: #b42318;
}
.result-meta {
  font-size: 0.78rem;
  color: var(--text-secondary);
}
.matched-rule,
.issues,
.suggestions {
  margin-top: 16px;
  font-size: 0.82rem;
}
.matched-rule h4,
.issues h4,
.suggestions h4 {
  margin: 0 0 6px;
  font-size: 0.82rem;
  color: var(--text-secondary);
}
.matched-rule p {
  margin: 0 0 4px;
}
.rule-range {
  margin-left: 8px;
  color: var(--text-secondary);
}
.rule-meta {
  color: var(--text-secondary);
  font-size: 0.76rem;
}
.chain-list {
  margin: 6px 0 0 18px;
  padding: 0;
  color: var(--text-secondary);
}
.issues ul,
.suggestions ul {
  margin: 0;
  padding-left: 18px;
}
.issues li,
.suggestions li {
  margin-bottom: 5px;
}
.issue-code {
  display: inline-block;
  margin-right: 6px;
  padding: 1px 7px;
  border-radius: 6px;
  background: rgba(232, 120, 176, 0.14);
  color: #a03a72;
  font-weight: 600;
  font-size: 0.72rem;
}
.issue-evidence {
  display: inline-flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-left: 6px;
}
.link-button {
  border: none;
  background: none;
  padding: 0;
  color: #2563eb;
  font-size: 0.76rem;
  cursor: pointer;
}
.link-button:hover {
  text-decoration: underline;
}
.panel-muted {
  margin: 16px 0 0;
  font-size: 0.82rem;
  color: var(--text-secondary);
}
</style>
