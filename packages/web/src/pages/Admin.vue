<template>
  <div class="admin-page">
    <div class="page-header"><h2 class="page-header-title">系统管理</h2></div>

    <!-- 智能填单引擎 -->
    <div class="card" style="margin-bottom:20px">
      <h3 class="font-heading section-title">📝 智能填单引擎</h3>
      <div class="form-grid">
        <div class="field full">
          <label for="fill-endpoint">API 地址</label>
          <input
            id="fill-endpoint"
            v-model="cfg.fillEngine.endpoint"
            placeholder="http://192.168.3.117:11434"
            @blur="loadCatalogForEndpoint"
          />
          <div class="field-hint">填写到端口或 /v1 即可，系统会自动补全接口路径</div>
        </div>
        <div class="field full">
          <label for="fill-api-key">API 密钥</label>
          <div class="key-row">
            <input
              id="fill-api-key"
              v-model="cfg.fillEngine.apiKey"
              type="password"
              autocomplete="new-password"
              :placeholder="cfg.fillEngine.apiKeySet ? '已配置，留空则不修改' : '可选，留空表示无密钥'"
            />
            <button type="button" class="btn-secondary btn-sm" :disabled="connectionTesting" @click="testConnection">
              {{ connectionTesting ? '检测中...' : '检测' }}
            </button>
          </div>
          <div
            v-if="connectionResult"
            class="inline-result"
            role="status"
            aria-live="polite"
            :class="{ success: connectionResult.success, fail: !connectionResult.success }"
          >
            {{ connectionMessage }}
          </div>
        </div>
        <div class="field full">
          <label for="fill-model">模型</label>
          <div class="model-select-row">
            <select id="fill-model" v-model="cfg.fillEngine.model">
              <option v-for="model in selectedModels" :key="model.id" :value="model.id">{{ model.id }}</option>
            </select>
            <button type="button" class="btn-secondary btn-sm" @click="showModelPicker = true">获取模型列表</button>
          </div>
          <div class="field-hint">
            已选 {{ selectedModels.length }} 个模型
            <span v-if="selectedModels.length === 0">，请先获取模型列表</span>
          </div>
        </div>
      </div>
      <div style="margin-top:12px;display:flex;gap:10px;flex-wrap:wrap;align-items:center">
        <button type="button" class="btn-primary btn-sm" @click="saveConfig" :disabled="saving">💾 保存</button>
        <button type="button" class="btn-secondary btn-sm" @click="testFill" :disabled="!!testing">{{ testing==='text'?'测试中...':'📝 检验文字识别' }}</button>
        <label class="toggle-label"><input type="checkbox" v-model="cfg.fillEngine.enabled" @change="saveConfig" /><span>启用</span></label>
      </div>
      <div v-if="fillTestResult" class="ai-test-result" role="status" aria-live="polite" :class="{success:fillTestResult.success,fail:!fillTestResult.success}">
        {{ fillTestResult.message }}（{{ fillTestResult.elapsedMs }}ms）
      </div>
    </div>

    <!-- 发票OCR引擎 -->
    <div class="card" style="margin-bottom:20px">
      <h3 class="font-heading section-title">🧾 发票OCR引擎</h3>
      <div class="form-grid">
        <div class="field">
          <label for="ocr-provider">引擎方案</label>
          <select id="ocr-provider" v-model="cfg.ocrEngine.provider" @change="saveConfig">
            <option value="mineru">MinerU (文档智能解析)</option>
            <option value="paddle">PaddleOCR (通用OCR)</option>
            <option value="vision">视觉模型 (glm-ocr等)</option>
          </select>
        </div>
        <template v-if="cfg.ocrEngine.provider==='mineru'">
          <div class="field full"><label for="mineru-endpoint">MinerU 端点</label><input id="mineru-endpoint" v-model="cfg.ocrEngine.mineruEndpoint" placeholder="https://mineru.net" /></div>
          <div class="field full">
            <label for="mineru-token">MinerU Token</label>
            <input
              id="mineru-token"
              v-model="cfg.ocrEngine.mineruToken"
              type="password"
              autocomplete="new-password"
              :placeholder="cfg.ocrEngine.mineruTokenSet ? '已配置，留空则不修改' : '粘贴 MinerU API Token'"
            />
          </div>
        </template>
        <template v-else-if="cfg.ocrEngine.provider==='paddle'">
          <div class="field full"><label for="paddle-endpoint">PaddleOCR 端点</label><input id="paddle-endpoint" v-model="cfg.ocrEngine.paddleEndpoint" placeholder="http://localhost:8899" /></div>
        </template>
        <template v-else>
          <div class="field"><label for="vision-endpoint">视觉模型端点</label><input id="vision-endpoint" v-model="cfg.ocrEngine.visionEndpoint" placeholder="http://192.168.3.117:11434" /></div>
          <div class="field"><label for="vision-model">视觉模型名</label><input id="vision-model" v-model="cfg.ocrEngine.visionModel" /></div>
          <div class="field full">
            <label for="vision-api-key">视觉模型 API 密钥</label>
            <input
              id="vision-api-key"
              v-model="cfg.ocrEngine.visionApiKey"
              type="password"
              autocomplete="new-password"
              :placeholder="cfg.ocrEngine.visionApiKeySet ? '已配置，留空则不修改' : '可选'"
            />
          </div>
        </template>
      </div>
      <div style="margin-top:12px;display:flex;gap:10px;flex-wrap:wrap;align-items:center">
        <button type="button" class="btn-primary btn-sm" @click="saveConfig" :disabled="saving">💾 保存</button>
        <label class="toggle-label"><input type="checkbox" v-model="cfg.ocrEngine.enabled" @change="saveConfig" /><span>启用</span></label>
      </div>
      <EngineTestPanel
        :testing="testing==='ocr'"
        :result="ocrTestResult"
        :history="ocrHistory"
        @test="testOcr"
        @clear-history="clearOcrHistory"
      />
    </div>

    <!-- 审批流程设计 -->
    <div class="card" style="margin-bottom:20px">
      <h3 class="font-heading section-title">🔄 审批流程设计</h3>
      <div class="form-grid">
        <div class="field"><label>规则名称</label><input v-model="ruleForm.name" placeholder="例如：小额度日常报销" /></div>
        <div class="field"><label>优先级</label><input v-model.number="ruleForm.priority" type="number" min="1" max="100" /></div>
        <div class="field"><label>金额下限</label><input v-model.number="ruleForm.minAmount" type="number" min="0" /></div>
        <div class="field"><label>金额上限</label><input v-model.number="ruleForm.maxAmount" type="number" min="0" /></div>
      </div>
      <div class="category-checkboxes" style="margin-top:14px">
        <label class="cat-label">适用类别</label>
        <div class="cat-list">
          <label v-for="cat in categoryOptions" :key="cat.id" class="cat-item"><input type="checkbox" :value="cat.id" v-model="ruleForm.categoryIds" /><span>{{ cat.name }}</span></label>
        </div>
      </div>
      <div style="margin-top:16px"><WorkflowDesigner v-model:steps="ruleForm.approvalChain" /></div>
      <div style="margin-top:14px;display:flex;gap:10px;flex-wrap:wrap;align-items:center">
        <button class="btn-primary btn-sm" @click="saveRule" :disabled="ruleSaving">💾 {{ selectedRuleId ? '更新规则' : '保存规则' }}</button>
        <select v-model="selectedRuleId" @change="loadRule" style="width:200px;padding:8px 10px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--bg-input);color:var(--text-primary);font-family:var(--font-body);font-size:.875rem">
          <option value="">-- 选择已有规则 --</option>
          <option v-for="r in rules" :key="r.id" :value="r.id">{{ r.name }}</option>
        </select>
        <button v-if="selectedRuleId" class="btn-danger btn-sm" @click="deleteRule">🗑 删除规则</button>
        <button v-if="selectedRuleId" class="btn-secondary btn-sm" @click="resetRuleForm">✕ 新建规则</button>
      </div>
    </div>

    <!-- 用户列表 -->
    <div class="card" style="padding:0;overflow:hidden">
      <div style="padding:18px 24px;border-bottom:1px solid var(--border-light)"><h3 class="font-heading" style="font-size:1rem">用户列表</h3></div>
      <table class="data-table"><thead><tr><th>用户</th><th>手机号</th><th>角色</th><th>部门</th><th>状态</th></tr></thead>
        <tbody><tr v-for="u in users" :key="u.id"><td><span>{{ u.name }}</span></td><td class="text-secondary">{{ u.phone }}</td><td><span class="badge" :class="u.role==='admin'?'badge-approved':u.role==='finance'?'badge-draft':'badge-pending'">{{roleLabel(u.role)}}</span></td><td class="text-secondary">{{ u.department }}</td><td><span class="badge" :class="u.status==='active'?'badge-approved':'badge-draft'">{{u.status==='active'?'启用':'禁用'}}</span></td></tr></tbody></table>
    </div>

    <ModelPickerDialog
      v-model:open="showModelPicker"
      :endpoint="cfg.fillEngine.endpoint"
      :api-key="cfg.fillEngine.apiKey"
      :catalog="currentCatalog"
      :active-model="cfg.fillEngine.model"
      @confirm="onModelPickerConfirm"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, watch, onMounted } from 'vue'
import api from '../api/index'
import WorkflowDesigner from '@/components/WorkflowDesigner.vue'
import ModelPickerDialog from '@/components/ModelPickerDialog.vue'
import EngineTestPanel from '@/components/EngineTestPanel.vue'
import { normalizeEndpoint } from '@/utils/endpoint'

const cfg = reactive<any>({
  fillEngine: { endpoint: '', apiKey: '', apiKeySet: false, model: '', enabled: true, catalogs: {} },
  ocrEngine: {
    provider: 'mineru',
    mineruEndpoint: '',
    mineruToken: '',
    mineruTokenSet: false,
    paddleEndpoint: '',
    visionEndpoint: '',
    visionModel: '',
    visionApiKey: '',
    visionApiKeySet: false,
    enabled: true,
  },
})
const saving = ref(false)
const testing = ref<string|false>(false)
const users = ref<any[]>([])

const showModelPicker = ref(false)
const connectionTesting = ref(false)
const connectionResult = ref<any>(null)
const fillTestResult = ref<any>(null)
const ocrTestResult = ref<any>(null)
const ocrHistory = ref<any[]>([])
const currentCatalog = computed(() => {
  const key = normalizeEndpoint(cfg.fillEngine.endpoint)
  return key ? (cfg.fillEngine.catalogs?.[key] || null) : null
})
const selectedModels = computed(() => {
  const models = currentCatalog.value?.models || []
  const selected = models.filter((model: any) => model.selected)
  if (cfg.fillEngine.model && !selected.some((model: any) => model.id === cfg.fillEngine.model)) {
    return [{ id: cfg.fillEngine.model, name: cfg.fillEngine.model }, ...selected]
  }
  return selected
})
const connectionMessage = computed(() => {
  if (!connectionResult.value) return ''
  const steps = connectionResult.value.steps || []
  const models = steps.find((step: any) => step.name === 'models')
  const chat = steps.find((step: any) => step.name === 'chat')
  if (connectionResult.value.success) {
    return `✓ 连接成功 · 模型 ${models?.modelCount ?? 0} 个（${models?.elapsedMs ?? 0}ms）· 对话 ${chat?.elapsedMs ?? 0}ms`
  }
  const failed = steps.find((step: any) => !step.ok)
  const label = failed?.name === 'models' ? '模型列表' : failed?.name === 'chat' ? '对话' : ''
  return `✗ ${label ? `${label}：` : ''}${failed?.message || connectionResult.value.message}`
})

watch(
  () => cfg.fillEngine.endpoint,
  (value, oldValue) => {
    const nextKey = normalizeEndpoint(value)
    const oldKey = normalizeEndpoint(oldValue)
    if (oldKey && nextKey !== oldKey) {
      cfg.fillEngine.model = ''
      cfg.fillEngine.apiKey = ''
      cfg.fillEngine.apiKeySet = false
      connectionResult.value = null
      fillTestResult.value = null
    }
  },
)

const rules = ref<any[]>([])
const selectedRuleId = ref('')
const ruleSaving = ref(false)
const categoryOptions = ref<{ id: string; name: string }[]>([])
const ruleForm = reactive<any>({ name: '', minAmount: 0, maxAmount: 999999, approvalChain: [], priority: 10, categoryIds: [] as string[] })

onMounted(async () => {
  try {
    const [c, u] = await Promise.all([api.get('/admin/ai-config'), api.get('/admin/users')])
    Object.assign(cfg, c.data)
    users.value = u.data || []
  } catch {}
  if (!currentCatalog.value && cfg.fillEngine.endpoint) {
    refreshCatalogInBackground()
  }
  loadOcrHistory()
  try { rules.value = (await api.get('/admin/rules')).data || [] } catch {}
  try { const r = await api.get('/categories'); categoryOptions.value = r.data || [] } catch {}
})

async function saveConfig() {
  saving.value = true
  catalogRequestId++
  try {
    const catalog = currentCatalog.value
    const payload: any = {
      fillEngine: {
        endpoint: cfg.fillEngine.endpoint,
        apiKey: cfg.fillEngine.apiKey,
        model: cfg.fillEngine.model,
        enabled: cfg.fillEngine.enabled,
        ...(catalog ? { catalog } : {}),
      },
      ocrEngine: {
        provider: cfg.ocrEngine.provider,
        mineruEndpoint: cfg.ocrEngine.mineruEndpoint,
        mineruToken: cfg.ocrEngine.mineruToken,
        paddleEndpoint: cfg.ocrEngine.paddleEndpoint,
        visionEndpoint: cfg.ocrEngine.visionEndpoint,
        visionModel: cfg.ocrEngine.visionModel,
        visionApiKey: cfg.ocrEngine.visionApiKey,
        enabled: cfg.ocrEngine.enabled,
      },
    }
    const r = await api.put('/admin/ai-config', payload, { timeout: 30000 })
    if (r.data) Object.assign(cfg, r.data)
  } catch (e: any) {
    alert('保存失败: ' + errorMessage(e))
  } finally { saving.value = false }
}

function errorMessage(e: any): string {
  return e?.response?.data?.error?.message
    || e?.response?.data?.message
    || e?.message
    || '未知错误'
}

async function testConnection() {
  connectionTesting.value = true
  connectionResult.value = null
  try {
    const r = await api.post('/admin/ai-connection-test', {
      endpoint: cfg.fillEngine.endpoint,
      apiKey: cfg.fillEngine.apiKey || undefined,
      model: cfg.fillEngine.model || undefined,
    }, { timeout: 60000 })
    connectionResult.value = r.data
  } catch (e: any) {
    connectionResult.value = { success: false, message: errorMessage(e), steps: [] }
  } finally { connectionTesting.value = false }
}

async function loadCatalogForEndpoint() {
  if (!normalizeEndpoint(cfg.fillEngine.endpoint)) return
  if (!currentCatalog.value) await refreshCatalogInBackground()
  if (!cfg.fillEngine.model) {
    const firstSelected = currentCatalog.value?.models?.find((model: any) => model.selected)
    if (firstSelected) cfg.fillEngine.model = firstSelected.id
  }
}

let catalogRequestId = 0

async function refreshCatalogInBackground() {
  const endpoint = cfg.fillEngine.endpoint
  const key = normalizeEndpoint(endpoint)
  if (!key) return
  const requestId = ++catalogRequestId
  try {
    const r = await api.post('/admin/ai-models', {
      endpoint,
      apiKey: cfg.fillEngine.apiKey || undefined,
    }, { timeout: 30000 })
    if (requestId !== catalogRequestId) return
    if (normalizeEndpoint(cfg.fillEngine.endpoint) !== key) return
    const nextCatalog = r.data?.catalog
    if (!nextCatalog || !Array.isArray(nextCatalog.models) || nextCatalog.models.length === 0) return
    if (!nextCatalog.models.some((model: any) => model.selected) && nextCatalog.models[0]) {
      nextCatalog.models[0].selected = true
    }
    if (!cfg.fillEngine.model) {
      const firstSelected = nextCatalog.models.find((model: any) => model.selected)
      if (firstSelected) cfg.fillEngine.model = firstSelected.id
    }
    cfg.fillEngine.catalogs = { ...(cfg.fillEngine.catalogs || {}), [key]: nextCatalog }
  } catch { /* keep old catalog */ }
}

async function onModelPickerConfirm(payload: { catalog: any; activeModel: string }) {
  if (!normalizeEndpoint(cfg.fillEngine.endpoint)) {
    alert('请先填写 API 地址')
    return
  }
  catalogRequestId++
  const key = normalizeEndpoint(cfg.fillEngine.endpoint)
  cfg.fillEngine.catalogs = { ...(cfg.fillEngine.catalogs || {}), [key]: payload.catalog }
  cfg.fillEngine.model = payload.activeModel
  try {
    const r = await api.put('/admin/ai-config', {
      fillEngine: {
        endpoint: cfg.fillEngine.endpoint,
        apiKey: cfg.fillEngine.apiKey,
        model: payload.activeModel,
        catalog: payload.catalog,
      },
    }, { timeout: 30000 })
    if (r.data) Object.assign(cfg, r.data)
  } catch (e: any) {
    alert('保存模型列表失败: ' + errorMessage(e))
  }
}

async function testFill() {
  testing.value = 'text'
  fillTestResult.value = null
  try {
    const r = await api.post('/admin/ai-test/fill', {
      endpoint: cfg.fillEngine.endpoint,
      apiKey: cfg.fillEngine.apiKey || undefined,
      model: cfg.fillEngine.model || undefined,
    }, { timeout: 180000 })
    fillTestResult.value = r.data
  } catch (e: any) {
    fillTestResult.value = { success: false, message: errorMessage(e), elapsedMs: 0 }
  } finally { testing.value = false }
}

async function testOcr(payload: { file?: File }) {
  testing.value = 'ocr'
  ocrTestResult.value = null
  const form = new FormData()
  form.append('provider', cfg.ocrEngine.provider)
  form.append('mineruEndpoint', cfg.ocrEngine.mineruEndpoint || '')
  form.append('mineruToken', cfg.ocrEngine.mineruToken || '')
  form.append('paddleEndpoint', cfg.ocrEngine.paddleEndpoint || '')
  form.append('visionEndpoint', cfg.ocrEngine.visionEndpoint || '')
  form.append('visionModel', cfg.ocrEngine.visionModel || '')
  form.append('visionApiKey', cfg.ocrEngine.visionApiKey || '')
  if (payload.file) form.append('file', payload.file)
  try {
    const r = await api.post('/admin/ai-test/ocr', form, { timeout: 180000 })
    ocrTestResult.value = r.data
    loadOcrHistory()
  } catch (e: any) {
    const data = e?.response?.data
    ocrTestResult.value = {
      success: false,
      elapsedMs: 0,
      fields: {},
      rawText: '',
      error: {
        code: data?.error?.code || 'UNKNOWN',
        message: errorMessage(e),
        suggestion: data?.error?.suggestion || '查看 API 日志',
      },
    }
  } finally { testing.value = false }
}

async function loadOcrHistory() {
  try {
    const r = await api.get('/admin/ai-test-history', { params: { type: 'ocr', limit: 10 } })
    ocrHistory.value = r.data || []
  } catch { ocrHistory.value = [] }
}

async function clearOcrHistory() {
  if (!confirm('确定清空测试历史？')) return
  try {
    await api.delete('/admin/ai-test-history')
    ocrHistory.value = []
  } catch {}
}

function roleLabel(r: string) { const m: any = { admin: '管理员', dept_approver: '部门审批人', finance: '财务', employee: '员工' }; return m[r] || r }

function resetRuleForm() {
  selectedRuleId.value = ''
  Object.assign(ruleForm, { name: '', minAmount: 0, maxAmount: 999999, approvalChain: [], priority: 10, categoryIds: [] })
}

async function loadRule() {
  if (!selectedRuleId.value) return
  const r = rules.value.find(x => x.id === selectedRuleId.value)
  if (!r) return
  Object.assign(ruleForm, { name: r.name, minAmount: r.minAmount, maxAmount: r.maxAmount, approvalChain: r.approvalChain || [], priority: r.priority, categoryIds: r.categoryIds || [] })
}

async function saveRule() {
  ruleSaving.value = true
  try {
    if (selectedRuleId.value) {
      await api.put(`/admin/rules/${selectedRuleId.value}`, { ...ruleForm })
    } else {
      const res = await api.post('/admin/rules', { ...ruleForm, isActive: true })
      selectedRuleId.value = res.data.id
    }
    rules.value = (await api.get('/admin/rules')).data || []
  } catch (e: any) {
    alert('保存失败: ' + (e?.response?.data?.message || e?.message || ''))
  } finally { ruleSaving.value = false }
}

async function deleteRule() {
  if (!selectedRuleId.value) return
  if (!confirm('确定删除该规则？')) return
  try {
    await api.delete(`/admin/rules/${selectedRuleId.value}`)
    resetRuleForm()
    rules.value = (await api.get('/admin/rules')).data || []
  } catch (e: any) {
    alert('删除失败: ' + (e?.response?.data?.message || e?.message || ''))
  }
}
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
.field-hint { margin-top: 4px; font-size: .75rem; color: var(--text-muted); }
.key-row { display: flex; gap: 6px; }
.key-row input { flex: 1; }
.inline-result { margin-top: 6px; padding: 7px 10px; border-radius: var(--radius-sm); font-size: .8rem; }
.inline-result.success { background: var(--accent-mint-bg); color: #2b7a3d; }
.inline-result.fail { background: var(--accent-coral-bg); color: var(--accent-coral); }
.toggle-label { display: flex; align-items: center; gap: 5px; font-size: .85rem; color: var(--text-secondary); cursor: pointer }
.ai-test-result { margin-top: 0; margin-bottom: 20px; padding: 10px 16px; border-radius: var(--radius-sm); font-size: .85rem }
.ai-test-result.success { background: var(--accent-mint-bg); color: #2b7a3d }
.ai-test-result.fail { background: var(--accent-coral-bg); color: var(--accent-coral) }
@media (max-width:600px) { .form-grid { grid-template-columns: 1fr } }
.category-checkboxes { display: flex; flex-direction: column; gap: 6px }
.cat-label { font-size: .8rem; color: var(--text-muted) }
.cat-list { display: flex; flex-wrap: wrap; gap: 6px }
.cat-item { display: flex; align-items: center; gap: 3px; font-size: .82rem; color: var(--text-secondary); cursor: pointer }
.cat-item input { width: auto; margin: 0 }
.btn-danger { padding: 10px 14px; background: var(--accent-coral); color: #fff; border: none; border-radius: var(--radius-sm); cursor: pointer; font-family: var(--font-body); font-size: .85rem }
.btn-danger:hover { opacity: .85 }
</style>
