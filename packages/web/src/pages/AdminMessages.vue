<template>
  <div class="admin-messages-page">
    <div class="page-header">
      <h2 class="page-header-title">消息管理</h2>
      <div class="header-spacer"></div>
      <button class="btn-primary btn-sm" @click="showComposer = true">+ 新建消息</button>
    </div>

    <div class="tabs">
      <button :class="{ active: tab === 'draft' }" @click="tab = 'draft'">草稿</button>
      <button :class="{ active: tab === 'sent' }" @click="tab = 'sent'">已发送</button>
    </div>

    <div v-if="filteredMessages.length === 0" class="card"><div class="empty-state"><div class="empty-state-text">{{ tab === 'draft' ? '暂无草稿' : '暂无已发送' }}</div></div></div>

    <div v-else class="message-list">
      <div class="card message-item" v-for="m in filteredMessages" :key="m.id">
        <div class="message-info">
          <div class="message-title">{{ m.title }}</div>
          <div class="message-meta text-muted">{{ formatDate(m.updated_at) }} · {{ (m.target_roles || []).join(', ') || '全员' }}</div>
        </div>
        <div class="message-actions">
          <template v-if="m.status === 'draft'">
            <button class="btn-secondary btn-sm" @click="editDraft(m)">编辑</button>
            <button class="btn-primary btn-sm" @click="sendDraft(m.id)">发送</button>
            <button class="btn-danger btn-sm" @click="deleteDraft(m.id)">删除</button>
          </template>
          <template v-else>
            <span class="text-muted" style="font-size:0.82rem;">{{ formatDate(m.sent_at) }} 已发送</span>
          </template>
        </div>
      </div>
    </div>

    <div v-if="showComposer" class="modal-overlay" @click.self="closeComposer">
      <div class="modal-card composer-modal">
        <h3 class="form-section-title font-heading">{{ editingId ? '编辑消息' : '撰写广播消息' }}</h3>

        <div class="field"><label>标题</label><input v-model="form.title" placeholder="请输入消息标题" /></div>
        <div class="field"><label>正文</label><textarea v-model="form.body" rows="5" placeholder="请输入消息正文"></textarea></div>

        <button class="btn-secondary btn-sm" style="margin-bottom:12px" @click="aiPolish" :disabled="!form.body || polishing">✨ AI 润色</button>

        <div class="field"><label>目标角色</label>
          <div class="checkbox-group">
            <label v-for="role in roleOptions" :key="role.value"><input type="checkbox" :value="role.value" v-model="form.target_roles" /> {{ role.label }}</label>
          </div>
        </div>

        <div class="field"><label>指定用户（可选）</label>
          <UserPicker v-model="form.specificUsers" />
        </div>

        <div class="field"><label>发送渠道</label>
          <div class="checkbox-group">
            <label><input type="checkbox" value="sms" v-model="form.delivery_channels" /> SMS</label>
            <label><input type="checkbox" value="email" v-model="form.delivery_channels" /> 邮件</label>
          </div>
          <span class="text-muted" style="font-size:0.78rem;">页面通知始终发送</span>
        </div>

        <div class="modal-actions">
          <button class="btn-secondary btn-sm" @click="saveDraft">保存草稿</button>
          <button class="btn-primary btn-sm" @click="sendNow">立即发送</button>
          <button class="btn-text btn-sm" @click="closeComposer">取消</button>
        </div>
      </div>
    </div>

    <div v-if="showPolishDialog" class="modal-overlay" @click.self="showPolishDialog = false">
      <div class="modal-card polish-modal">
        <h3 class="form-section-title font-heading">AI 润色对比</h3>
        <div class="polish-compare">
          <div class="polish-col"><h4>原文</h4><p>{{ form.body }}</p></div>
          <div class="polish-col"><h4>润色后</h4><p>{{ polishedBody }}</p></div>
        </div>
        <div class="field" style="margin-top:12px"><label>调整要求</label>
          <div class="polish-refine">
            <input v-model="polishInstruction" placeholder="例如：更正式一些" @keyup.enter="aiPolish" />
            <button class="btn-secondary btn-sm" @click="aiPolish" :disabled="polishing">再次润色</button>
          </div>
        </div>
        <div class="modal-actions" style="margin-top:16px">
          <button class="btn-primary btn-sm" @click="acceptPolish">采用润色</button>
          <button class="btn-secondary btn-sm" @click="showPolishDialog = false">保留原文</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, reactive } from 'vue'
import api from '../api/index'
import UserPicker from '../components/UserPicker.vue'

const tab = ref<'draft' | 'sent'>('draft')
const messages = ref<any[]>([])
const showComposer = ref(false)
const showPolishDialog = ref(false)
const editingId = ref('')
const polishedBody = ref('')
const polishInstruction = ref('')
const polishing = ref(false)

const form = reactive({
  title: '', body: '', body_ai: '',
  target_roles: [] as string[],
  specificUsers: [] as any[],
  delivery_channels: [] as string[],
})
const roleOptions = [
  { value: 'admin', label: '管理员' },
  { value: 'dept_approver', label: '部门审批人' },
  { value: 'finance', label: '财务' },
  { value: 'employee', label: '普通员工' },
]

const filteredMessages = computed(() => messages.value.filter(m => m.status === tab.value))

function formatDate(d: string) { return d ? d.slice(0, 10) : '' }

async function fetchMessages() {
  try { const res = await api.get('/admin/messages'); messages.value = res.data || [] } catch {}
}

async function saveDraft() {
  try {
    if (!form.title.trim()) { alert('请输入标题'); return }
    const payload = {
      title: form.title, body: form.body || form.title, body_ai: form.body_ai,
      target_roles: form.target_roles,
      target_user_ids: form.specificUsers.map(u => u.id),
      delivery_channels: form.delivery_channels,
    }
    if (editingId.value) { await api.put(`/admin/messages/${editingId.value}`, payload) }
    else { await api.post('/admin/messages', payload) }
    closeComposer(); fetchMessages()
  } catch (err: any) {
    const msg = err.response?.data?.error?.message || err.response?.data?.message || err.message || '保存失败'
    alert(msg)
  }
}

async function sendNow() {
  try {
    if (!form.title.trim()) { alert('请输入标题'); return }
    const payload = {
      title: form.title, body: form.body || form.title, body_ai: form.body_ai,
      target_roles: form.target_roles,
      target_user_ids: form.specificUsers.map(u => u.id),
      delivery_channels: form.delivery_channels,
      send_now: true,
    }
    if (form.target_roles.length === 0 && form.specificUsers.length === 0) { alert('请选择目标角色或指定用户'); return }
    const res = await api.post('/admin/messages', payload)
    alert(`发送成功，已推送给 ${res.data.sent_to} 人`)
    closeComposer(); fetchMessages()
  } catch (err: any) {
    const msg = err.response?.data?.error?.message || err.response?.data?.message || err.message || '发送失败'
    alert(msg)
  }
}

async function sendDraft(id: string) {
  try {
    const res = await api.post(`/admin/messages/${id}/send`)
    alert(`发送成功，已推送给 ${res.data.sent_to} 人`)
    fetchMessages()
  } catch (err: any) { alert(err.response?.data?.error?.message || err.response?.data?.message || err.message || '发送失败') }
}

async function deleteDraft(id: string) {
  if (!confirm('确定删除？')) return
  try { await api.delete(`/admin/messages/${id}`); fetchMessages() } catch {}
}

function editDraft(m: any) {
  form.title = m.title; form.body = m.body; form.body_ai = m.body_ai || ''
  form.target_roles = m.target_roles || []; form.delivery_channels = m.delivery_channels || []
  form.specificUsers = []; editingId.value = m.id; showComposer.value = true
}

function closeComposer() {
  showComposer.value = false; editingId.value = ''
  form.title = ''; form.body = ''; form.body_ai = ''
  form.target_roles = []; form.specificUsers = []; form.delivery_channels = []
}

async function aiPolish() {
  if (!form.body) return
  polishing.value = true
  try {
    const res = await api.post('/ai/polish', { body: form.body, instruction: polishInstruction.value || undefined, previous: polishedBody.value || undefined })
    polishedBody.value = res.data.polished_body; showPolishDialog.value = true
  } catch { alert('AI 润色失败，请检查模型连接') }
  finally { polishing.value = false }
}

function acceptPolish() { form.body = polishedBody.value; form.body_ai = polishedBody.value; polishInstruction.value = ''; showPolishDialog.value = false }

onMounted(fetchMessages)
</script>

<style scoped>
.admin-messages-page { max-width: 800px; }
.header-spacer { flex: 1; }
.tabs { display: flex; gap: 8px; margin-bottom: 16px; }
.tabs button { padding: 6px 16px; border-radius: var(--radius-sm); font-size: 0.88rem; background: transparent; color: var(--text-secondary); }
.tabs button.active { background: var(--accent-coral-bg); color: var(--accent-coral); font-weight: 600; }
.message-list { display: flex; flex-direction: column; gap: 10px; }
.message-item { display: flex; justify-content: space-between; align-items: center; padding: 16px 20px; }
.message-title { font-weight: 600; margin-bottom: 4px; }
.message-meta { font-size: 0.8rem; }
.message-actions { display: flex; gap: 8px; flex-shrink: 0; }

.modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.5); display: flex; align-items: center; justify-content: center; z-index: 300; }
.modal-card { background: var(--bg-card); border-radius: var(--radius); padding: 28px; max-width: 680px; width: 90vw; max-height: 85vh; overflow-y: auto; box-shadow: var(--shadow-xl); }
.composer-modal .field { margin-bottom: 14px; }
.composer-modal textarea { min-height: 100px; }

.checkbox-group { display: flex; gap: 16px; flex-wrap: wrap; }
.checkbox-group label { display: flex; align-items: center; gap: 4px; font-size: 0.9rem; cursor: pointer; }
.checkbox-group label input[type="checkbox"] { width: auto; }

.polish-compare { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
.polish-col { padding: 12px; background: var(--bg-warm); border-radius: var(--radius-sm); }
.polish-col h4 { margin-bottom: 8px; font-size: 0.85rem; color: var(--text-muted); }
.polish-col p { font-size: 0.9rem; line-height: 1.6; white-space: pre-wrap; }
.polish-refine { display: flex; gap: 8px; }
.polish-refine input { flex: 1; }
.modal-actions { display: flex; gap: 8px; justify-content: flex-end; }
</style>
