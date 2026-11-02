<template>
  <div class="card verification-card">
    <div class="verification-header">
      <div>
        <h3 class="card-section-title font-heading">{{ title }}</h3>
        <p class="verification-subtitle">使用系统管理配置的 OCR 引擎识别发票并与填报金额核对</p>
      </div>
      <button
        v-if="canRun"
        class="btn-secondary btn-sm"
        :disabled="loading"
        @click="$emit('verify')"
      >{{ loading ? '核对中...' : '🔍 AI 核对' }}</button>
    </div>

    <div v-if="!summary" class="verification-empty">
      尚未核对。点击「AI 核对」检查发票金额、发票号与重复发票。
    </div>

    <template v-else>
      <div class="verification-status" :class="`status-${summary.status || 'pending'}`">
        <strong>{{ statusLabel(summary.status) }}</strong>
        <span>{{ summary.summary }}</span>
        <span v-if="summary.counts" class="verification-counts">
          共 {{ summary.counts.total }} 张 · 通过 {{ summary.counts.pass }} · 差异 {{ summary.counts.warning }} · 未核对 {{ summary.counts.unverified }}
        </span>
      </div>

      <div v-if="rows.length" class="verification-rows">
        <div v-for="row in rows" :key="row.invoiceId || row.id" class="verification-row">
          <div class="row-head">
            <span class="row-file">📎 {{ row.fileName || '发票' }}</span>
            <span class="row-badge" :class="`status-${row.status || 'pending'}`">{{ statusLabel(row.status) }}</span>
          </div>
          <div class="row-meta">
            <span v-if="row.invoiceNo">发票号：{{ row.invoiceNo }}</span>
            <span v-if="row.totalAmount !== undefined && row.totalAmount !== null">发票金额：¥{{ Number(row.totalAmount).toFixed(2) }}</span>
          </div>
          <ul v-if="row.checks?.length" class="row-checks">
            <li v-for="check in row.checks" :key="check.key" :class="{ fail: !check.ok }">
              {{ check.ok ? '✓' : '✗' }} {{ check.label }}<template v-if="check.message">：{{ check.message }}</template>
            </li>
          </ul>
          <p v-else-if="row.message" class="row-message">{{ row.message }}</p>
          <div v-if="row.duplicates?.length" class="row-duplicates">
            重复发票：
            <span v-for="dup in row.duplicates" :key="dup.invoiceId">
              {{ dup.restricted ? '其他报销单已使用' : `${dup.serialNo || dup.reportId}（${dup.status || '-'}）` }}
            </span>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'

interface PanelInvoice {
  invoiceId?: string
  id?: string
  itemId?: string
  fileName?: string
  invoiceNo?: string
  totalAmount?: number
  status?: string
  checks?: Array<{ key: string; label: string; ok: boolean; message?: string; severity?: string }>
  duplicates?: Array<{ invoiceId: string; reportId?: string; serialNo?: string; status?: string; restricted?: boolean }>
  message?: string
  verificationResult?: any
}

const props = withDefaults(defineProps<{
  summary?: any
  invoices?: PanelInvoice[]
  loading?: boolean
  canRun?: boolean
  title?: string
}>(), {
  summary: null,
  invoices: () => [],
  loading: false,
  canRun: true,
  title: 'AI 核对',
})

defineEmits<{ verify: [] }>()

const rows = computed<PanelInvoice[]>(() => {
  if (props.summary?.invoices?.length) return props.summary.invoices
  return props.invoices
    .filter((invoice) => invoice.verificationResult || invoice.status)
    .map((invoice) => ({
      ...invoice,
      invoiceId: invoice.invoiceId || invoice.id,
      status: invoice.status || invoice.verificationResult?.status,
      checks: invoice.checks || invoice.verificationResult?.checks || [],
      duplicates: invoice.duplicates || invoice.verificationResult?.duplicates || [],
      invoiceNo: invoice.invoiceNo || invoice.verificationResult?.ocr?.invoiceNo,
      totalAmount: invoice.totalAmount ?? invoice.verificationResult?.ocr?.totalAmount ?? invoice.verificationResult?.ocr?.amount,
      message: invoice.message || invoice.verificationResult?.summary,
    }))
})

const statusLabels: Record<string, string> = {
  pass: '✅ 核对通过',
  warning: '⚠️ 存在差异',
  unverified: '⚪ 未核对',
  pending: '⚪ 未核对',
  no_invoices: '— 无发票',
  error: '❌ 核对失败',
}

function statusLabel(status?: string) {
  return statusLabels[status || 'pending'] || status || '未核对'
}
</script>

<style scoped>
.verification-card { display: flex; flex-direction: column; gap: 14px; }
.verification-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
.verification-header .card-section-title { margin-bottom: 4px; padding-bottom: 0; border-bottom: none; }
.verification-subtitle { font-size: 0.8rem; color: var(--text-muted); }
.verification-empty { color: var(--text-muted); font-size: 0.85rem; }
.verification-status {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
  padding: 10px 14px;
  border-radius: var(--radius-sm);
  font-size: 0.85rem;
  background: var(--bg-warm);
  color: var(--text-secondary);
}
.verification-status.status-pass { background: var(--accent-mint-bg); color: #2b7a3d; }
.verification-status.status-warning { background: var(--accent-coral-bg); color: var(--accent-coral); }
.verification-status.status-error { background: var(--accent-coral-bg); color: var(--accent-coral); }
.verification-status.status-unverified,
.verification-status.status-pending,
.verification-status.status-no_invoices { background: var(--bg-warm); color: var(--text-secondary); }
.verification-counts { margin-left: auto; font-size: 0.78rem; color: var(--text-muted); }
.verification-rows { display: flex; flex-direction: column; gap: 10px; }
.verification-row { border: 1px solid var(--border-light); border-radius: var(--radius-sm); padding: 10px 12px; }
.row-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.row-file { font-size: 0.85rem; color: var(--text-primary); }
.row-badge { font-size: 0.78rem; }
.row-badge.status-pass { color: #2b7a3d; }
.row-badge.status-warning,
.row-badge.status-error { color: var(--accent-coral); }
.row-meta { display: flex; flex-wrap: wrap; gap: 14px; margin-top: 6px; font-size: 0.8rem; color: var(--text-secondary); }
.row-checks { margin: 8px 0 0; padding-left: 18px; font-size: 0.8rem; color: var(--text-secondary); }
.row-checks li.fail { color: var(--accent-coral); }
.row-message { margin: 8px 0 0; font-size: 0.8rem; color: var(--text-muted); }
.row-duplicates { margin-top: 8px; font-size: 0.78rem; color: var(--accent-coral); display: flex; flex-wrap: wrap; gap: 8px; }
</style>
