<template>
  <div class="admin-page">
    <div class="page-header">
      <h2 class="page-header-title">系统管理</h2>
    </div>

    <div class="stats-grid">
      <div class="card admin-stat">
        <div class="admin-stat-value">{{ users.length }}</div>
        <div class="admin-stat-label">用户总数</div>
      </div>
      <div class="card admin-stat">
        <div class="admin-stat-value" style="color: var(--accent-sky);">2</div>
        <div class="admin-stat-label">管理员</div>
      </div>
      <div class="card admin-stat">
        <div class="admin-stat-value" style="color: var(--accent-orange);">3</div>
        <div class="admin-stat-label">部门</div>
      </div>
    </div>

    <div class="card" style="margin-top: 20px; padding: 0; overflow: hidden;">
      <div style="padding: 18px 24px; border-bottom: 1px solid var(--border-light); display: flex; align-items: center; justify-content: space-between;">
        <h3 class="font-heading" style="font-size: 1rem; letter-spacing: 0.03em;">用户列表</h3>
        <button class="btn-primary btn-sm">添加用户</button>
      </div>
      <table class="data-table">
        <thead>
          <tr>
            <th>用户</th>
            <th>手机号</th>
            <th>角色</th>
            <th>部门</th>
            <th>状态</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="user in users" :key="user.id">
            <td>
              <div style="display: flex; align-items: center; gap: 10px;">
                <div class="avatar" :class="`avatar-${user.avatarColor}`" style="width:32px;height:32px;font-size:0.75rem;">{{ user.initial }}</div>
                <span>{{ user.name }}</span>
              </div>
            </td>
            <td class="text-secondary">{{ user.phone }}</td>
            <td><span class="badge" :class="user.role === 'admin' ? 'badge-approved' : 'badge-pending'">{{ user.roleLabel }}</span></td>
            <td class="text-secondary">{{ user.department }}</td>
            <td><span class="badge" :class="user.active ? 'badge-approved' : 'badge-draft'">{{ user.active ? '启用' : '禁用' }}</span></td>
            <td class="col-action">
              <span class="table-link">编辑</span>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<script setup lang="ts">
const users = [
  { id: '1', name: '张主管', phone: '138****8888', role: 'admin', roleLabel: '管理员', department: '财务部', active: true, initial: '张', avatarColor: 'coral' },
  { id: '2', name: '李经理', phone: '139****9999', role: 'admin', roleLabel: '管理员', department: '技术部', active: true, initial: '李', avatarColor: 'sky' },
  { id: '3', name: '王员工', phone: '137****7777', role: 'user', roleLabel: '普通用户', department: '技术部', active: true, initial: '王', avatarColor: 'orange' },
  { id: '4', name: '赵员工', phone: '136****6666', role: 'user', roleLabel: '普通用户', department: '市场部', active: false, initial: '赵', avatarColor: 'violet' },
  { id: '5', name: '钱员工', phone: '135****5555', role: 'user', roleLabel: '普通用户', department: '销售部', active: true, initial: '钱', avatarColor: 'mint' },
]
</script>

<style scoped>
.admin-page { max-width: 900px; }

.stats-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 16px;
}
.admin-stat { text-align: center; padding: 20px 16px; }
.admin-stat-value { font-size: 1.6rem; font-weight: 700; color: var(--accent-coral); }
.admin-stat-label { font-size: 0.8rem; color: var(--text-muted); margin-top: 4px; }

@media (max-width: 600px) {
  .stats-grid { grid-template-columns: 1fr; }
}
</style>
