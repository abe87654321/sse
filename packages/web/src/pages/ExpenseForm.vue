<template>
  <div class="expense-form-page">
    <div class="form-header">
      <button class="back-btn" @click="$router.back()">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 18 9 12 15 6"/></svg>
      </button>
      <h2 class="form-title font-heading">新建报销</h2>
    </div>

    <div class="form-body">
      <div class="card">
        <h3 class="card-title">基本信息</h3>
        <div class="form-grid">
          <div class="field">
            <label>标题</label>
            <el-input v-model="form.title" placeholder="请输入报销标题" size="large" />
          </div>
          <div class="field">
            <label>类别</label>
            <el-select v-model="form.category" placeholder="选择类别" size="large" style="width: 100%;">
              <el-option v-for="c in categories" :key="c" :label="c" :value="c" />
            </el-select>
          </div>
          <div class="field full">
            <label>说明</label>
            <el-input v-model="form.description" type="textarea" :rows="3" placeholder="补充说明..." />
          </div>
        </div>
      </div>

      <div class="card">
        <div class="card-title-row">
          <h3 class="card-title">费用明细</h3>
          <button class="btn-add-item" @click="addItem">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            添加
          </button>
        </div>

        <table class="items-table">
          <thead>
            <tr>
              <th>项目名称</th>
              <th style="width: 100px;">数量</th>
              <th style="width: 100px;">单位</th>
              <th style="width: 140px;">金额</th>
              <th style="width: 60px;"></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(item, i) in form.items" :key="i">
              <td><el-input v-model="item.name" placeholder="项目名称" size="default" /></td>
              <td><el-input v-model.number="item.quantity" type="number" size="default" /></td>
              <td><el-input v-model="item.unit" placeholder="单位" size="default" /></td>
              <td><el-input v-model.number="item.amount" type="number" size="default"><template #prefix>&yen;</template></el-input></td>
              <td>
                <button class="btn-remove" @click="removeItem(i)" :disabled="form.items.length <= 1">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                </button>
              </td>
            </tr>
          </tbody>
          <tfoot>
            <tr>
              <td colspan="3" class="text-right total-label">合计</td>
              <td class="text-right font-mono total-value">&yen;{{ totalAmount.toLocaleString() }}</td>
              <td></td>
            </tr>
          </tfoot>
        </table>
      </div>

      <div class="form-footer">
        <button class="btn-save" @click="handleSave('draft')">保存草稿</button>
        <button class="btn-submit" @click="handleSave('pending')">提交审批</button>
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

const totalAmount = computed(() => form.items.reduce((sum, item) => sum + (item.amount || 0) * (item.quantity || 1), 0))

function addItem() {
  form.items.push({ name: '', quantity: 1, unit: '个', amount: 0 })
}

function removeItem(index: number) {
  if (form.items.length > 1) form.items.splice(index, 1)
}

function handleSave(status: string) {
  // API call would go here
  router.push('/expenses')
}
</script>

<style scoped>
.form-header {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 24px;
}
.back-btn {
  width: 36px;
  height: 36px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  color: var(--text-muted);
  border-radius: var(--radius);
  transition: all var(--transition);
}
.back-btn:hover { background: rgba(255, 255, 255, 0.05); color: var(--text-primary); }
.form-title { font-size: 1.25rem; color: var(--text-primary); }

.form-body { max-width: 800px; display: flex; flex-direction: column; gap: 20px; }

.card {
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 24px;
}
.card-title {
  font-family: var(--font-heading);
  font-size: 1rem;
  font-weight: 400;
  color: var(--text-primary);
  margin-bottom: 16px;
  padding-bottom: 0;
}
.card-title-row { display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px; }

.btn-add-item {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 14px;
  background: transparent;
  border: 1px solid var(--border-light);
  color: var(--text-secondary);
  font-size: 0.8rem;
  border-radius: var(--radius);
  transition: all var(--transition);
}
.btn-add-item:hover { border-color: var(--accent-amber); color: var(--accent-amber); }

.form-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
.field { display: flex; flex-direction: column; gap: 6px; }
.field.full { grid-column: 1 / -1; }
.field label { font-size: 0.8rem; color: var(--text-muted); font-weight: 500; }

.form-body :deep(.el-input__wrapper),
.form-body :deep(.el-textarea__inner) {
  background: var(--bg-input) !important;
  border: 1px solid var(--border) !important;
  box-shadow: none !important;
  border-radius: var(--radius) !important;
}
.form-body :deep(.el-input__wrapper:hover),
.form-body :deep(.el-textarea__inner:hover) { border-color: var(--border-light) !important; }
.form-body :deep(.el-input__wrapper.is-focus),
.form-body :deep(.el-textarea__inner:focus) { border-color: var(--accent-amber) !important; }
.form-body :deep(.el-input__inner),
.form-body :deep(.el-textarea__inner) { color: var(--text-primary) !important; }
.form-body :deep(.el-input__inner::placeholder),
.form-body :deep(.el-textarea__inner::placeholder) { color: var(--text-muted) !important; }
.form-body :deep(.el-input__prefix) { color: var(--text-muted) !important; }

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
.items-table td { padding: 8px; border-bottom: 1px solid var(--border); }
.items-table tfoot td { border-bottom: none; border-top: 1px solid var(--border); padding-top: 14px; }
.text-right { text-align: right; }
.total-label { font-weight: 600; color: var(--text-primary); font-size: 0.9rem; }
.total-value { font-weight: 700; color: var(--accent-amber); font-size: 1.05rem; }

.btn-remove {
  width: 30px;
  height: 30px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  color: var(--text-muted);
  border-radius: var(--radius);
  transition: all var(--transition);
}
.btn-remove:hover { color: var(--accent-red); background: rgba(239, 68, 68, 0.1); }
.btn-remove:disabled { opacity: 0.3; cursor: not-allowed; }

.form-footer { display: flex; gap: 12px; justify-content: flex-end; }
.btn-save, .btn-submit {
  padding: 10px 28px;
  border-radius: var(--radius);
  font-size: 0.95rem;
  font-weight: 500;
  transition: all var(--transition);
}
.btn-save {
  background: transparent;
  border: 1px solid var(--border-light);
  color: var(--text-secondary);
}
.btn-save:hover { border-color: var(--text-muted); color: var(--text-primary); }
.btn-submit { background: var(--accent-amber); color: #0f1117; font-weight: 600; }
.btn-submit:hover { background: var(--accent-amber-dark); }
</style>
