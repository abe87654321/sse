<template>
  <div class="notifications-page">
    <div class="page-header">
      <h2 class="page-header-title">消息通知</h2>
      <div class="header-spacer"></div>
      <button class="btn-secondary btn-sm">全部已读</button>
    </div>

    <div class="notification-list" v-if="notifications.length > 0">
      <div class="card notification-item" v-for="n in notifications" :key="n.id" :class="{ unread: !n.read }">
        <div class="notif-icon-wrap" :style="{ background: n.read ? 'var(--bg-warm)' : n.bg }">
          <span class="notif-emoji">{{ n.emoji }}</span>
        </div>
        <div class="notif-content">
          <div class="notif-title">
            {{ n.title }}
            <span v-if="!n.read" class="notif-dot"></span>
          </div>
          <div class="notif-desc">{{ n.desc }}</div>
          <div class="notif-time text-muted">{{ n.time }}</div>
        </div>
      </div>
    </div>

    <div v-else class="card">
      <div class="empty-state">
        <div class="empty-state-icon">&#128276;</div>
        <div class="empty-state-text">暂无新消息</div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
const notifications = [
  { id: '1', title: '审批通过', desc: '您的「差旅费报销-北京出差」已通过审批，等待付款。', time: '10分钟前', read: false, emoji: '&#9989;', bg: 'var(--accent-mint-bg)' },
  { id: '2', title: '审批驳回', desc: '您的「培训费-技术峰会门票」已被驳回，原因：票据不完整。', time: '2小时前', read: false, emoji: '&#10060;', bg: 'var(--accent-coral-bg)' },
  { id: '3', title: '付款完成', desc: '您的「办公用品采购」报销款已支付，请注意查收。', time: '1天前', read: true, emoji: '&#128179;', bg: 'var(--accent-violet-bg)' },
  { id: '4', title: '系统通知', desc: '7月份报销截止日期为7月31日，请及时提交。', time: '2天前', read: true, emoji: '&#128197;', bg: 'var(--accent-sky-bg)' },
]
</script>

<style scoped>
.notifications-page { max-width: 720px; }
.header-spacer { flex: 1; }

.notification-list { display: flex; flex-direction: column; gap: 10px; }

.notification-item {
  display: flex;
  gap: 16px;
  padding: 18px 22px;
  cursor: pointer;
  transition: all var(--transition);
}
.notification-item:hover { border-color: var(--accent-coral); }
.notification-item.unread {
  border-left: 3px solid var(--accent-coral);
  background: var(--accent-coral-bg);
  border-color: transparent;
}

.notif-icon-wrap {
  width: 42px;
  height: 42px;
  border-radius: var(--radius-sm);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
.notif-emoji { font-size: 1.2rem; }
.notif-content { flex: 1; min-width: 0; }
.notif-title { font-weight: 600; font-size: 0.92rem; color: var(--text-primary); display: flex; align-items: center; gap: 8px; margin-bottom: 4px; }
.notif-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--accent-coral);
  flex-shrink: 0;
}
.notif-desc { font-size: 0.85rem; color: var(--text-secondary); line-height: 1.5; margin-bottom: 4px; }
.notif-time { font-size: 0.75rem; }
</style>
