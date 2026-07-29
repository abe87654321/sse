<template>
  <div class="profile-page">
    <div class="page-header">
      <h2 class="page-header-title">个人中心</h2>
    </div>

    <div class="profile-grid">
      <div class="card profile-info-card">
        <div class="profile-avatar-section">
          <div
            class="avatar avatar-coral"
            :style="avatarPreview ? { backgroundImage: `url(${avatarPreview})`, backgroundSize: 'cover', backgroundPosition: 'center' } : {}"
            style="width:72px;height:72px;font-size:1.8rem;cursor:pointer;"
            @click="triggerAvatarInput"
          >{{ avatarPreview ? '' : userInitial }}</div>
          <input ref="avatarFileInput" type="file" accept="image/png,image/jpeg" style="display:none" @change="handleAvatarChange" />
          <button class="btn-secondary btn-sm" style="margin-top:12px;" @click="triggerAvatarInput">更换头像</button>
        </div>
        <div class="profile-details">
          <div class="info-row">
            <span class="info-row-label">姓名</span>
            <span class="info-row-value">{{ auth.user?.name }}</span>
          </div>
          <div class="info-row">
            <span class="info-row-label">手机号</span>
            <span class="info-row-value">{{ auth.user?.phone }}</span>
          </div>
          <div class="info-row">
            <span class="info-row-label">邮箱</span>
            <span class="info-row-value">{{ auth.user?.email || '未设置' }}</span>
          </div>
          <div class="info-row">
            <span class="info-row-label">部门</span>
            <span class="info-row-value">{{ auth.user?.department || '未分配' }}</span>
          </div>
          <div class="info-row">
            <span class="info-row-label">角色</span>
            <span class="info-row-value">{{ roleLabel }}</span>
          </div>
        </div>
      </div>

      <div class="card">
        <h3 class="form-section-title font-heading">修改信息</h3>
        <div class="form-grid">
          <div class="field">
            <label>姓名</label>
            <input v-model="profileForm.name" type="text" placeholder="请输入姓名" />
          </div>
          <div class="field">
            <label>手机号</label>
            <input v-model="profileForm.phone" type="tel" placeholder="请输入手机号" />
          </div>
          <div class="field full">
            <label>邮箱</label>
            <input v-model="profileForm.email" type="email" placeholder="请输入邮箱" />
          </div>
        </div>
        <div v-if="profileError" class="error-msg">{{ profileError }}</div>
        <div v-if="profileSuccess" class="success-msg">{{ profileSuccess }}</div>
        <div style="margin-top: 18px;">
          <button class="btn-primary btn-sm" @click="handleUpdateProfile" :disabled="profileLoading">
            {{ profileLoading ? '保存中...' : '保存修改' }}
          </button>
        </div>
      </div>

      <div class="card">
        <h3 class="form-section-title font-heading">修改密码</h3>
        <div class="form-grid">
          <div class="field">
            <label>当前密码</label>
            <input v-model="passwordForm.oldPassword" type="password" placeholder="请输入当前密码" />
          </div>
          <div class="field">
            <label>新密码</label>
            <input v-model="passwordForm.newPassword" type="password" placeholder="请输入新密码" />
          </div>
          <div class="field">
            <label>确认密码</label>
            <input v-model="passwordForm.confirmPassword" type="password" placeholder="请再次输入新密码" />
          </div>
        </div>
        <div v-if="passwordError" class="error-msg">{{ passwordError }}</div>
        <div v-if="passwordSuccess" class="success-msg">{{ passwordSuccess }}</div>
        <div style="margin-top: 18px;">
          <button class="btn-primary btn-sm" @click="handleChangePassword" :disabled="passwordLoading">
            {{ passwordLoading ? '更新中...' : '更新密码' }}
          </button>
        </div>
      </div>

      <div class="card">
        <h3 class="form-section-title font-heading">通知设置</h3>
        <div class="notify-section">
          <div class="notify-group">
            <h4>SMS 通知</h4>
            <label><input type="checkbox" v-model="notifyPrefs.sms.reminder" /> 审批提醒</label>
            <label><input type="checkbox" v-model="notifyPrefs.sms.rejected" /> 驳回通知</label>
            <label><input type="checkbox" v-model="notifyPrefs.sms.paid" /> 付款通知</label>
          </div>
          <div class="notify-group">
            <h4>邮件通知</h4>
            <label><input type="checkbox" v-model="notifyPrefs.email.rejected" /> 驳回通知</label>
            <label><input type="checkbox" v-model="notifyPrefs.email.paid" /> 付款通知</label>
          </div>
          <div class="notify-group">
            <h4>广播消息</h4>
            <label><input type="checkbox" v-model="notifyPrefs.broadcast" /> 接收管理员广播消息</label>
          </div>
        </div>
        <div style="margin-top:16px">
          <button class="btn-primary btn-sm" @click="saveNotifyPrefs">保存通知设置</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, reactive, ref, onMounted } from 'vue'
import { useAuthStore } from '@/stores/auth'
import { authApi } from '@/api/auth'
import api from '../api/index'

const auth = useAuthStore()
const userInitial = computed(() => auth.user?.name?.charAt(0)?.toUpperCase() || 'U')
const avatarFileInput = ref<HTMLInputElement | null>(null)
const avatarPreview = ref(auth.user?.avatarUrl ?  `/api/auth/profile/avatar?userId=${auth.user?.id}` : '')

function triggerAvatarInput() {
  avatarFileInput.value?.click()
}

async function handleAvatarChange(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0]
  if (!file) return
  try {
    const res = await authApi.uploadAvatar(file)
    const url =  `/api/auth/profile/avatar?userId=${auth.user?.id}`
    avatarPreview.value = url
    if (auth.user) {
      auth.user.avatarUrl = res.data.avatarUrl
      localStorage.setItem('user', JSON.stringify(auth.user))
    }
  } catch (err: any) {
    alert(err?.response?.data?.error?.message || '上传失败')
  }
}

const roleLabels: Record<string, string> = {
  admin: '系统管理员',
  finance: '财务',
  dept_approver: '部门审批人',
  employee: '普通员工',
}
const roleLabel = computed(() => roleLabels[auth.user?.role || ''] || auth.user?.role || '-')

const profileForm = reactive({
  name: auth.user?.name || '',
  phone: auth.user?.phone || '',
  email: auth.user?.email || '',
})

const profileLoading = ref(false)
const profileError = ref('')
const profileSuccess = ref('')

const passwordForm = reactive({
  oldPassword: '',
  newPassword: '',
  confirmPassword: '',
})

const passwordLoading = ref(false)
const passwordError = ref('')
const passwordSuccess = ref('')

const notifyPrefs = reactive({
  sms: { reminder: true, rejected: true, paid: false },
  email: { rejected: true, paid: false },
  broadcast: true,
})

async function fetchNotifyPrefs() {
  try {
    const res = await api.get('/user/notify-prefs')
    if (res.data?.sms) Object.assign(notifyPrefs, res.data)
  } catch {}
}

async function saveNotifyPrefs() {
  try {
    await api.put('/user/notify-prefs', { notify_prefs: { ...notifyPrefs } })
    profileSuccess.value = '通知设置已保存'
  } catch {}
}

onMounted(fetchNotifyPrefs)

async function handleUpdateProfile() {
  profileError.value = ''
  profileSuccess.value = ''

  if (!profileForm.name.trim()) {
    profileError.value = '请输入姓名'
    return
  }

  profileLoading.value = true
  try {
    await authApi.updateProfile({ name: profileForm.name.trim(), email: profileForm.email.trim() })
    if (auth.user) {
      const updated = { ...auth.user, name: profileForm.name.trim(), email: profileForm.email.trim() }
      auth.user = updated
      localStorage.setItem('user', JSON.stringify(updated))
    }
    profileSuccess.value = '信息修改成功'
  } catch (e: any) {
    profileError.value = e?.response?.data?.error?.message || '保存失败'
  } finally {
    profileLoading.value = false
  }
}

async function handleChangePassword() {
  passwordError.value = ''
  passwordSuccess.value = ''

  if (!passwordForm.oldPassword) {
    passwordError.value = '请输入当前密码'
    return
  }
  if (!passwordForm.newPassword) {
    passwordError.value = '请输入新密码'
    return
  }
  if (passwordForm.newPassword.length < 6) {
    passwordError.value = '新密码至少6位'
    return
  }
  if (passwordForm.newPassword !== passwordForm.confirmPassword) {
    passwordError.value = '两次输入的密码不一致'
    return
  }

  passwordLoading.value = true
  try {
    await authApi.changePassword({
      oldPassword: passwordForm.oldPassword,
      newPassword: passwordForm.newPassword,
    })
    passwordForm.oldPassword = ''
    passwordForm.newPassword = ''
    passwordForm.confirmPassword = ''
    passwordSuccess.value = '密码修改成功'
  } catch (e: any) {
    passwordError.value = e?.response?.data?.error?.message || '修改密码失败'
  } finally {
    passwordLoading.value = false
  }
}
</script>

<style scoped>
.profile-page { max-width: 720px; }
.profile-grid { display: flex; flex-direction: column; gap: 20px; }

.profile-info-card {
  display: flex;
  gap: 32px;
  align-items: flex-start;
}
.profile-avatar-section {
  display: flex;
  flex-direction: column;
  align-items: center;
  flex-shrink: 0;
}
.profile-details { flex: 1; display: flex; flex-direction: column; gap: 14px; }
.info-row { display: flex; align-items: center; padding: 10px 0; border-bottom: 1px solid var(--border-light); }
.info-row:last-child { border-bottom: none; }
.info-row-label { width: 80px; font-size: 0.85rem; color: var(--text-muted); flex-shrink: 0; }
.info-row-value { font-size: 0.95rem; color: var(--text-primary); font-weight: 500; }

.form-section-title {
  font-size: 1rem;
  color: var(--text-primary);
  letter-spacing: 0.03em;
  margin-bottom: 16px;
  padding-bottom: 12px;
  border-bottom: 1px solid var(--border-light);
}

.error-msg {
  color: var(--accent-coral);
  background: var(--accent-coral-bg);
  padding: 8px 14px;
  border-radius: var(--radius-sm);
  font-size: 0.85rem;
  margin-bottom: 8px;
}

.success-msg {
  color: #2b7a3d;
  background: var(--accent-mint-bg);
  padding: 8px 14px;
  border-radius: var(--radius-sm);
  font-size: 0.85rem;
  margin-bottom: 8px;
}

.form-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
.field.full { grid-column: 1 / -1; }

.notify-section { display: flex; flex-direction: column; gap: 16px; }
.notify-group h4 { font-size: 0.88rem; color: var(--text-primary); margin-bottom: 8px; }
.notify-group label { display: flex; align-items: center; gap: 6px; font-size: 0.88rem; color: var(--text-secondary); cursor: pointer; margin-bottom: 4px; }
.notify-group label input[type="checkbox"] { width: auto; }

@media (max-width: 600px) {
  .profile-info-card { flex-direction: column; align-items: center; text-align: center; }
  .info-row { justify-content: center; }
  .form-grid { grid-template-columns: 1fr; }
}
</style>
