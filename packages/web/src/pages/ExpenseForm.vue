<template>
  <div class="expense-form-page">
    <div class="page-header">
      <button class="btn-icon" @click="$router.back()">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="15 18 9 12 15 6"/>
        </svg>
      </button>
      <h2 class="page-header-title">新建报销</h2>
    </div>

    <div class="form-body">
      <div class="card ai-card">
        <div class="ai-card-header" @click="showAI = !showAI">
          <div class="ai-label">
            <span class="ai-icon">🤖</span>
            <span class="font-heading">AI 智能填单</span>
            <span class="ai-badge">Beta</span>
          </div>
          <svg class="ai-arrow" :class="{ open: showAI }" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="6 9 12 15 18 9"/>
          </svg>
        </div>
        <div v-show="showAI" class="ai-card-body">
          <p class="ai-hint">粘贴截图、发票照片或文字描述，AI 自动识别费用明细</p>
          <div class="ai-input-row">
            <textarea
              v-model="aiInput"
              placeholder="例如：打车去机场85元，酒店两晚600&#10;或直接 Ctrl+V 粘贴截图"
              rows="3"
              @paste="handlePaste"
            ></textarea>
          </div>
          <button class="btn-ai" @click="handleAIParse" :disabled="aiLoading || !aiInput.trim()">
            <template v-if="aiLoading">
              <span class="spinner"></span> AI 识别中...
            </template>
            <template v-else>
              ✨ AI 识别
            </template>
          </button>
          <div v-if="aiResult.length > 0" class="ai-result">
            <p class="ai-result-title">识别结果（可修改后确认）</p>
            <div v-for="(item, i) in aiResult" :key="i" class="ai-result-item">
              <select v-model="item.categoryName">
                <option v-for="c in categories" :key="c.id" :value="c.name">{{ c.name }}</option>
              </select>
              <input v-model.number="item.amount" type="number" min="0" step="0.01" />
              <input v-model="item.expenseDate" type="date" />
              <input v-model="item.description" type="text" placeholder="说明" />
              <button class="btn-remove" @click="aiResult.splice(i, 1)">✕</button>
            </div>
            <div class="ai-result-actions">
              <button class="btn-secondary btn-sm" @click="aiInput=''; aiResult=[]">清空</button>
              <button class="btn-primary btn-sm" @click="applyAIResult">✅ 填入表单</button>
            </div>
          </div>
        </div>
      </div>

      <div class="card">
        <h3 class="form-section-title font-heading">基本信息</h3>
        <div class="form-grid">
          <div class="field full">
            <label>标题 <span class="required">*</span></label>
            <input v-model="form.title" type="text" placeholder="例如：6月出差报销" />
          </div>
        </div>
      </div>

      <div class="card">
        <div class="section-title-row">
          <h3 class="form-section-title font-heading">费用明细</h3>
          <button class="btn-secondary btn-sm" @click="addItem">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
              <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
            </svg>
            添加
          </button>
        </div>

        <table class="items-table">
          <thead>
            <tr>
              <th>类别</th>
              <th>日期</th>
              <th>金额</th>
              <th>说明</th>
              <th style="width:50px;"></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(item, i) in form.items" :key="i">
              <td>
                <select v-model="item.categoryId">
                  <option value="">选择类别</option>
                  <option v-for="c in categories" :key="c.id" :value="c.id">{{ c.name }}</option>
                </select>
              </td>
              <td><input v-model="item.expenseDate" type="date" /></td>
              <td><input v-model.number="item.amount" type="number" min="0" step="0.01" placeholder="0.00" /></td>
              <td><input v-model="item.description" type="text" placeholder="用途说明" /></td>
              <td>
                <button class="btn-remove" @click="removeItem(i)" :disabled="form.items.length <= 1">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                  </svg>
                </button>
              </td>
            </tr>
          </tbody>
          <tfoot>
            <tr>
              <td colspan="2" class="text-right total-label">合计</td>
              <td class="text-right total-value">&yen;{{ totalAmount.toFixed(2) }}</td>
              <td colspan="2"></td>
            </tr>
          </tfoot>
        </table>
      </div>

      <div v-if="error" class="error-msg">{{ error }}</div>

      <div class="form-footer">
        <button class="btn-secondary" @click="handleSave" :disabled="saving">保存草稿</button>
        <button class="btn-primary" @click="handleSubmit" :disabled="saving">{{ saving ? '提交中...' : '提交审批' }}</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { reactive, computed, ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import api from '../api/index'

const router = useRouter()
const saving = ref(false)
const error = ref('')

const showAI = ref(false)
const aiInput = ref('')
const aiLoading = ref(false)
const aiResult = ref<Array<{ categoryName: string; amount: number; expenseDate: string; description: string }>>([])

interface Category { id: string; name: string }
const categories = ref<Category[]>([])

const form = reactive({
  title: '',
  items: [{ categoryId: '', amount: 0, expenseDate: new Date().toISOString().slice(0, 10), description: '' } as {
    categoryId: string; amount: number; expenseDate: string; description: string
  }]
})

const totalAmount = computed(() =>
  form.items.reduce((sum, item) => sum + (item.amount || 0), 0)
)

function handlePaste(e: ClipboardEvent) {
  const items = e.clipboardData?.items
  if (items) {
    for (const item of items) {
      if (item.type.startsWith('image/')) {
        const blob = item.getAsFile()
        if (blob) {
          const reader = new FileReader()
          reader.onload = () => {
            aiInput.value = reader.result as string
          }
          reader.readAsDataURL(blob)
        }
        break
      }
    }
  }
}

async function handleAIParse() {
  if (!aiInput.value.trim()) return
  aiLoading.value = true
  try {
    const isBase64 = aiInput.value.startsWith('data:image')
    const payload = isBase64 ? { image: aiInput.value } : { text: aiInput.value }
    const res = await api.post('/ai/parse', payload)
    aiResult.value = res.data.items || []
  } catch (e: any) {
    error.value = e?.response?.data?.error?.message || 'AI 识别失败，请重试'
  } finally {
    aiLoading.value = false
  }
}

function applyAIResult() {
  form.items = aiResult.value.map(item => {
    const cat = categories.value.find(c => c.name === item.categoryName)
    return {
      categoryId: cat?.id || 'c0000000-0000-0000-0000-000000000008',
      amount: item.amount,
      expenseDate: item.expenseDate,
      description: item.description
    }
  })
  aiResult.value = []
  aiInput.value = ''
  showAI.value = false
}

onMounted(async () => {
  try {
    const res = await api.get('/admin/categories')
    categories.value = res.data || []
  } catch { /* use defaults below */ }
  if (categories.value.length === 0) {
    categories.value = [
      { id: 'c0000000-0000-0000-0000-000000000001', name: '交通' },
      { id: 'c0000000-0000-0000-0000-000000000002', name: '住宿' },
      { id: 'c0000000-0000-0000-0000-000000000003', name: '餐饮' },
      { id: 'c0000000-0000-0000-0000-000000000004', name: '招待' },
      { id: 'c0000000-0000-0000-0000-000000000005', name: '办公用品' },
      { id: 'c0000000-0000-0000-0000-000000000006', name: '通讯' },
      { id: 'c0000000-0000-0000-0000-000000000007', name: '培训' },
      { id: 'c0000000-0000-0000-0000-000000000008', name: '其他' },
    ]
  }
})

function addItem() {
  form.items.push({ categoryId: '', amount: 0, expenseDate: new Date().toISOString().slice(0, 10), description: '' })
}
function removeItem(index: number) { if (form.items.length > 1) form.items.splice(index, 1) }

async function handleSave() {
  error.value = ''
  if (!form.title.trim()) { error.value = '请输入标题'; return }

  const validItems = form.items.filter(i => i.categoryId && i.amount > 0)
  if (validItems.length === 0) { error.value = '请至少填写一条费用明细'; return }

  saving.value = true
  try {
    // 保存为草稿：先创建（自动提交），后续需加草稿模式
    // 当前提交给 API
    await api.post('/expenses', {
      title: form.title.trim(),
      items: validItems.map(i => ({
        categoryId: i.categoryId,
        amount: i.amount,
        expenseDate: i.expenseDate,
        description: i.description || ''
      }))
    })
    router.push('/expenses')
  } catch (e: any) {
    error.value = e?.response?.data?.error?.message || e?.message || '保存失败'
  } finally {
    saving.value = false
  }
}

async function handleSubmit() {
  error.value = ''
  if (!form.title.trim()) { error.value = '请输入标题'; return }

  const validItems = form.items.filter(i => i.categoryId && i.amount > 0)
  if (validItems.length === 0) { error.value = '请至少填写一条费用明细'; return }

  saving.value = true
  try {
    await api.post('/expenses', {
      title: form.title.trim(),
      items: validItems.map(i => ({
        categoryId: i.categoryId,
        amount: i.amount,
        expenseDate: i.expenseDate,
        description: i.description || ''
      }))
    })
    router.push('/expenses')
  } catch (e: any) {
    error.value = e?.response?.data?.error?.message || e?.message || '提交失败'
  } finally {
    saving.value = false
  }
}
</script>

<style scoped>
.form-body { max-width: 800px; display: flex; flex-direction: column; gap: 20px; }

.form-section-title {
  font-size: 1.05rem;
  color: var(--text-primary);
  letter-spacing: 0.03em;
  margin-bottom: 18px;
  padding-bottom: 12px;
  border-bottom: 1px solid var(--border-light);
}

.section-title-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 4px;
}
.section-title-row .form-section-title { margin-bottom: 0; padding-bottom: 16px; flex: 1; }

.form-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 18px; }
.field.full { grid-column: 1 / -1; }
.required { color: var(--accent-coral); }

.items-table { width: 100%; border-collapse: collapse; }
.items-table th {
  padding: 10px 8px;
  font-size: 0.75rem;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  text-align: left;
  border-bottom: 1px solid var(--border);
}
.items-table td { padding: 8px; border-bottom: 1px solid var(--border-light); }
.items-table tbody tr:last-child td { border-bottom: none; }
.items-table tfoot tr td { border-top: 2px solid var(--border); padding-top: 14px; font-size: 0.9rem; }
.total-label { font-weight: 600; color: var(--text-primary); }
.total-value { font-weight: 700; color: var(--accent-coral); font-size: 1.1rem; }

.items-table select {
  width: 100%;
  padding: 8px 10px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--bg-input);
  color: var(--text-primary);
  font-family: var(--font-body);
  font-size: 13px;
}
.items-table input {
  width: 100%;
  padding: 8px 10px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--bg-input);
  color: var(--text-primary);
  font-family: var(--font-body);
  font-size: 13px;
}

.btn-remove {
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  color: var(--text-muted);
  border-radius: var(--radius-sm);
  transition: all var(--transition);
}
.btn-remove:hover { color: var(--accent-coral); background: var(--accent-coral-bg); }
.btn-remove:disabled { opacity: 0.3; cursor: not-allowed; }

.form-footer { display: flex; gap: 12px; justify-content: flex-end; padding-top: 8px; }

.error-msg {
  color: var(--accent-coral);
  background: var(--accent-coral-bg);
  padding: 10px 16px;
  border-radius: var(--radius-sm);
  font-size: 0.875rem;
}

/* AI Card */
.ai-card { border: 1px dashed var(--accent-orange); background: var(--accent-orange-bg); }
.ai-card-header { display: flex; align-items: center; justify-content: space-between; cursor: pointer; padding: 4px 0; }
.ai-label { display: flex; align-items: center; gap: 8px; }
.ai-icon { font-size: 1.3rem; }
.ai-badge { font-size: 0.7rem; background: var(--accent-orange); color: #fff; padding: 2px 8px; border-radius: 10px; }
.ai-arrow { transition: transform 0.2s; color: var(--text-secondary); }
.ai-arrow.open { transform: rotate(180deg); }
.ai-card-body { margin-top: 12px; }
.ai-hint { font-size: 0.825rem; color: var(--text-secondary); margin-bottom: 10px; }
.ai-input-row textarea {
  width: 100%;
  padding: 12px;
  border: 1px solid var(--accent-orange);
  border-radius: var(--radius-sm);
  background: var(--bg-card);
  color: var(--text-primary);
  font-family: var(--font-body);
  font-size: 0.9rem;
  resize: vertical;
}
.btn-ai {
  margin-top: 10px;
  padding: 10px 24px;
  background: linear-gradient(135deg, var(--accent-orange), var(--accent-coral));
  color: #fff;
  border: none;
  border-radius: var(--radius-full);
  font-family: var(--font-body);
  font-size: 0.9rem;
  font-weight: 600;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  transition: opacity 0.2s;
}
.btn-ai:disabled { opacity: 0.5; cursor: not-allowed; }
.btn-ai:hover:not(:disabled) { opacity: 0.9; }

.spinner {
  width: 14px; height: 14px;
  border: 2px solid rgba(255,255,255,0.3);
  border-top-color: #fff;
  border-radius: 50%;
  animation: spin 0.6s linear infinite;
}
@keyframes spin { to { transform: rotate(360deg); } }

.ai-result { margin-top: 16px; padding-top: 14px; border-top: 1px solid var(--border); }
.ai-result-title { font-size: 0.8rem; color: var(--text-muted); margin-bottom: 10px; }
.ai-result-item {
  display: flex;
  gap: 6px;
  margin-bottom: 6px;
  align-items: center;
}
.ai-result-item select,
.ai-result-item input {
  padding: 6px 8px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--bg-card);
  color: var(--text-primary);
  font-family: var(--font-body);
  font-size: 0.82rem;
  flex: 1;
}
.ai-result-item input[type="number"] { flex: 0 0 90px; }
.ai-result-item input[type="date"] { flex: 0 0 130px; }
.ai-result-actions { display: flex; gap: 8px; justify-content: flex-end; margin-top: 10px; }


.error-msg {
  color: var(--accent-coral);
  background: var(--accent-coral-bg);
  padding: 10px 16px;
  border-radius: var(--radius-sm);
  font-size: 0.875rem;
}
</style>
