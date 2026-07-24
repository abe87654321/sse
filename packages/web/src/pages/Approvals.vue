<template>
  <div class="approvals-page">
    <div class="page-header">
      <h2 class="page-header-title">审批管理</h2>
    </div>

    <div v-if="message" class="toast" :class="`toast-${messageType}`">{{ message }}</div>

    <div v-if="loading" class="card">
      <div class="empty-state">
        <div class="empty-state-text">加载中...</div>
      </div>
    </div>

    <div v-else-if="approvals.length > 0" class="approval-list">
      <div class="card approval-card" v-for="item in approvals" :key="item.id">
        <div class="approval-main" @click="$router.push(`/expenses/${item.reportId}`)">
          <div class="avatar avatar-orange" style="width:42px;height:42px;">{{ (item.applicantName || '?')[0] }}</div>
          <div class="approval-info">
            <div class="approval-header">
              <span class="approval-title">{{ item.title }}</span>
              <span class="badge" :class="`badge-${item.status || 'pending'}`">{{ statusLabels[item.status || 'pending'] }}</span>
            </div>
            <div class="approval-meta">
              <span>{{ item.applicantName }}</span>
              <span class="dot-sep">·</span>
              <span>&#165;{{ (item.totalAmount || 0).toLocaleString() }}</span>
              <span class="dot-sep">·</span>
              <span>{{ item.department }}</span>
            </div>
          </div>
        </div>
        <div class="approval-actions">
          <button
            class="btn-primary btn-sm"
            :disabled="acting === item.id"
            @click.stop="handleApprove(item)"
            style="background: linear-gradient(135deg, var(--accent-mint), #69db7c);"
          >{{ acting === item.id ? '处理中...' : '通过' }}</button>
          <button
            class="btn-danger btn-sm"
            :disabled="acting === item.id"
            @click.stop="handleReject(item)"
          >
            <template v-if="showRejectForm === item.id">确认</template>
            <template v-else>{{ acting === item.id ? '处理中...' : '驳回' }}</template>
          </button>
        </div>
        <div v-if="showRejectForm === item.id" class="reject-form" @click.stop>
          <textarea v-model="rejectComment" placeholder="请输入驳回原因" rows="2" class="form-textarea"></textarea>
          <div class="reject-form-actions">
            <button class="btn-secondary btn-sm" @click="showRejectForm = ''">取消</button>
            <button class="btn-danger btn-sm" @click="confirmReject(item)">确认驳回</button>
          </div>
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
import { ref, onMounted } from 'vue'
import api from '../api/index'

interface ApprovalItem {
  id: string
  reportId: string
  step: number
  approverId: string
  stepStartedAt: string
  result: string
  comment?: string
  approvedAt?: string
  serialNo: string
  title: string
  totalAmount: number
  userId: string
  applicantName: string
  department: string
  status?: string
}

const statusLabels: Record<string, string> = {
  draft: '草稿', pending: '待审批', approved: '已通过', rejected: '已驳回', paid: '已付款'
}

const approvals = ref<ApprovalItem[]>([])
const loading = ref(true)
const acting = ref('')
const showRejectForm = ref('')
const rejectComment = ref('')

const message = ref('')
const messageType = ref<'success' | 'error' | 'warning'>('success')
let messageTimer: ReturnType<typeof setTimeout> | null = null

function showMessage(text: string, type: 'success' | 'error' | 'warning' = 'success') {
  message.value = text
  messageType.value = type
  if (messageTimer) clearTimeout(messageTimer)
  messageTimer = setTimeout(() => { message.value = '' }, 3000)
}

async function fetchApprovals() {
  loading.value = true
  try {
    const res = await api.get('/approvals/pending')
    approvals.value = (res.data || []).map((item: any) => ({
      ...item,
      status: 'pending',
    }))
  } catch {
    showMessage('加载审批列表失败', 'error')
  } finally {
    loading.value = false
  }
}

async function handleApprove(item: ApprovalItem) {
  acting.value = item.id
  try {
    await api.post(`/approvals/${item.reportId}/approve`, {})
    showMessage('审批通过')
    approvals.value = approvals.value.filter(a => a.reportId !== item.reportId)
  } catch (err: any) {
    showMessage(err.response?.data?.message || '操作失败', 'error')
  } finally {
    acting.value = ''
  }
}

function handleReject(item: ApprovalItem) {
  if (showRejectForm.value === item.id) {
    showRejectForm.value = ''
    return
  }
  showRejectForm.value = item.id
  rejectComment.value = ''
}

async function confirmReject(item: ApprovalItem) {
  if (!rejectComment.value.trim()) {
    showMessage('请填写驳回原因', 'warning')
    return
  }
  acting.value = item.id
  try {
    await api.post(`/approvals/${item.reportId}/reject`, { comment: rejectComment.value })
    showMessage('已驳回')
    approvals.value = approvals.value.filter(a => a.reportId !== item.reportId)
    showRejectForm.value = ''
    rejectComment.value = ''
  } catch (err: any) {
    showMessage(err.response?.data?.message || '操作失败', 'error')
  } finally {
    acting.value = ''
  }
}

onMounted(fetchApprovals)
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
  flex-wrap: wrap;
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

.reject-form {
  width: 100%;
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid var(--border);
}
.reject-form .form-textarea {
  width: 100%;
  min-height: 60px;
  padding: 8px 12px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-tertiary);
  color: var(--text-primary);
  resize: vertical;
  font-size: 0.9rem;
}
.reject-form-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 8px;
}

.toast {
  padding: 10px 16px;
  border-radius: 6px;
  margin-bottom: 12px;
  font-size: 0.9rem;
}
.toast-success { background: rgba(76, 175, 80, 0.15); color: #4caf50; border: 1px solid rgba(76, 175, 80, 0.3); }
.toast-error { background: rgba(244, 67, 54, 0.15); color: #f44336; border: 1px solid rgba(244, 67, 54, 0.3); }
.toast-warning { background: rgba(255, 152, 0, 0.15); color: #ff9800; border: 1px solid rgba(255, 152, 0, 0.3); }
</style>
