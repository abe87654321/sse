<template>
  <div class="notifications-page">
    <div class="page-header">
      <h2 class="page-header-title">消息通知</h2>
      <div class="header-spacer"></div>
      <button class="btn-secondary btn-sm" @click="markAllRead" :disabled="unreadCount === 0">全部已读</button>
    </div>

    <div v-if="loading" class="card"><div class="empty-state"><div class="empty-state-text">加载中...</div></div></div>

    <div v-else-if="notifications.length > 0" class="notification-list">
      <div class="card notification-item" v-for="n in notifications" :key="n.id" :class="{ unread: !n.read_at }" @click="readNotification(n)">
        <div class="notif-icon-wrap" :style="{ background: n.read_at ? 'var(--bg-warm)' : typeConfig[n.type]?.bg }">
          <span class="notif-emoji">{{ typeConfig[n.type]?.emoji || '?' }}</span>
        </div>
        <div class="notif-content">
          <div class="notif-title">
            {{ n.title }}
            <span v-if="!n.read_at" class="notif-dot"></span>
          </div>
          <div class="notif-desc">{{ n.body }}</div>
          <div class="notif-time text-muted">{{ formatTime(n.created_at) }}</div>
        </div>
      </div>
    </div>

    <div v-else class="card"><div class="empty-state"><div class="empty-state-icon">&#128276;</div><div class="empty-state-text">暂无新消息</div></div></div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import api from '../api/index'

const notifications = ref<any[]>([])
const loading = ref(true)
const unreadCount = ref(0)

const typeConfig: Record<string, any> = {
  approved: { emoji: '&#9989;', bg: 'var(--accent-mint-bg)' },
  rejected: { emoji: '&#10060;', bg: 'var(--accent-coral-bg)' },
  paid: { emoji: '&#128179;', bg: 'var(--accent-violet-bg)' },
  broadcast: { emoji: '&#128197;', bg: 'var(--accent-sky-bg)' },
  reminder: { emoji: '&#9200;', bg: 'var(--accent-orange-bg)' },
  escalation: { emoji: '&#128680;', bg: 'var(--accent-coral-bg)' },
  welcome: { emoji: '&#128075;', bg: 'var(--accent-sky-bg)' },
  bounce_alert: { emoji: '&#9888;', bg: 'var(--accent-coral-bg)' },
}

function formatTime(dateStr: string) {
  if (!dateStr) return ''
  const d = new Date(dateStr)
  const now = new Date()
  const diff = now.getTime() - d.getTime()
  if (diff < 3600000) return `${Math.floor(diff / 60000)}分钟前`
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}小时前`
  return `${Math.floor(diff / 86400000)}天前`
}

async function fetchNotifications() {
  loading.value = true
  try {
    const res = await api.get('/notifications')
    notifications.value = res.data.results || []
    const ur = await api.get('/notifications/unread-count')
    unreadCount.value = ur.data.count
  } catch {} finally { loading.value = false }
}

async function readNotification(n: any) {
  if (n.read_at) return
  try {
    await api.put(`/notifications/${n.id}/read`)
    n.read_at = new Date().toISOString()
    unreadCount.value = Math.max(0, unreadCount.value - 1)
  } catch {}
}

async function markAllRead() {
  try {
    await api.put('/notifications/read-all')
    notifications.value.forEach(n => { if (!n.read_at) n.read_at = new Date().toISOString() })
    unreadCount.value = 0
  } catch {}
}

onMounted(fetchNotifications)
</script>

<style scoped>
.notifications-page { max-width: 720px; }
.header-spacer { flex: 1; }
.notification-list { display: flex; flex-direction: column; gap: 10px; }
.notification-item { display: flex; gap: 16px; padding: 18px 22px; cursor: pointer; transition: all var(--transition); }
.notification-item:hover { border-color: var(--accent-coral); }
.notification-item.unread { border-left: 3px solid var(--accent-coral); background: var(--accent-coral-bg); border-color: transparent; }
.notif-icon-wrap { width: 42px; height: 42px; border-radius: var(--radius-sm); display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
.notif-emoji { font-size: 1.2rem; }
.notif-content { flex: 1; min-width: 0; }
.notif-title { font-weight: 600; font-size: 0.92rem; color: var(--text-primary); display: flex; align-items: center; gap: 8px; margin-bottom: 4px; }
.notif-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--accent-coral); flex-shrink: 0; }
.notif-desc { font-size: 0.85rem; color: var(--text-secondary); line-height: 1.5; margin-bottom: 4px; }
.notif-time { font-size: 0.75rem; }
</style>
