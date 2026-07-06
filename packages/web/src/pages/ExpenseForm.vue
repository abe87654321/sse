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
</style>
