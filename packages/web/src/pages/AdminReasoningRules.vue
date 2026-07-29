<template>
  <div class="admin-reasoning-page">
    <div class="page-header"><h2 class="page-header-title">推理规则管理</h2></div>
    <div class="toolbar">
      <div class="toolbar-spacer"></div>
      <button class="btn-primary" @click="openCreate"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>新建规则</button>
    </div>
    <div class="table-wrap">
      <table class="data-table">
        <thead><tr><th>名称</th><th>说明</th><th>优先级</th><th>启用</th><th>操作</th></tr></thead>
        <tbody>
          <tr v-for="r in rules" :key="r.id">
            <td>{{ r.name }}</td><td class="text-secondary">{{ r.description || '-' }}</td>
            <td>{{ r.priority }}</td>
            <td>{{ r.isActive ? '✔' : '—' }}</td>
            <td class="col-action"><span class="table-link" @click="openEdit(r)">编辑</span><span class="table-link" style="color:var(--danger, #e53e3e);margin-left:8px" @click="handleDelete(r)">删除</span></td>
          </tr>
          <tr v-if="rules.length === 0"><td colspan="5"><div class="empty-state">暂无推理规则</div></td></tr>
        </tbody>
      </table>
    </div>
    <Teleport to="body"><div v-if="showModal" class="modal-overlay" @click.self="closeModal">
      <div class="modal"><div class="modal-header"><h3 class="modal-title font-heading">{{ isEdit ? '编辑' : '新建' }}推理规则</h3><button class="modal-close" @click="closeModal"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button></div>
        <form class="modal-body" @submit.prevent="save">
          <div class="field"><label>名称 <span class="required">*</span></label><input v-model="form.name" required maxlength="100"/></div>
          <div class="field"><label>说明</label><input v-model="form.description"/></div>
          <div class="field"><label>条件 (JSON) <span class="required">*</span></label><textarea v-model="conditionsStr" rows="6"></textarea></div>
          <div class="field"><label>结论 (JSON) <span class="required">*</span></label><textarea v-model="conclusionStr" rows="3"></textarea></div>
          <div class="field"><label>优先级</label><input v-model.number="form.priority" type="number" min="0"/></div>
          <div class="field"><label style="display:flex;align-items:center;gap:8px;cursor:pointer"><input type="checkbox" v-model="form.isActive"/> 启用</label></div>
          <div class="modal-actions"><button type="button" class="btn-secondary" @click="closeModal">取消</button><button type="submit" class="btn-primary">保存</button></div>
        </form>
      </div>
    </div></Teleport>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue'
import api from '../api/index'

const rules = ref<any[]>([])
const showModal = ref(false)
const isEdit = ref(false)
const editId = ref('')
const form = reactive({ name: '', description: '', priority: 0, isActive: true })
const conditionsStr = ref('')
const conclusionStr = ref('')

onMounted(async () => {
  try { const r = await api.get('/admin/reasoning-rules'); rules.value = r.data || [] } catch {}
})

function openCreate() {
  isEdit.value = false; editId.value = ''; form.name = ''; form.description = ''; form.priority = 0; form.isActive = true
  conditionsStr.value = '[{"subject":"?p","predicate":"sse:belongsTo","object":"?d"}]'
  conclusionStr.value = '{"subject":"?p","predicate":"sse:worksFor","object":"?c"}'
  showModal.value = true
}
function openEdit(r: any) {
  isEdit.value = true; editId.value = r.id; form.name = r.name; form.description = r.description || ''; form.priority = r.priority; form.isActive = r.isActive
  conditionsStr.value = JSON.stringify(r.conditions, null, 2)
  conclusionStr.value = JSON.stringify(r.conclusion, null, 2)
  showModal.value = true
}
function closeModal() { showModal.value = false }

async function save() {
  let conditions: any, conclusion: any
  try { conditions = JSON.parse(conditionsStr.value) } catch { alert('条件 JSON 格式错误'); return }
  try { conclusion = JSON.parse(conclusionStr.value) } catch { alert('结论 JSON 格式错误'); return }
  if (!Array.isArray(conditions)) { alert('条件必须是数组'); return }
  try {
    const payload = { ...form, conditions, conclusion }
    if (isEdit.value) await api.put(`/admin/reasoning-rules/${editId.value}`, payload)
    else await api.post('/admin/reasoning-rules', payload)
    closeModal()
    const r = await api.get('/admin/reasoning-rules'); rules.value = r.data || []
  } catch (e: any) { alert(e?.response?.data?.error?.message || '保存失败') }
}

async function handleDelete(r: any) {
  if (!confirm('确认删除？')) return
  await api.delete(`/admin/reasoning-rules/${r.id}`)
  rules.value = rules.value.filter((x: any) => x.id !== r.id)
}
</script>

<style scoped>
.admin-reasoning-page { max-width: 900px; }
.modal-overlay { position: fixed; inset: 0; background: rgba(45,36,32,0.4); backdrop-filter: blur(4px); display: flex; align-items: center; justify-content: center; z-index: 200; }
.modal { background: var(--bg-card); border-radius: var(--radius-lg); width: 90%; max-width: 600px; max-height: 90vh; overflow-y: auto; }
.modal-header { display: flex; align-items: center; justify-content: space-between; padding: 20px 24px; border-bottom: 1px solid var(--border-light); }
.modal-body { padding: 20px 24px; display: flex; flex-direction: column; gap: 14px; }
.modal-actions { display: flex; gap: 8px; justify-content: flex-end; margin-top: 8px; }
.modal-close { background: none; border: none; cursor: pointer; color: var(--text-secondary); }
.modal-close:hover { color: var(--text-primary); }
.required { color: var(--accent-coral); }
textarea { width: 100%; padding: 10px; border: 1px solid var(--border); border-radius: var(--radius-sm); font-family: monospace; font-size: 0.85rem; resize: vertical; background: var(--bg-input); color: var(--text-primary); }
</style>
