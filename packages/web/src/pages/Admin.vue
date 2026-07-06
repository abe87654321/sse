<template>
  <div class="admin-page">
    <div class="page-header">
      <h2 class="page-header-title">系统管理</h2>
    </div>

    <!-- AI 模型配置 -->
    <div class="card" style="margin-bottom: 20px;">
      <h3 class="font-heading section-title">🤖 AI 模型配置</h3>

      <div class="form-grid">
        <div class="field">
          <label>API 端点地址</label>
          <input v-model="aiConfig.endpoint" type="text" placeholder="http://localhost:11434/v1/chat/completions" />
        </div>
        <div class="field">
          <label>模型名称</label>
          <input v-model="aiConfig.model" type="text" placeholder="llama3.2-vision" />
        </div>
      </div>

      <div style="margin-top: 14px; display: flex; align-items: center; gap: 12px; flex-wrap: wrap;">
        <button class="btn-primary btn-sm" @click="saveAiConfig" :disabled="aiSaving">
          {{ aiSaving ? '保存中...' : '💾 保存配置' }}
        </button>
        <button class="btn-secondary btn-sm" @click="testAI('text')" :disabled="aiTesting">
          {{ aiTesting === 'text' ? '测试中...' : '📝 检验文字识别' }}
        </button>
        <button class="btn-secondary btn-sm" @click="testAI('ocr')" :disabled="aiTesting">
          {{ aiTesting === 'ocr' ? '测试中...' : '🖼️ 检验图像OCR' }}
        </button>
        <label class="toggle-label">
          <input type="checkbox" v-model="aiConfig.enabled" @change="saveAiConfig" />
          <span>启用 AI</span>
        </label>
      </div>

      <div v-if="aiTestResult" class="ai-test-result" :class="{ success: aiTestSuccess, fail: !aiTestSuccess }">
        {{ aiTestResult }}
      </div>
    </div>

    <!-- 用户管理 -->
    <div class="card" style="padding: 0; overflow: hidden;">
      <div style="padding: 18px 24px; border-bottom: 1px solid var(--border-light); display: flex; align-items: center; justify-content: space-between;">
        <h3 class="font-heading" style="font-size: 1rem; letter-spacing: 0.03em;">用户列表</h3>
      </div>
      <table class="data-table">
        <thead>
          <tr>
            <th>用户</th>
            <th>手机号</th>
            <th>角色</th>
            <th>部门</th>
            <th>状态</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="user in users" :key="user.id">
            <td>
              <div style="display: flex; align-items: center; gap: 10px;">
                <span>{{ user.name }}</span>
              </div>
            </td>
            <td class="text-secondary">{{ user.phone || '-' }}</td>
            <td>
              <span class="badge" :class="user.role === 'admin' ? 'badge-approved' : user.role === 'finance' ? 'badge-draft' : 'badge-pending'">
                {{ roleLabel(user.role) }}
              </span>
            </td>
            <td class="text-secondary">{{ user.department || '-' }}</td>
            <td><span class="badge" :class="user.status === 'active' ? 'badge-approved' : 'badge-draft'">{{ user.status === 'active' ? '启用' : '禁用' }}</span></td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue'
import api from '../api/index'

const aiConfig = reactive({ endpoint: '', model: '', enabled: true })
const aiSaving = ref(false)
const aiTesting = ref<string | false>(false)
const aiTestResult = ref('')
const aiTestSuccess = ref(false)

const users = ref<any[]>([])

onMounted(async () => {
  try {
    const [configRes, usersRes] = await Promise.all([
      api.get('/admin/ai-config'),
      api.get('/admin/users'),
    ])
    Object.assign(aiConfig, configRes.data)
    users.value = usersRes.data || []
  } catch { /* silent */ }
})

function roleLabel(role: string) {
  const map: Record<string, string> = { admin: '管理员', dept_approver: '部门审批人', finance: '财务', employee: '员工' }
  return map[role] || role
}

async function saveAiConfig() {
  aiSaving.value = true
  try {
    await api.put('/admin/ai-config', {
      endpoint: aiConfig.endpoint,
      model: aiConfig.model,
      enabled: aiConfig.enabled,
    })
  } finally {
    aiSaving.value = false
  }
}

async function testAI(type: 'text' | 'ocr') {
  aiTesting.value = type
  aiTestResult.value = ''
  try {
    const res = await api.post('/admin/ai-test', { type })
    aiTestSuccess.value = res.data.success
    aiTestResult.value = res.data.message
  } catch (e: any) {
    aiTestSuccess.value = false
    aiTestResult.value = '请求失败: ' + (e?.message || '未知错误')
  } finally {
    aiTesting.value = false
  }
}
</script>

<style scoped>
.admin-page { max-width: 900px; }

.section-title {
  font-size: 1rem;
  letter-spacing: 0.03em;
  margin-bottom: 16px;
}

.form-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
@media (max-width: 600px) { .form-grid { grid-template-columns: 1fr; } }

.field label {
  display: block;
  font-size: 0.8rem;
  color: var(--text-muted);
  margin-bottom: 6px;
}
.field input {
  width: 100%;
  padding: 10px 14px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--bg-input);
  color: var(--text-primary);
  font-family: var(--font-body);
  font-size: 0.875rem;
}

.toggle-label {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 0.85rem;
  color: var(--text-secondary);
  cursor: pointer;
}

.ai-test-result {
  margin-top: 12px;
  padding: 10px 16px;
  border-radius: var(--radius-sm);
  font-size: 0.85rem;
}
.ai-test-result.success { background: var(--accent-mint-bg); color: #2b7a3d; }
.ai-test-result.fail { background: var(--accent-coral-bg); color: var(--accent-coral); }
</style>
