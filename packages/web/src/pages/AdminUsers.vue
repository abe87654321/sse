<template>
  <div class="admin-users-page">
    <div class="page-header">
      <h2 class="page-header-title">用户管理</h2>
    </div>

    <!-- 角色统计卡片 -->
    <div class="stats-grid">
      <div
        v-for="stat in roleStats"
        :key="stat.role"
        class="stat-card"
        :class="{ 'stat-zero': stat.count === 0 }"
      >
        <div class="stat-icon" :class="`stat-icon-${stat.role}`">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path v-if="stat.role === 'admin'" d="M12 8c-2.2 0-4 1.8-4 4s1.8 4 4 4 4-1.8 4-4-1.8-4-4-4zm0-6C6.5 2 2 6.5 2 12s4.5 10 10 10 10-4.5 10-10S17.5 2 12 2z"/>
            <path v-else-if="stat.role === 'dept_approver'" d="M9 11l3 3 8-8m-2 12v1a2 2 0 01-2 2H8a2 2 0 01-2-2V6a2 2 0 012-2h7l5 5v3"/>
            <path v-else-if="stat.role === 'finance'" d="M12 2a10 10 0 1010 10M12 2a10 10 0 0110 10M12 2v10m10 0a4 4 0 01-4 4H6a4 4 0 01-4-4m20 0a4 4 0 00-4-4H6a4 4 0 00-4 4"/>
            <circle v-else cx="12" cy="8" r="4" stroke="currentColor"/>
            <path v-if="stat.role === 'employee'" d="M2 22c0-5.5 4.5-10 10-10s10 4.5 10 10" stroke="currentColor"/>
          </svg>
        </div>
        <div class="stat-body">
          <div class="stat-label">{{ roleLabel(stat.role) }}</div>
          <div class="stat-count">{{ stat.count }}</div>
        </div>
      </div>
    </div>

    <!-- 状态标签页 -->
    <div class="tabs-bar">
      <button class="tab-btn" :class="{ active: activeTab === 'active' }" @click="switchTab('active')">
        活跃<span class="tab-count">{{ activeCount }}</span>
      </button>
      <button class="tab-btn" :class="{ active: activeTab === 'disabled' }" @click="switchTab('disabled')">
        已禁用<span class="tab-count">{{ disabledCount }}</span>
      </button>
      <button class="tab-btn" :class="{ active: activeTab === 'deleted' }" @click="switchTab('deleted')">
        已删除<span class="tab-count">{{ deletedCount }}</span>
      </button>
    </div>

    <!-- 工具栏 -->
    <div class="toolbar">
      <select v-model="roleFilter" class="filter-select" aria-label="按角色筛选">
        <option value="">全部角色</option>
        <option v-for="r in roleOptions" :key="r.value" :value="r.value">{{ r.label }}</option>
      </select>
      <input
        v-model.trim="searchQuery"
        type="text"
        placeholder="搜索姓名或手机号..."
        class="search-input"
        aria-label="搜索用户"
      />
      <div class="toolbar-spacer"></div>
      <button v-if="activeTab !== 'deleted'" class="btn-primary" @click="openCreateModal">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
          <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
        </svg>
        新建用户
      </button>
    </div>

    <!-- 用户表格 -->
    <div class="table-wrap">
      <table class="data-table">
        <thead>
          <tr>
            <th>姓名</th>
            <th>手机号</th>
            <th>邮箱</th>
            <th>部门</th>
            <th>角色</th>
            <th>状态</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="u in filteredUsers" :key="u.id">
            <td>{{ u.name }}</td>
            <td class="text-secondary">{{ u.phone }}</td>
            <td class="text-secondary">{{ u.email || '-' }}</td>
            <td class="text-secondary">{{ u.department || '-' }}</td>
            <td>
              <select
                :value="u.role"
                @change="changeRole(u, ($event.target as HTMLSelectElement).value)"
                class="inline-role-select"
                :aria-label="`修改 ${u.name} 的角色`"
              >
                <option v-for="r in roleOptions" :key="r.value" :value="r.value">{{ r.label }}</option>
              </select>
            </td>
            <td>
              <template v-if="u.status === 'deleted'">
                <span class="badge-deleted">已删除</span>
              </template>
              <template v-else>
                <label class="toggle-wrap" :title="u.status === 'active' ? '点击禁用' : '点击启用'">
                  <input
                    type="checkbox"
                    :checked="u.status === 'active'"
                    @change="toggleStatus(u)"
                    :aria-label="`${u.status === 'active' ? '禁用' : '启用'} ${u.name}`"
                  />
                  <span class="toggle-slider"></span>
                </label>
              </template>
            </td>
              <td class="col-action">
                <span v-if="u.status === 'deleted'" class="text-secondary" style="font-size:0.85rem">已删除于 {{ formatDate(u.deletedAt) }}</span>
                <template v-else>
                  <span class="table-link" role="button" tabindex="0" @click="openEditModal(u)" @keydown.enter="openEditModal(u)">编辑</span>
                  <div class="delete-dropdown">
                    <button class="table-link btn-delete" @click="toggleDeleteMenu(u.id)">删除</button>
                    <div v-if="deleteMenuOpen === u.id" class="delete-menu" @mouseleave="deleteMenuOpen = null">
                      <button @click="confirmDelete(u, 'hard')" :disabled="userRelatedCounts[u.id] > 0" :title="userRelatedCounts[u.id] > 0 ? '存在业务数据，无法硬删除' : ''">硬删除（无业务数据时可用）</button>
                      <button @click="confirmDelete(u, 'soft')">软删除（员工离职/失效）</button>
                      <button @click="confirmDelete(u, 'cascade')">级联删除（彻底清除所有数据）</button>
                    </div>
                  </div>
                </template>
              </td>
          </tr>
          <tr v-if="filteredUsers.length === 0">
            <td colspan="7">
              <div class="empty-state">
                <div class="empty-state-icon">👥</div>
                <div class="empty-state-text">{{ users.length === 0 ? '暂无用户数据' : '无匹配结果' }}</div>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- 分页 -->
    <div class="pagination">
      <span class="pagination-info">共 {{ filteredUsers.length }} 条记录</span>
    </div>

    <!-- 新建/编辑弹窗 -->
    <Teleport to="body">
      <div
        v-if="showModal"
        class="modal-overlay"
        @click.self="closeModal"
        @keydown.escape="closeModal"
      >
        <div class="modal" role="dialog" :aria-modal="true" :aria-label="isEditing ? '编辑用户' : '新建用户'">
          <div class="modal-header">
            <h3 class="modal-title font-heading">{{ isEditing ? '编辑用户' : '新建用户' }}</h3>
            <button class="modal-close" @click="closeModal" aria-label="关闭">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
              </svg>
            </button>
          </div>

          <form class="modal-body" @submit.prevent="submitForm">
            <div class="field">
              <label for="user-name">姓名 <span class="required">*</span></label>
              <input
                id="user-name"
                ref="nameInputRef"
                v-model.trim="form.name"
                type="text"
                required
                placeholder="请输入姓名"
                maxlength="50"
              />
              <span v-if="formErrors.name" class="error">{{ formErrors.name }}</span>
            </div>

            <div class="field">
              <label for="user-phone">手机号 <span class="required">*</span></label>
              <input
                id="user-phone"
                v-model.trim="form.phone"
                type="tel"
                required
                placeholder="请输入手机号"
                maxlength="11"
              />
              <span v-if="formErrors.phone" class="error">{{ formErrors.phone }}</span>
            </div>

            <div class="field">
              <label for="user-email">邮箱</label>
              <input
                id="user-email"
                v-model.trim="form.email"
                type="email"
                placeholder="请输入邮箱"
              />
            </div>

            <div class="field">
              <label for="user-department">部门</label>
              <select id="user-department" v-model="form.department">
                <option value="">请选择部门</option>
                <option v-for="d in departments" :key="d" :value="d">{{ d }}</option>
              </select>
            </div>

            <div class="field">
              <label for="user-role">角色 <span class="required">*</span></label>
              <select id="user-role" v-model="form.role" required>
                <option value="">请选择角色</option>
                <option v-for="r in roleOptions" :key="r.value" :value="r.value">{{ r.label }}</option>
              </select>
              <span v-if="formErrors.role" class="error">{{ formErrors.role }}</span>
            </div>

            <div class="modal-actions">
              <button type="button" class="btn-secondary" @click="closeModal">取消</button>
              <button type="submit" class="btn-primary" :disabled="submitting">
                {{ submitting ? '提交中...' : (isEditing ? '保存修改' : '创建用户') }}
              </button>
            </div>
          </form>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted, nextTick } from 'vue'
import api from '../api/index'

const roleOptions = [
  { value: 'admin', label: '管理员' },
  { value: 'dept_approver', label: '部门审批人' },
  { value: 'finance', label: '财务' },
  { value: 'employee', label: '员工' }
]
const roleWhitelist = roleOptions.map(r => r.value)

const departments = ['技术部', '产品部', '市场部', '销售部', '财务部', '人事部', '行政部']

const roleLabel = (r: string) => {
  const found = roleOptions.find(o => o.value === r)
  return found ? found.label : r
}

const users = ref<any[]>([])
const roleStats = ref<{ role: string; count: number }[]>([])
const searchQuery = ref('')
const roleFilter = ref('')

const activeTab = ref<'active' | 'disabled' | 'deleted'>('active')
const deleteMenuOpen = ref<string | null>(null)
const userRelatedCounts = ref<Record<string, number>>({})
const activeCount = ref(0)
const disabledCount = ref(0)
const deletedCount = ref(0)
const allUsers = ref<any[]>([])

const showModal = ref(false)
const isEditing = ref(false)
const editingId = ref<string | null>(null)
const submitting = ref(false)
const nameInputRef = ref<HTMLInputElement | null>(null)

const form = reactive({ name: '', phone: '', email: '', department: '', role: '' })
const formErrors = reactive({ name: '', phone: '', role: '' })

const filteredUsers = computed(() => {
  let list = users.value
  if (roleFilter.value) {
    list = list.filter(u => u.role === roleFilter.value)
  }
  if (searchQuery.value) {
    const kw = searchQuery.value.toLowerCase()
    list = list.filter(u => u.name.toLowerCase().includes(kw) || u.phone.includes(kw))
  }
  return list
})

onMounted(() => {
  fetchStats()
  fetchUsers()
})

async function fetchStats() {
  try {
    const { data } = await api.get('/admin/users/validate')
    roleStats.value = data.stats || data || []
  } catch {
    roleStats.value = roleOptions.map(r => ({ role: r.value, count: 0 }))
  }
}

async function fetchUsers() {
  try {
    const { data: activeData } = await api.get('/admin/users')
    const activeUsers = activeData.users || activeData || []
    const { data: deletedData } = await api.get('/admin/users', { params: { include: 'deleted' } })
    const deletedUsers = deletedData.users || deletedData || []

    allUsers.value = [...activeUsers, ...deletedUsers]
    if (activeTab.value === 'deleted') {
      users.value = deletedUsers
    } else if (activeTab.value === 'disabled') {
      users.value = activeUsers.filter((u: any) => u.status === 'disabled')
    } else {
      users.value = activeUsers.filter((u: any) => u.status === 'active')
    }
    activeCount.value = activeUsers.filter((u: any) => u.status === 'active').length
    disabledCount.value = activeUsers.filter((u: any) => u.status === 'disabled').length
    deletedCount.value = deletedUsers.length
  } catch {
    users.value = []
  }
}

function validateForm() {
  let valid = true
  formErrors.name = ''
  formErrors.phone = ''
  formErrors.role = ''

  if (!form.name) {
    formErrors.name = '请输入姓名'
    valid = false
  }

  if (!form.phone) {
    formErrors.phone = '请输入手机号'
    valid = false
  } else if (!/^1\d{10}$/.test(form.phone)) {
    formErrors.phone = '手机号格式不正确（11位数字，以1开头）'
    valid = false
  }

  if (!form.role) {
    formErrors.role = '请选择角色'
    valid = false
  } else if (!roleWhitelist.includes(form.role)) {
    formErrors.role = '无效的角色类型'
    valid = false
  }

  return valid
}

function openCreateModal() {
  isEditing.value = false
  editingId.value = null
  form.name = ''
  form.phone = ''
  form.email = ''
  form.department = ''
  form.role = ''
  formErrors.name = ''
  formErrors.phone = ''
  formErrors.role = ''
  showModal.value = true
  nextTick(() => nameInputRef.value?.focus())
}

function openEditModal(u: any) {
  isEditing.value = true
  editingId.value = u.id
  form.name = u.name || ''
  form.phone = u.phone || ''
  form.email = u.email || ''
  form.department = u.department || ''
  form.role = u.role || ''
  formErrors.name = ''
  formErrors.phone = ''
  formErrors.role = ''
  showModal.value = true
  nextTick(() => nameInputRef.value?.focus())
}

function closeModal() {
  showModal.value = false
  isEditing.value = false
  editingId.value = null
}

async function submitForm() {
  if (!validateForm()) return

  submitting.value = true
  try {
    const payload = {
      name: form.name,
      phone: form.phone,
      email: form.email,
      department: form.department,
      role: form.role
    }

    if (isEditing.value && editingId.value) {
      await api.put(`/admin/users/${editingId.value}`, payload)
    } else {
      await api.post('/admin/users', payload)
    }

    closeModal()
    await Promise.all([fetchUsers(), fetchStats()])
  } catch (e: any) {
    const msg = e?.response?.data?.error || e?.message || '操作失败'
    formErrors.phone = msg
  } finally {
    submitting.value = false
  }
}

async function changeRole(u: any, newRole: string) {
  if (!roleWhitelist.includes(newRole)) return
  if (u.role === newRole) return
  const previousRole = u.role
  u.role = newRole
  try {
    await api.put(`/admin/users/${u.id}`, { role: newRole })
    fetchStats()
  } catch {
    u.role = previousRole
  }
}

async function toggleStatus(u: any) {
  if (u.status === 'deleted') return
  const newStatus = u.status === 'active' ? 'inactive' : 'active'
  const previousStatus = u.status
  u.status = newStatus
  try {
    await api.put(`/admin/users/${u.id}`, { status: newStatus })
    fetchStats()
  } catch {
    u.status = previousStatus
  }
}

function switchTab(tab: 'active' | 'disabled' | 'deleted') {
  activeTab.value = tab
  fetchUsers()
}

function toggleDeleteMenu(userId: string) {
  deleteMenuOpen.value = deleteMenuOpen.value === userId ? null : userId
}

async function confirmDelete(u: any, type: 'hard' | 'soft' | 'cascade') {
  deleteMenuOpen.value = null
  const confirmTexts: Record<string, string> = {
    hard: '确定要永久删除该用户？',
    soft: '确定要删除该用户？删除后该用户无法登录和查看。',
    cascade: '此操作将永久删除该用户及其所有报销单、审批记录、通知日志等数据，不可恢复！请输入用户名确认：'
  }
  if (type === 'cascade') {
    const input = prompt(confirmTexts[type])
    if (input !== u.name) {
      alert('用户名不匹配，操作已取消')
      return
    }
  } else {
    if (!confirm(confirmTexts[type])) return
  }
  try {
    await api.delete(`/admin/users/${u.id}`, { params: { type } })
    await Promise.all([fetchUsers(), fetchStats()])
  } catch (e: any) {
    const msg = e?.response?.data?.error?.message || e?.response?.data?.error || e?.message || '操作失败'
    alert(msg)
  }
}

function formatDate(d?: string) {
  if (!d) return ''
  return new Date(d).toLocaleDateString('zh-CN')
}
</script>

<style scoped>
.admin-users-page {
  max-width: 1100px;
}

/* 统计卡片网格 */
.stats-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 16px;
  margin-bottom: 24px;
}
.stat-card {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 20px;
  background: var(--bg-card);
  border: 1px solid var(--border-light);
  border-radius: var(--radius);
  box-shadow: var(--shadow-sm);
  transition: all var(--transition);
}
.stat-card:hover {
  box-shadow: var(--shadow);
  transform: translateY(-1px);
}
.stat-card.stat-zero {
  border-color: var(--accent-coral);
  box-shadow: 0 2px 12px rgba(255, 107, 107, 0.12);
}
.stat-icon {
  width: 48px;
  height: 48px;
  border-radius: var(--radius);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
.stat-icon-admin         { background: var(--accent-coral-bg); color: var(--accent-coral); }
.stat-icon-dept_approver  { background: var(--accent-sky-bg); color: var(--accent-sky); }
.stat-icon-finance        { background: var(--accent-mint-bg); color: var(--accent-mint); }
.stat-icon-employee       { background: var(--accent-violet-bg); color: var(--accent-violet); }
.stat-body { flex: 1; min-width: 0; }
.stat-label {
  font-size: 0.78rem;
  color: var(--text-muted);
  margin-bottom: 4px;
}
.stat-count {
  font-size: 1.5rem;
  font-weight: 700;
  color: var(--text-primary);
  font-variant-numeric: tabular-nums;
}
.stat-zero .stat-count {
  color: var(--accent-coral);
}

/* 筛选选择框 */
.filter-select {
  width: auto;
  min-width: 130px;
}

/* 表格内角色选择 */
.inline-role-select {
  width: auto;
  padding: 4px 28px 4px 10px;
  font-size: 0.82rem;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background-color: var(--bg-input);
  background-image: url("data:image/svg+xml,%3Csvg width='10' height='6' viewBox='0 0 10 6' fill='none' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M1 1l4 4 4-4' stroke='%238c7a6f' stroke-width='1.5' stroke-linecap='round'/%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: right 8px center;
  appearance: none;
  color: var(--text-primary);
  cursor: pointer;
  transition: border-color var(--transition);
}
.inline-role-select:focus {
  border-color: var(--accent-coral);
  outline: none;
  box-shadow: 0 0 0 2px rgba(255, 107, 107, 0.12);
}

/* 切换开关 */
.toggle-wrap {
  position: relative;
  display: inline-block;
  width: 40px;
  height: 22px;
  cursor: pointer;
}
.toggle-wrap input {
  opacity: 0;
  width: 0;
  height: 0;
}
.toggle-slider {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: var(--border);
  border-radius: 11px;
  transition: background var(--transition);
}
.toggle-slider::before {
  content: '';
  position: absolute;
  height: 18px;
  width: 18px;
  left: 2px;
  bottom: 2px;
  background: #fff;
  border-radius: 50%;
  transition: transform var(--transition);
  box-shadow: 0 1px 3px rgba(0,0,0,0.12);
}
.toggle-wrap input:checked + .toggle-slider {
  background: var(--accent-coral);
}
.toggle-wrap input:checked + .toggle-slider::before {
  transform: translateX(18px);
}
.toggle-wrap input:focus-visible + .toggle-slider {
  box-shadow: 0 0 0 3px rgba(255, 107, 107, 0.2);
}

/* 弹窗覆盖层 */
.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(45, 36, 32, 0.4);
  backdrop-filter: blur(4px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 200;
  animation: fadeIn 0.2s ease;
}
@keyframes fadeIn {
  from { opacity: 0; }
  to { opacity: 1; }
}

.modal {
  background: var(--bg-card);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-lg);
  width: 90%;
  max-width: 480px;
  max-height: 90vh;
  overflow-y: auto;
  animation: modalIn 0.25s cubic-bezier(0.4, 0, 0.2, 1);
}
@keyframes modalIn {
  from { opacity: 0; transform: scale(0.95) translateY(8px); }
  to { opacity: 1; transform: scale(1) translateY(0); }
}

.modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 20px 24px;
  border-bottom: 1px solid var(--border-light);
}
.modal-title {
  font-size: 1.1rem;
  color: var(--text-primary);
  letter-spacing: 0.03em;
}
.modal-close {
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-secondary);
  transition: all var(--transition);
}
.modal-close:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.modal-body {
  padding: 20px 24px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.required {
  color: var(--accent-coral);
}

.modal-actions {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
  margin-top: 8px;
}

@media (max-width: 768px) {
  .stats-grid {
    grid-template-columns: repeat(2, 1fr);
  }
}
@media (max-width: 480px) {
  .stats-grid {
    grid-template-columns: 1fr;
  }
}

.tabs-bar {
  display: flex;
  gap: 4px;
  margin-bottom: 16px;
  border-bottom: 1px solid var(--border-light);
  padding-bottom: 0;
}
.tab-btn {
  padding: 8px 16px;
  background: none;
  border: none;
  border-bottom: 2px solid transparent;
  color: var(--text-secondary);
  font-size: 0.9rem;
  cursor: pointer;
  transition: all var(--transition);
  display: flex;
  align-items: center;
  gap: 6px;
}
.tab-btn:hover {
  color: var(--text-primary);
  border-bottom-color: var(--border);
}
.tab-btn.active {
  color: var(--accent-coral);
  border-bottom-color: var(--accent-coral);
  font-weight: 600;
}
.tab-count {
  font-size: 0.75rem;
  background: var(--bg-hover);
  padding: 1px 8px;
  border-radius: 10px;
  font-weight: 500;
}
.delete-dropdown {
  position: relative;
  display: inline-block;
}
.btn-delete {
  color: var(--accent-coral);
  opacity: 0.7;
}
.btn-delete:hover {
  opacity: 1;
}
.delete-menu {
  position: absolute;
  right: 0;
  top: 100%;
  background: var(--bg-card);
  border: 1px solid var(--border-light);
  border-radius: var(--radius);
  box-shadow: var(--shadow-lg);
  z-index: 50;
  min-width: 220px;
  padding: 4px 0;
}
.delete-menu button {
  display: block;
  width: 100%;
  padding: 8px 16px;
  text-align: left;
  background: none;
  border: none;
  color: var(--text-primary);
  font-size: 0.85rem;
  cursor: pointer;
  transition: background var(--transition);
}
.delete-menu button:hover:not(:disabled) {
  background: var(--bg-hover);
}
.delete-menu button:disabled {
  color: var(--text-muted);
  cursor: not-allowed;
}
.badge-deleted {
  display: inline-block;
  padding: 2px 8px;
  border-radius: var(--radius-sm);
  background: var(--bg-hover);
  color: var(--text-muted);
  font-size: 0.8rem;
}
</style>
