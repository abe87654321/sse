<template>
  <div class="approvals-page">
    <div class="page-header">
      <h2 class="page-header-title">审批管理</h2>
    </div>

    <div class="approval-list" v-if="approvals.length > 0">
      <div class="card approval-card" v-for="item in approvals" :key="item.id">
        <div class="approval-main" @click="$router.push(`/expenses/${item.id}`)">
          <div class="avatar avatar-orange" style="width:42px;height:42px;">{{ item.userInitial }}</div>
          <div class="approval-info">
            <div class="approval-header">
              <span class="approval-title">{{ item.title }}</span>
              <span class="badge" :class="`badge-${item.status}`">{{ item.statusLabel }}</span>
            </div>
            <div class="approval-meta">
              <span>{{ item.submittedBy }}</span>
              <span class="dot-sep">·</span>
              <span>&#165;{{ item.amount.toLocaleString() }}</span>
              <span class="dot-sep">·</span>
              <span>{{ item.date }}</span>
            </div>
          </div>
        </div>
        <div class="approval-actions">
          <button class="btn-primary btn-sm" style="background: linear-gradient(135deg, var(--accent-mint), #69db7c);">通过</button>
          <button class="btn-danger btn-sm">驳回</button>
        </div>
      </div>
    </div>

    <div v-else class="card">
      <div class="empty-state">
        <div class="empty-state-icon">&#9989;</div>
        <div class="empty-state-text">暂无待审批项</div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
const approvals = [
  { id: '3', title: '招待费-客户用餐', submittedBy: '张三', amount: 890, status: 'pending', statusLabel: '待审批', userInitial: '张', date: '2024-07-04' },
  { id: '6', title: '通讯费报销-6月份话费', submittedBy: '李四', amount: 320, status: 'pending', statusLabel: '待审批', userInitial: '李', date: '2024-07-05' },
  { id: '7', title: '办公设备维修费', submittedBy: '王五', amount: 1500, status: 'pending', statusLabel: '待审批', userInitial: '王', date: '2024-07-05' },
]
</script>

<style scoped>
.approvals-page { max-width: 800px; }
.approval-list { display: flex; flex-direction: column; gap: 12px; }

.approval-card {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 18px 22px;
  cursor: default;
}
.approval-main {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 14px;
  cursor: pointer;
}
.approval-info { flex: 1; min-width: 0; }
.approval-header { display: flex; align-items: center; gap: 10px; margin-bottom: 4px; }
.approval-title { font-weight: 600; font-size: 0.95rem; color: var(--text-primary); }
.approval-meta {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 0.8rem;
  color: var(--text-muted);
}
.dot-sep { color: var(--border); }
.approval-actions { display: flex; gap: 8px; flex-shrink: 0; }
</style>
