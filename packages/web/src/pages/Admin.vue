<template>
  <div class="admin-page">
    <div class="page-header"><h2 class="page-header-title">系统管理</h2></div>

    <!-- 智能填单引擎 -->
    <div class="card" style="margin-bottom:20px">
      <h3 class="font-heading section-title">📝 智能填单引擎</h3>
      <div class="form-grid">
        <div class="field"><label>端点</label><input v-model="cfg.fillEngine.endpoint" /></div>
        <div class="field model-field">
          <label>模型</label>
          <div class="model-select-row">
            <select v-model="cfg.fillEngine.model"><option v-for="m in fillModels" :key="m.id" :value="m.id">{{ m.name }}{{ m.recommended ? ' ★' : '' }}</option></select>
            <button class="btn-secondary btn-sm" @click="fetchModels" :disabled="modelsLoading">🔄</button>
          </div>
        </div>
      </div>
      <div style="margin-top:12px;display:flex;gap:10px;flex-wrap:wrap;align-items:center">
        <button class="btn-primary btn-sm" @click="saveConfig" :disabled="saving">💾 保存</button>
        <button class="btn-secondary btn-sm" @click="testAI('text')" :disabled="testing">{{ testing==='text'?'测试中...':'📝 检验文字识别' }}</button>
        <label class="toggle-label"><input type="checkbox" v-model="cfg.fillEngine.enabled" @change="saveConfig" /><span>启用</span></label>
      </div>
    </div>

    <!-- 发票OCR引擎 -->
    <div class="card" style="margin-bottom:20px">
      <h3 class="font-heading section-title">🧾 发票OCR引擎</h3>
      <div class="form-grid">
        <div class="field">
          <label>引擎方案</label>
          <select v-model="cfg.ocrEngine.provider" @change="saveConfig">
            <option value="mineru">MinerU (文档智能解析)</option>
            <option value="paddle">PaddleOCR (通用OCR)</option>
            <option value="vision">视觉模型 (glm-ocr等)</option>
          </select>
        </div>
        <template v-if="cfg.ocrEngine.provider==='mineru'">
          <div class="field full"><label>MinerU 端点</label><input v-model="cfg.ocrEngine.mineruEndpoint" /></div>
        </template>
        <template v-else-if="cfg.ocrEngine.provider==='paddle'">
          <div class="field full"><label>PaddleOCR 端点</label><input v-model="cfg.ocrEngine.paddleEndpoint" /></div>
        </template>
        <template v-else>
          <div class="field"><label>视觉模型端点</label><input v-model="cfg.ocrEngine.visionEndpoint" /></div>
          <div class="field"><label>视觉模型名</label><input v-model="cfg.ocrEngine.visionModel" /></div>
        </template>
      </div>
      <div style="margin-top:12px;display:flex;gap:10px;flex-wrap:wrap;align-items:center">
        <button class="btn-primary btn-sm" @click="saveConfig" :disabled="saving">💾 保存</button>
        <button class="btn-secondary btn-sm" @click="testAI('ocr')" :disabled="testing">{{ testing==='ocr'?'测试中...':'🧾 检验发票OCR' }}</button>
        <label class="toggle-label"><input type="checkbox" v-model="cfg.ocrEngine.enabled" @change="saveConfig" /><span>启用</span></label>
      </div>
    </div>

    <div v-if="result" class="ai-test-result" :class="{success:resultOk,fail:!resultOk}">{{ result }}</div>

    <!-- 用户列表 -->
    <div class="card" style="padding:0;overflow:hidden">
      <div style="padding:18px 24px;border-bottom:1px solid var(--border-light)"><h3 class="font-heading" style="font-size:1rem">用户列表</h3></div>
      <table class="data-table"><thead><tr><th>用户</th><th>手机号</th><th>角色</th><th>部门</th><th>状态</th></tr></thead>
        <tbody><tr v-for="u in users" :key="u.id"><td><span>{{ u.name }}</span></td><td class="text-secondary">{{ u.phone }}</td><td><span class="badge" :class="u.role==='admin'?'badge-approved':u.role==='finance'?'badge-draft':'badge-pending'">{{roleLabel(u.role)}}</span></td><td class="text-secondary">{{ u.department }}</td><td><span class="badge" :class="u.status==='active'?'badge-approved':'badge-draft'">{{u.status==='active'?'启用':'禁用'}}</span></td></tr></tbody></table>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue'
import api from '../api/index'

const cfg = reactive<any>({
  fillEngine: { endpoint: '', model: '', enabled: true },
  ocrEngine: { provider: 'mineru', mineruEndpoint: '', paddleEndpoint: '', visionEndpoint: '', visionModel: '', enabled: true },
})
const saving = ref(false)
const testing = ref<string|false>(false)
const result = ref('')
const resultOk = ref(false)
const fillModels = ref<any[]>([])
const modelsLoading = ref(false)
const users = ref<any[]>([])

onMounted(async () => {
  try {
    const [c, u] = await Promise.all([api.get('/admin/ai-config'), api.get('/admin/users')])
    Object.assign(cfg, c.data)
    users.value = u.data || []
  } catch {}
  fetchModels()
})

async function fetchModels() {
  modelsLoading.value = true
  try { const r = await api.get('/admin/ai-models'); fillModels.value = r.data.models || [] } catch { fillModels.value = [] } finally { modelsLoading.value = false }
}

async function saveConfig() {
  saving.value = true
  try { await api.put('/admin/ai-config', { fillEngine: cfg.fillEngine, ocrEngine: cfg.ocrEngine }) } finally { saving.value = false }
}

async function testAI(type: string) {
  testing.value = type; result.value = ''
  try { const r = await api.post('/admin/ai-test', { type }); resultOk.value = r.data.success; result.value = r.data.message } catch (e: any) { resultOk.value = false; result.value = '失败: ' + (e?.message || '') } finally { testing.value = false }
}

function roleLabel(r: string) { const m: any = { admin: '管理员', dept_approver: '部门审批人', finance: '财务', employee: '员工' }; return m[r] || r }
</script>

<style scoped>
.admin-page { max-width: 900px }
.section-title { font-size: 1rem; margin-bottom: 14px }
.form-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px }
.field.full { grid-column: 1/-1 }
.field label { display: block; font-size: .8rem; color: var(--text-muted); margin-bottom: 5px }
.field input,.field select { width: 100%; padding: 10px 12px; border: 1px solid var(--border); border-radius: var(--radius-sm); background: var(--bg-input); color: var(--text-primary); font-family: var(--font-body); font-size: .875rem }
.model-select-row { display: flex; gap: 6px }
.model-select-row select { flex: 1 }
.toggle-label { display: flex; align-items: center; gap: 5px; font-size: .85rem; color: var(--text-secondary); cursor: pointer }
.ai-test-result { margin-top: 0; margin-bottom: 20px; padding: 10px 16px; border-radius: var(--radius-sm); font-size: .85rem }
.ai-test-result.success { background: var(--accent-mint-bg); color: #2b7a3d }
.ai-test-result.fail { background: var(--accent-coral-bg); color: var(--accent-coral) }
@media (max-width:600px) { .form-grid { grid-template-columns: 1fr } }
</style>
