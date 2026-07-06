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
          <div class="field">
            <label>标题 <span class="required">*</span></label>
            <input v-model="form.title" type="text" placeholder="请输入报销标题" />
          </div>
          <div class="field">
            <label>类别 <span class="required">*</span></label>
            <select v-model="form.category">
              <option value="">选择类别</option>
              <option v-for="c in categories" :key="c" :value="c">{{ c }}</option>
            </select>
          </div>
          <div class="field full">
            <label>说明</label>
            <textarea v-model="form.description" placeholder="补充说明..." rows="3"></textarea>
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
              <th>项目名称</th>
              <th style="width:90px;">数量</th>
              <th style="width:90px;">单位</th>
              <th style="width:130px;">金额</th>
              <th style="width:50px;"></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(item, i) in form.items" :key="i">
              <td><input v-model="item.name" type="text" placeholder="项目名称" /></td>
              <td><input v-model.number="item.quantity" type="number" min="0" /></td>
              <td><input v-model="item.unit" type="text" placeholder="例如：张" /></td>
              <td><input v-model.number="item.amount" type="number" min="0" step="0.01" placeholder="0.00" /></td>
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
              <td colspan="3" class="text-right total-label">合计</td>
              <td class="text-right total-value">&#165;{{ totalAmount.toLocaleString() }}</td>
              <td></td>
            </tr>
          </tfoot>
        </table>
      </div>

      <div class="form-footer">
        <button class="btn-secondary" @click="handleSave('draft')">保存草稿</button>
        <button class="btn-primary" @click="handleSave('pending')">提交审批</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { reactive, computed } from 'vue'
import { useRouter } from 'vue-router'

const router = useRouter()
const categories = ['差旅费', '办公费', '招待费', '交通费', '培训费', '通讯费', '其他']

const form = reactive({
  title: '',
  category: '',
  description: '',
  items: [{ name: '', quantity: 1, unit: '个', amount: 0 }]
})

const totalAmount = computed(() =>
  form.items.reduce((sum, item) => sum + (item.amount || 0) * (item.quantity || 1), 0)
)

function addItem() { form.items.push({ name: '', quantity: 1, unit: '个', amount: 0 }) }
function removeItem(index: number) { if (form.items.length > 1) form.items.splice(index, 1) }
function handleSave(_status: string) { router.push('/expenses') }
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
</style>
