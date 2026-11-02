<template>
  <div class="card payment-card">
    <div class="payment-card-header">
      <h3 class="card-section-title font-heading">打款信息</h3>
      <div v-if="canManage" class="payment-card-actions">
        <button class="btn-secondary btn-sm" @click="$emit('edit')">修改打款信息</button>
        <button class="btn-danger btn-sm" @click="showRevert = true">撤销打款</button>
      </div>
    </div>

    <div class="payment-info-grid">
      <div class="payment-info-item">
        <span class="payment-label">打款时间</span>
        <span class="payment-value">{{ formatDate(report?.paidAt) }}</span>
      </div>
      <div class="payment-info-item">
        <span class="payment-label">打款人</span>
        <span class="payment-value">{{ report?.paidByName || '-' }}</span>
      </div>
      <div class="payment-info-item">
        <span class="payment-label">打款凭证号</span>
        <span class="payment-value">{{ report?.paymentRef || '-' }}</span>
      </div>
      <div class="payment-info-item full">
        <span class="payment-label">打款备注</span>
        <span class="payment-value">{{ report?.paymentComment || '无' }}</span>
      </div>
    </div>

    <div class="receipt-section">
      <h4>打款回单</h4>
      <div v-if="!receipts.length" class="receipt-empty">未上传打款回单</div>
      <div v-for="receipt in receipts" :key="receipt.id" class="receipt-item">
        <div class="receipt-head">
          <span class="receipt-file">📎 {{ receipt.fileName }}</span>
          <span class="receipt-status" :class="`status-${receipt.verificationStatus || 'pending'}`">
            {{ statusLabel(receipt.verificationStatus) }}
          </span>
        </div>
        <div class="receipt-meta">
          <span>上传时间：{{ formatDate(receipt.uploadedAt) }}</span>
          <span v-if="receipt.verifiedAt">核对时间：{{ formatDate(receipt.verifiedAt) }}</span>
        </div>

        <div v-if="isSuspicious(receipt)" class="receipt-alert">
          ⚠️ 该回单存在差异或未识别，请人工复核
        </div>

        <ul v-if="receipt.verificationResult?.checks?.length" class="receipt-checks">
          <li v-for="check in receipt.verificationResult.checks" :key="check.key" :class="{ fail: !check.ok }">
            {{ check.ok ? '✓' : '✗' }} {{ check.label }}<template v-if="check.message">：{{ check.message }}</template>
          </li>
        </ul>

        <div class="receipt-actions">
          <button class="table-link" @click="downloadReceipt(receipt.id)">下载</button>
          <button
            v-if="canManage"
            class="table-link"
            :disabled="verifying === receipt.id"
            @click="$emit('verify', receipt.id, false)"
          >{{ verifying === receipt.id ? '识别中...' : '重新识别' }}</button>
          <button
            v-if="canManage"
            class="table-link"
            :disabled="verifying === receipt.id"
            title="忽略缓存，重新调用 OCR 引擎"
            @click="$emit('verify', receipt.id, true)"
          >强制重新识别</button>
        </div>
      </div>
    </div>

    <div v-if="canManage && auditLogs.length" class="audit-section">
      <h4>打款操作记录</h4>
      <div v-for="log in auditLogs" :key="log.id" class="audit-item">
        <div class="audit-head">
          <span class="audit-action">{{ auditLabel(log.action) }}</span>
          <span class="audit-time">{{ formatDate(log.createdAt) }}</span>
        </div>
        <div class="audit-meta">
          <span v-if="log.operatorName">操作人：{{ log.operatorName }}</span>
          <span v-if="log.reason">原因：{{ log.reason }}</span>
        </div>
      </div>
    </div>

    <div v-if="showRevert" class="revert-overlay" @click.self="closeRevert">
      <div class="revert-dialog">
        <h3>撤销打款</h3>
        <p class="revert-hint">撤销后报销单回到「已通过」状态，打款信息将被清空，回单保留供审计。</p>
        <textarea v-model="revertReason" rows="3" placeholder="请填写撤销原因（必填）"></textarea>
        <p v-if="revertError" class="revert-error">{{ revertError }}</p>
        <div class="revert-actions">
          <button class="btn-secondary btn-sm" :disabled="reverting" @click="closeRevert">取消</button>
          <button class="btn-danger btn-sm" :disabled="reverting" @click="submitRevert">
            {{ reverting ? '提交中...' : '确认撤销' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import api from '../api/index'

const props = defineProps<{
  reportId: string
  report: any
  receipts: any[]
  auditLogs: any[]
  canManage: boolean
  verifying?: string
}>()

const emit = defineEmits<{
  edit: []
  revert: [reason: string]
  verify: [receiptId: string, force: boolean]
}>()

const showRevert = ref(false)
const revertReason = ref('')
const revertError = ref('')
const reverting = ref(false)

const statusLabels: Record<string, string> = {
  pending: '待核对',
  pass: '核对通过',
  warning: '存在差异',
  unverified: '未识别',
  error: '核对失败',
}

const auditLabels: Record<string, string> = {
  mark_paid: '确认打款',
  update_payment: '修改打款信息',
  revert_payment: '撤销打款',
}

function statusLabel(status?: string) {
  return statusLabels[status || 'pending'] || status || '待核对'
}

function auditLabel(action?: string) {
  return auditLabels[action || ''] || action || '-'
}

function isSuspicious(receipt: any) {
  return ['warning', 'unverified', 'error'].includes(receipt.verificationStatus)
}

function formatDate(value?: string) {
  if (!value) return '-'
  const date = new Date(value)
  if (isNaN(date.getTime())) return value
  const pad = (n: number) => n.toString().padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function closeRevert() {
  if (reverting.value) return
  showRevert.value = false
  revertReason.value = ''
  revertError.value = ''
}

function submitRevert() {
  if (!revertReason.value.trim()) {
    revertError.value = '请填写撤销原因'
    return
  }
  reverting.value = true
  revertError.value = ''
  emit('revert', revertReason.value.trim())
  setTimeout(() => {
    reverting.value = false
    showRevert.value = false
    revertReason.value = ''
  }, 300)
}

async function downloadReceipt(receiptId: string) {
  try {
    const res = await api.get(`/expenses/${props.reportId}/payment-receipts/${receiptId}/download`)
    window.open(res.data.url, '_blank')
  } catch (err: any) {
    alert(err?.response?.data?.error?.message || '下载失败')
  }
}
</script>

<style scoped>
.payment-card { margin-top: 0; }
.payment-card-header { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.payment-card-header .card-section-title { margin-bottom: 16px; }
.payment-card-actions { display: flex; gap: 8px; }
.payment-info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin-bottom: 18px; }
.payment-info-item { display: flex; flex-direction: column; gap: 4px; }
.payment-info-item.full { grid-column: 1 / -1; }
.payment-label { font-size: 0.76rem; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.04em; }
.payment-value { font-size: 0.9rem; color: var(--text-primary); }

.receipt-section { border-top: 1px solid var(--border-light); padding-top: 14px; }
.receipt-section h4, .audit-section h4 { font-size: 0.86rem; color: var(--text-secondary); margin-bottom: 10px; }
.receipt-empty { font-size: 0.84rem; color: var(--text-muted); }
.receipt-item { padding: 12px; border: 1px solid var(--border-light); border-radius: var(--radius-sm); margin-bottom: 10px; }
.receipt-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.receipt-file { font-size: 0.86rem; color: var(--text-primary); }
.receipt-status { font-size: 0.75rem; padding: 2px 8px; border-radius: 999px; background: var(--bg-warm); color: var(--text-secondary); }
.receipt-status.status-pass { background: rgba(64, 192, 87, 0.15); color: #2f9e44; }
.receipt-status.status-warning { background: rgba(255, 146, 43, 0.15); color: #d9480f; }
.receipt-status.status-unverified, .receipt-status.status-pending { background: var(--bg-warm); color: var(--text-muted); }
.receipt-status.status-error { background: rgba(229, 62, 62, 0.15); color: #c92a2a; }
.receipt-meta { display: flex; flex-wrap: wrap; gap: 12px; font-size: 0.76rem; color: var(--text-muted); margin-top: 6px; }
.receipt-alert { margin-top: 8px; padding: 8px 10px; border-radius: var(--radius-sm); background: rgba(255, 146, 43, 0.12); color: #d9480f; font-size: 0.8rem; }
.receipt-checks { margin: 8px 0 0; padding-left: 18px; font-size: 0.78rem; color: var(--text-secondary); }
.receipt-checks li.fail { color: #d9480f; }
.receipt-actions { display: flex; gap: 14px; margin-top: 10px; }
.receipt-actions .table-link { background: none; border: none; padding: 0; cursor: pointer; color: var(--accent-coral); font-size: 0.8rem; text-decoration: underline; }
.receipt-actions .table-link:disabled { opacity: 0.5; cursor: not-allowed; }

.audit-section { border-top: 1px solid var(--border-light); padding-top: 14px; margin-top: 14px; }
.audit-item { padding: 8px 0; border-bottom: 1px dashed var(--border-light); }
.audit-item:last-child { border-bottom: none; }
.audit-head { display: flex; justify-content: space-between; gap: 8px; font-size: 0.8rem; }
.audit-action { color: var(--text-primary); font-weight: 500; }
.audit-time { color: var(--text-muted); }
.audit-meta { display: flex; gap: 14px; font-size: 0.74rem; color: var(--text-muted); margin-top: 3px; }

.revert-overlay { position: fixed; inset: 0; background: rgba(45, 36, 32, 0.4); backdrop-filter: blur(4px); display: flex; align-items: center; justify-content: center; z-index: 400; }
.revert-dialog { background: var(--bg-card); border-radius: var(--radius-lg); padding: 24px; width: 420px; max-width: 92vw; }
.revert-dialog h3 { font-size: 1.05rem; margin-bottom: 8px; }
.revert-hint { font-size: 0.8rem; color: var(--text-muted); margin-bottom: 12px; }
.revert-dialog textarea { width: 100%; padding: 9px 10px; border: 1px solid var(--border); border-radius: var(--radius-sm); font-size: 0.88rem; resize: vertical; }
.revert-error { color: var(--danger, #e53e3e); font-size: 0.8rem; margin-top: 6px; }
.revert-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 14px; }
</style>
