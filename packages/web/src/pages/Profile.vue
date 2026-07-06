<template>
  <div class="profile-page">
    <div class="page-header">
      <h2 class="page-header-title">个人中心</h2>
    </div>

    <div class="profile-grid">
      <div class="card profile-info-card">
        <div class="profile-avatar-section">
          <div class="avatar avatar-coral" style="width:72px;height:72px;font-size:1.8rem;">{{ userInitial }}</div>
          <button class="btn-secondary btn-sm" style="margin-top:12px;">更换头像</button>
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
            <input v-model="profileForm.phone" type="tel" placeholder="请输入手机号" disabled />
          </div>
          <div class="field full">
            <label>邮箱</label>
            <input v-model="profileForm.email" type="email" placeholder="请输入邮箱" />
          </div>
        </div>
        <div style="margin-top: 18px;">
          <button class="btn-primary btn-sm">保存修改</button>
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
        <div style="margin-top: 18px;">
          <button class="btn-primary btn-sm">更新密码</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, reactive } from 'vue'
import { useAuthStore } from '@/stores/auth'

const auth = useAuthStore()
const userInitial = computed(() => auth.user?.name?.charAt(0)?.toUpperCase() || 'U')
const roleLabel = computed(() => auth.user?.role === 'admin' ? '管理员' : '普通用户')

const profileForm = reactive({
  name: auth.user?.name || '',
  phone: auth.user?.phone || '',
  email: '',
})

const passwordForm = reactive({
  oldPassword: '',
  newPassword: '',
  confirmPassword: '',
})
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

.form-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
.field.full { grid-column: 1 / -1; }

@media (max-width: 600px) {
  .profile-info-card { flex-direction: column; align-items: center; text-align: center; }
  .info-row { justify-content: center; }
  .form-grid { grid-template-columns: 1fr; }
}
</style>
