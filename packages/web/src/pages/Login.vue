<template>
  <div class="login-page">
    <div class="login-card">
      <div class="login-header">
        <div class="login-logo">
          <svg width="56" height="56" viewBox="0 0 56 56" fill="none">
            <rect width="56" height="56" rx="14" fill="url(#loginGrad)" />
            <g transform="translate(10, 8) scale(2.3)" stroke="#fff" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">
              <path d="M4 2h8a1 1 0 011 1v14a1 1 0 01-1 1H1a1 1 0 01-1-1V6l4-4z" fill="none" />
              <path d="M4 2v4H0" fill="none" />
              <line x1="3" y1="8" x2="10" y2="8" />
              <line x1="3" y1="11" x2="8" y2="11" />
              <line x1="3" y1="14" x2="6" y2="14" />
            </g>
            <defs>
              <linearGradient id="loginGrad" x1="0" y1="0" x2="56" y2="56">
                <stop stop-color="#ff6b6b"/>
                <stop offset="1" stop-color="#ffa94d"/>
              </linearGradient>
            </defs>
          </svg>
        </div>
        <h1 class="login-system-name font-heading">SSE 智能报销</h1>
        <p class="login-subtitle">高效办公 · 温暖同行</p>
      </div>

      <form class="login-form" @submit.prevent="handleLogin">
        <div class="field">
          <label>手机号</label>
          <input
            v-model="form.phone"
            type="tel"
            placeholder="请输入手机号"
            maxlength="11"
            autocomplete="tel"
          />
          <span v-if="errors.phone" class="error">{{ errors.phone }}</span>
        </div>

        <div class="field">
          <label>密码</label>
          <input
            v-model="form.password"
            type="password"
            placeholder="请输入密码"
            autocomplete="current-password"
          />
          <span v-if="errors.password" class="error">{{ errors.password }}</span>
        </div>

        <button class="btn-primary login-btn" :disabled="loading">
          {{ loading ? '登录中...' : '登 录' }}
        </button>
      </form>

      <p class="login-footer-text">忘记密码？请联系管理员重置</p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { authApi } from '@/api/auth'

const router = useRouter()
const auth = useAuthStore()
const loading = ref(false)
const errors = reactive({ phone: '', password: '' })

const form = reactive({ phone: '', password: '' })

async function handleLogin() {
  errors.phone = ''
  errors.password = ''

  if (!form.phone) { errors.phone = '请输入手机号'; return }
  if (!/^1\d{10}$/.test(form.phone)) { errors.phone = '手机号格式不正确'; return }
  if (!form.password) { errors.password = '请输入密码'; return }
  if (form.password.length < 6) { errors.password = '密码至少6位'; return }

  loading.value = true
  try {
    const res = await authApi.login({ phone: form.phone, password: form.password })
    auth.setAuth(res.data.accessToken, res.data.user)
    router.push('/dashboard')
  } catch (err: any) {
    const msg = err?.response?.data?.error?.message || '登录失败'
    errors.phone = msg
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
  background: linear-gradient(135deg, #fff0eb 0%, #ffe8e0 30%, #fff5eb 70%, #fff8f5 100%);
  padding: 24px;
}

.login-card {
  width: 100%;
  max-width: 420px;
  background: var(--bg-card);
  border-radius: var(--radius-lg);
  padding: 52px 44px 40px;
  box-shadow: var(--shadow-lg);
  border: 1px solid var(--border-light);
}

.login-header {
  text-align: center;
  margin-bottom: 36px;
}
.login-logo { display: flex; justify-content: center; margin-bottom: 16px; }
.login-system-name {
  font-size: 1.6rem;
  color: var(--text-primary);
  letter-spacing: 0.06em;
  margin-bottom: 6px;
}
.login-subtitle {
  font-size: 0.88rem;
  color: var(--text-muted);
  letter-spacing: 0.08em;
}

.login-form {
  display: flex;
  flex-direction: column;
  gap: 18px;
}

.login-btn {
  margin-top: 8px;
  width: 100%;
  height: 46px;
  font-size: 1rem;
  letter-spacing: 0.15em;
}
.login-btn:disabled { opacity: 0.6; cursor: not-allowed; }

.login-footer-text {
  text-align: center;
  margin-top: 24px;
  font-size: 0.8rem;
  color: var(--text-muted);
}
</style>
