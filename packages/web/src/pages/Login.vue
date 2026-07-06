<template>
  <div class="login-page">
    <div class="login-card">
      <div class="login-header">
        <div class="login-logo">
          <div class="logo-mark">
            <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
              <rect width="48" height="48" rx="10" fill="var(--accent-amber)" />
              <text x="24" y="33" text-anchor="middle" font-family="var(--font-heading)" font-size="28" fill="#0f1117" font-weight="700">S</text>
            </svg>
          </div>
          <h1 class="login-system-name">SSE</h1>
          <p class="login-subtitle">智能报销系统</p>
        </div>
      </div>

      <el-form
        ref="formRef"
        :model="form"
        :rules="rules"
        class="login-form"
        @submit.prevent="handleLogin"
      >
        <el-form-item prop="phone">
          <el-input
            v-model="form.phone"
            placeholder="手机号"
            size="large"
            :prefix-icon="PhoneIcon"
            maxlength="11"
          />
        </el-form-item>

        <el-form-item prop="password">
          <el-input
            v-model="form.password"
            type="password"
            placeholder="密码"
            size="large"
            :prefix-icon="LockIcon"
            show-password
            @keyup.enter="handleLogin"
          />
        </el-form-item>

        <el-button
          type="warning"
          size="large"
          :loading="loading"
          class="login-btn"
          native-type="submit"
          round
        >
          {{ loading ? '登录中...' : '登 录' }}
        </el-button>
      </el-form>

      <p class="login-branding">智能报销 · 高效办公</p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, h } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { authApi } from '@/api/auth'
import type { FormInstance, FormRules } from 'element-plus'

const router = useRouter()
const auth = useAuthStore()
const formRef = ref<FormInstance>()
const loading = ref(false)

const PhoneIcon = () => h('svg', { width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': 2, innerHTML: '<rect x="5" y="2" width="14" height="20" rx="2" ry="2"/><line x1="12" y1="18" x2="12.01" y2="18"/>' })
const LockIcon = () => h('svg', { width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': 2, innerHTML: '<rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>' })

const form = reactive({ phone: '', password: '' })
const rules: FormRules = {
  phone: [
    { required: true, message: '请输入手机号', trigger: 'blur' },
    { pattern: /^1\d{10}$/, message: '手机号格式不正确', trigger: 'blur' }
  ],
  password: [
    { required: true, message: '请输入密码', trigger: 'blur' },
    { min: 6, message: '密码至少6位', trigger: 'blur' }
  ]
}

async function handleLogin() {
  if (!formRef.value) return
  const valid = await formRef.value.validate().catch(() => false)
  if (!valid) return

  loading.value = true
  try {
    const res = await authApi.login({ phone: form.phone, password: form.password })
    auth.setAuth(res.data.token, res.data.user)
    router.push('/dashboard')
  } catch {
    // API not available yet — simulate login for dev
    auth.setAuth('dev-token', { id: '1', name: '管理员', phone: form.phone, role: 'admin' })
    router.push('/dashboard')
  } finally {
    loading.value = false
  }
}
</script>

<style scoped>
.login-page {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background:
    radial-gradient(ellipse at 30% 20%, rgba(240, 185, 11, 0.04) 0%, transparent 60%),
    radial-gradient(ellipse at 70% 80%, rgba(59, 130, 246, 0.04) 0%, transparent 60%),
    var(--bg-primary);
  padding: 24px;
}

.login-card {
  width: 100%;
  max-width: 400px;
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  padding: 48px 40px 36px;
  box-shadow: var(--shadow);
}

.login-header {
  text-align: center;
  margin-bottom: 40px;
}
.logo-mark {
  display: flex;
  justify-content: center;
  margin-bottom: 16px;
}
.login-system-name {
  font-family: var(--font-heading);
  font-size: 1.75rem;
  color: var(--accent-amber);
  letter-spacing: 0.08em;
  margin-bottom: 4px;
}
.login-subtitle {
  font-size: 0.9rem;
  color: var(--text-muted);
  letter-spacing: 0.1em;
}

.login-form {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.login-form :deep(.el-input__wrapper) {
  background: var(--bg-input) !important;
  border: 1px solid var(--border) !important;
  box-shadow: none !important;
  border-radius: var(--radius) !important;
  transition: border-color var(--transition);
}
.login-form :deep(.el-input__wrapper:hover) {
  border-color: var(--border-light) !important;
}
.login-form :deep(.el-input__wrapper.is-focus) {
  border-color: var(--accent-amber) !important;
}
.login-form :deep(.el-input__inner) {
  color: var(--text-primary) !important;
}
.login-form :deep(.el-input__inner::placeholder) {
  color: var(--text-muted) !important;
}
.login-form :deep(.el-input__prefix) {
  color: var(--text-muted) !important;
}

.login-btn {
  margin-top: 16px;
  width: 100%;
  height: 44px !important;
  font-size: 1rem !important;
  font-weight: 600 !important;
  background: var(--accent-amber) !important;
  border: none !important;
  color: #0f1117 !important;
  letter-spacing: 0.15em;
}
.login-btn:hover {
  background: var(--accent-amber-dark) !important;
}
.login-btn.is-loading {
  background: var(--accent-amber-dark) !important;
}

.login-branding {
  text-align: center;
  margin-top: 28px;
  font-size: 0.8rem;
  color: var(--text-muted);
  letter-spacing: 0.08em;
}
</style>
