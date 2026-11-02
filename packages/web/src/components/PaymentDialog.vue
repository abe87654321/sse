<template>
  <div v-if="modelValue" class="payment-overlay" @click.self="close">
    <div class="payment-dialog">
      <h3>{{ mode === 'edit' ? '修改打款信息' : '确认打款' }}</h3>
      <p class="payment-hint">打款凭证号与打款回单至少填写一项。</p>

      <label class="payment-field">
        <span>打款凭证号</span>
        <input v-model="paymentRef" type="text" maxlength="100" placeholder="银行流水号 / 付款单号" />
      </label>

      <label class="payment-field">
        <span>打款备注</span>
        <textarea v-model="paymentComment" rows="2" placeholder="如：已转至张三工行尾号1872"></textarea>
      </label>

      <label class="payment-field">
        <span>打款回单{{ hasReceipt ? '（重新上传将替换原回单）' : '' }}</span>
        <input type="file" accept=".pdf,.png,.jpg,.jpeg" @change="onFileChange" />
      </label>

      <label v-if="mode === 'edit'" class="payment-field">
        <span>修改原因 <em>*</em></span>
        <input v-model="reason" type="text" placeholder="请填写修改原因" />
      </label>

      <p v-if="error" class="payment-error">{{ error }}</p>

      <div class="payment-actions">
        <button class="btn-secondary btn-sm" :disabled="submitting" @click="close">取消</button>
        <button class="btn-primary btn-sm" :disabled="submitting" @click="submit">
          {{ submitting ? '提交中...' : (mode === 'edit' ? '保存修改' : '确认打款') }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import api from '../api/index'

const props = withDefaults(defineProps<{
  modelValue: boolean
  reportId: string
  mode?: 'pay' | 'edit'
  initialRef?: string
  initialComment?: string
  hasReceipt?: boolean
}>(), {
  mode: 'pay',
  initialRef: '',
  initialComment: '',
  hasReceipt: false,
})

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  success: []
}>()

const paymentRef = ref('')
const paymentComment = ref('')
const reason = ref('')
const receiptFile = ref<File | null>(null)
const submitting = ref(false)
const error = ref('')

watch(() => props.modelValue, (open) => {
  if (!open) return
  paymentRef.value = props.initialRef || ''
  paymentComment.value = props.initialComment || ''
  reason.value = ''
  receiptFile.value = null
  error.value = ''
})

function close() {
  if (submitting.value) return
  emit('update:modelValue', false)
}

function onFileChange(event: Event) {
  const input = event.target as HTMLInputElement
  receiptFile.value = input.files?.[0] ?? null
}

async function uploadReceipt(): Promise<string | undefined> {
  if (!receiptFile.value) return undefined
  const form = new FormData()
  form.append('file', receiptFile.value)
  const res = await api.post(`/expenses/${props.reportId}/payment-receipts`, form, { timeout: 60000 })
  return res.data?.id
}

async function submit() {
  if (submitting.value) return
  error.value = ''

  const refValue = paymentRef.value.trim()
  const commentValue = paymentComment.value.trim()
  const hasExistingReceipt = props.hasReceipt

  if (!refValue && !receiptFile.value && !hasExistingReceipt) {
    error.value = '请填写打款凭证号或上传打款回单'
    return
  }

  if (props.mode === 'edit' && !reason.value.trim()) {
    error.value = '请填写修改原因'
    return
  }

  submitting.value = true
  try {
    const receiptId = await uploadReceipt()

    if (props.mode === 'edit') {
      await api.put(`/expenses/${props.reportId}/payment`, {
        paymentRef: refValue,
        paymentComment: commentValue,
        reason: reason.value.trim(),
      })
    } else {
      await api.post(`/expenses/${props.reportId}/pay`, {
        paymentRef: refValue || undefined,
        paymentComment: commentValue || undefined,
        receiptId,
      })
    }

    emit('success')
    emit('update:modelValue', false)
  } catch (err: any) {
    error.value = err?.response?.data?.error?.message || err?.message || '提交失败'
  } finally {
    submitting.value = false
  }
}
</script>

<style scoped>
.payment-overlay {
  position: fixed;
  inset: 0;
  background: rgba(45, 36, 32, 0.4);
  backdrop-filter: blur(4px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 300;
}
.payment-dialog {
  background: var(--bg-card);
  border-radius: var(--radius-lg);
  padding: 24px;
  width: 440px;
  max-width: 92vw;
}
.payment-dialog h3 { font-size: 1.1rem; margin-bottom: 6px; color: var(--text-primary); }
.payment-hint { font-size: 0.8rem; color: var(--text-muted); margin-bottom: 14px; }
.payment-field { display: flex; flex-direction: column; gap: 6px; margin-bottom: 12px; }
.payment-field span { font-size: 0.8rem; color: var(--text-secondary); }
.payment-field em { color: var(--danger, #e53e3e); font-style: normal; }
.payment-field input,
.payment-field textarea {
  width: 100%;
  padding: 9px 10px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  font-size: 0.88rem;
  resize: vertical;
}
.payment-error { color: var(--danger, #e53e3e); font-size: 0.82rem; margin-bottom: 8px; }
.payment-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 18px; }
</style>
