<template>
  <div class="card forbidden-card">
    <div class="forbidden-icon">&#128274;</div>
    <h2 class="forbidden-title font-heading">无权访问</h2>
    <p class="forbidden-text">
      你当前的角色（{{ currentRole }}）无权访问{{ targetSuffix }}。
      如需访问，请联系系统管理员调整权限。
    </p>
    <div class="forbidden-actions">
      <button class="btn-primary" @click="goDashboard">返回工作台</button>
      <button class="btn-secondary" @click="goBack">返回上一页</button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { roleLabel } from '@/permissions'

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()

const currentRole = computed(() => roleLabel(auth.user?.role))

const targetSuffix = computed(() => {
  const from = typeof route.query.from === 'string' ? route.query.from : ''
  if (!from) return '该页面'
  const resolved = router.resolve(from)
  const title = resolved.meta?.title as string | undefined
  return title ? `“${title}”` : from
})

function goDashboard() {
  router.push('/dashboard')
}

function goBack() {
  if (window.history.length > 1) router.back()
  else router.push('/dashboard')
}
</script>

<style scoped>
.forbidden-card {
  max-width: 560px;
  margin: 48px auto;
  padding: 40px 32px;
  text-align: center;
}
.forbidden-icon {
  font-size: 2.4rem;
  margin-bottom: 12px;
}
.forbidden-title {
  font-size: 1.4rem;
  color: var(--text-primary);
  margin-bottom: 12px;
}
.forbidden-text {
  font-size: 0.95rem;
  line-height: 1.7;
  color: var(--text-secondary);
  margin-bottom: 24px;
}
.forbidden-actions {
  display: flex;
  gap: 12px;
  justify-content: center;
  flex-wrap: wrap;
}
</style>
