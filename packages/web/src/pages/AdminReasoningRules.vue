<template>
  <div class="admin-reasoning-page">
    <div class="page-header"><h2 class="page-header-title">推理规则管理</h2></div>
    <div class="toolbar">
      <div class="toolbar-spacer"></div>
      <button class="btn-primary" @click="openCreate"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>新建规则</button>
    </div>
    <div class="table-wrap">
      <table class="data-table">
        <thead><tr><th>名称</th><th>说明</th><th>类型</th><th>优先级</th><th>启用</th><th>操作</th></tr></thead>
        <tbody>
          <tr v-for="r in rules" :key="r.id">
            <td>{{ r.name }}</td><td class="text-secondary">{{ r.description || '-' }}</td>
            <td>{{ r.constructQuery ? 'CONSTRUCT' : '旧版 JSON' }}</td>
            <td>{{ r.priority }}</td>
            <td>{{ r.isActive ? '✔' : '—' }}</td>
            <td class="col-action"><span class="table-link" @click="openEdit(r)">编辑</span><span class="table-link" style="color:var(--danger, #e53e3e);margin-left:8px" @click="handleDelete(r)">删除</span></td>
          </tr>
          <tr v-if="rules.length === 0"><td colspan="6"><div class="empty-state">暂无推理规则</div></td></tr>
        </tbody>
      </table>
    </div>
    <Teleport to="body"><div v-if="showModal" class="modal-overlay" @click.self="closeModal">
      <div class="modal"><div class="modal-header"><h3 class="modal-title font-heading">{{ isEdit ? '编辑' : '新建' }}推理规则</h3><button class="modal-close" @click="closeModal"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button></div>
        <form class="modal-body" @submit.prevent="save">
          <div class="field"><label>名称 <span class="required">*</span></label><input v-model="form.name" required maxlength="100"/></div>
          <div class="field"><label>说明</label><input v-model="form.description"/></div>
          <div class="field">
            <label>CONSTRUCT 查询 <span class="hint">（本体 v2 推理，推荐）</span></label>
            <textarea v-model="form.constructQuery" rows="8" placeholder="CONSTRUCT { ?r a &lt;https://sse.local/ontology#HighValueReport&gt; } WHERE { GRAPH &lt;urn:sse:data&gt; { ?r a &lt;https://sse.local/ontology#ExpenseReport&gt; ; &lt;https://sse.local/ontology#totalAmount&gt; ?amount } FILTER(?amount &gt;= 5000) }"></textarea>
          </div>
          <div class="field-row">
            <div class="field"><label>严重级别</label><select v-model="form.severity"><option value="info">info</option><option value="warning">warning</option><option value="error">error</option></select></div>
            <div class="field"><label>提示消息</label><input v-model="form.message" placeholder="可选，用于校验/异常展示"/></div>
          </div>
          <div class="field"><label>优先级</label><input v-model.number="form.priority" type="number" min="0"/></div>
          <div class="field"><label style="display:flex;align-items:center;gap:8px;cursor:pointer"><input type="checkbox" v-model="form.isActive"/> 启用</label></div>
          <details class="legacy">
            <summary>旧版条件/结论 JSON（仅 ONTOLOGY_V2=0 使用）</summary>
            <div class="field"><label>条件 (JSON)</label><textarea v-model="conditionsStr" rows="4"></textarea></div>
            <div class="field"><label>结论 (JSON)</label><textarea v-model="conclusionStr" rows="2"></textarea></div>
          </details>
          <p v-if="previewError" class="preview-error">{{ previewError }}</p>
          <div v-if="preview" class="preview-box">
            <div>预览：命中 {{ preview.count }} 条推断三元组</div>
            <pre>{{ preview.sampleText || '（无结果）' }}</pre>
          </div>
          <div class="modal-actions">
            <button type="button" class="btn-secondary" :disabled="previewing || !form.constructQuery.trim()" @click="previewRule">{{ previewing ? '预览中...' : '预览推断结果' }}</button>
            <button type="button" class="btn-secondary" @click="closeModal">取消</button>
            <button type="submit" class="btn-primary">保存</button>
          </div>
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
const form = reactive({ name: '', description: '', priority: 0, isActive: true, constructQuery: '', severity: 'info', message: '' })
const conditionsStr = ref('')
const conclusionStr = ref('')
const previewing = ref(false)
const preview = ref<{ count: number; sampleText: string } | null>(null)
const previewError = ref('')

onMounted(async () => {
  try { const r = await api.get('/admin/reasoning-rules'); rules.value = r.data || [] } catch {}
})

function resetPreview() {
  preview.value = null
  previewError.value = ''
}

function openCreate() {
  isEdit.value = false; editId.value = ''
  Object.assign(form, { name: '', description: '', priority: 0, isActive: true, constructQuery: '', severity: 'info', message: '' })
  conditionsStr.value = '[]'
  conclusionStr.value = '{}'
  resetPreview()
  showModal.value = true
}
function openEdit(r: any) {
  isEdit.value = true; editId.value = r.id
  Object.assign(form, {
    name: r.name,
    description: r.description || '',
    priority: r.priority,
    isActive: !!r.isActive,
    constructQuery: r.constructQuery || '',
    severity: r.severity || 'info',
    message: r.message || '',
  })
  conditionsStr.value = JSON.stringify(Array.isArray(r.conditions) ? r.conditions : [], null, 2)
  conclusionStr.value = JSON.stringify(r.conclusion && typeof r.conclusion === 'object' ? r.conclusion : {}, null, 2)
  resetPreview()
  showModal.value = true
}
function closeModal() { showModal.value = false }

async function save() {
  let conditions: any, conclusion: any
  try { conditions = JSON.parse(conditionsStr.value || '[]') } catch { alert('条件 JSON 格式错误'); return }
  try { conclusion = JSON.parse(conclusionStr.value || '{}') } catch { alert('结论 JSON 格式错误'); return }
  if (!Array.isArray(conditions)) { alert('条件必须是数组'); return }
  if (!form.constructQuery.trim() && conditions.length === 0) { alert('请填写 CONSTRUCT 查询或旧版条件'); return }
  try {
    const payload = {
      name: form.name,
      description: form.description,
      priority: form.priority,
      isActive: form.isActive,
      constructQuery: form.constructQuery.trim(),
      severity: form.severity,
      message: form.message.trim(),
      conditions,
      conclusion,
    }
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

function tripleText(q: any): string {
  const object = q.objectType === 'iri'
    ? `<${q.object}>`
    : `"${q.object}"${q.language ? '@' + q.language : q.datatype ? '^^<' + q.datatype + '>' : ''}`
  return `<${q.subject}> <${q.predicate}> ${object}`
}

async function previewRule() {
  if (!form.constructQuery.trim()) return
  previewing.value = true
  previewError.value = ''
  preview.value = null
  try {
    const res = await api.post('/admin/reasoning-rules/preview', { constructQuery: form.constructQuery.trim() })
    const sample = Array.isArray(res.data?.sample) ? res.data.sample : []
    preview.value = {
      count: Number(res.data?.count) || 0,
      sampleText: sample.slice(0, 10).map(tripleText).join('\n'),
    }
  } catch (e: any) {
    previewError.value = e?.response?.data?.error?.message || '预览失败'
  } finally {
    previewing.value = false
  }
}
</script>

<style scoped>
.admin-reasoning-page { max-width: 900px; }
.modal-overlay { position: fixed; inset: 0; background: rgba(45,36,32,0.4); backdrop-filter: blur(4px); display: flex; align-items: center; justify-content: center; z-index: 200; }
.modal { background: var(--bg-card); border-radius: var(--radius-lg); width: 90%; max-width: 680px; max-height: 90vh; overflow-y: auto; }
.modal-header { display: flex; align-items: center; justify-content: space-between; padding: 20px 24px; border-bottom: 1px solid var(--border-light); }
.modal-body { padding: 20px 24px; display: flex; flex-direction: column; gap: 14px; }
.modal-actions { display: flex; gap: 8px; justify-content: flex-end; margin-top: 8px; }
.modal-close { background: none; border: none; cursor: pointer; color: var(--text-secondary); }
.modal-close:hover { color: var(--text-primary); }
.required { color: var(--accent-coral); }
.hint { color: var(--text-muted, #888); font-weight: normal; font-size: 0.78rem; }
.field-row { display: grid; grid-template-columns: 160px 1fr; gap: 12px; }
select { width: 100%; height: 38px; padding: 0 10px; border: 1px solid var(--border); border-radius: var(--radius-sm); background: var(--bg-input); color: var(--text-primary); }
details.legacy { border-top: 1px dashed var(--border-light); padding-top: 10px; }
details.legacy summary { cursor: pointer; font-size: 0.82rem; color: var(--text-secondary); margin-bottom: 8px; }
.preview-box { background: var(--bg-input); border: 1px solid var(--border-light); border-radius: var(--radius-sm); padding: 10px; font-size: 0.78rem; }
.preview-box pre { margin: 6px 0 0; white-space: pre-wrap; word-break: break-all; max-height: 180px; overflow: auto; }
.preview-error { color: var(--danger, #e53e3e); font-size: 0.8rem; margin: 0; }
textarea { width: 100%; padding: 10px; border: 1px solid var(--border); border-radius: var(--radius-sm); font-family: monospace; font-size: 0.85rem; resize: vertical; background: var(--bg-input); color: var(--text-primary); }
</style>
