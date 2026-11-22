<template>
  <div class="admin-page">
    <div class="page-header"><h2 class="page-header-title">部门管理</h2></div>

    <div class="card" style="margin-bottom:20px">
      <h3 class="font-heading section-title">新增部门</h3>
      <div class="add-row">
        <input v-model="newDeptName" class="add-input" placeholder="输入部门名称" @keyup.enter="addDepartment" />
        <button class="btn-primary btn-sm" @click="addDepartment" :disabled="adding || !newDeptName.trim()">
          {{ adding ? '添加中...' : '添加' }}
        </button>
      </div>
      <p v-if="addError" class="form-error">{{ addError }}</p>
      <p v-else class="field-hint">新增部门后，可到用户管理里给用户分配该部门。</p>
    </div>

    <div class="card" style="padding:0;overflow:hidden">
      <div style="padding:18px 24px;border-bottom:1px solid var(--border-light)">
        <h3 class="font-heading" style="font-size:1rem">部门列表</h3>
      </div>
      <table class="data-table">
        <thead><tr><th>部门名称</th><th>用户数</th><th>操作</th></tr></thead>
        <tbody>
          <tr v-for="d in departments" :key="d.id">
            <td>
              <template v-if="editingId === d.id">
                <input v-model="editingName" class="add-input inline-input" @keyup.enter="saveRename" @keyup.esc="cancelRename" />
              </template>
              <template v-else>
                {{ d.name }}
                <span v-if="d.isProtected" class="badge-protected">系统保留</span>
              </template>
            </td>
            <td class="text-secondary">{{ d.userCount }}</td>
            <td>
              <div class="row-actions">
                <template v-if="editingId === d.id">
                  <button class="btn-primary btn-xs" @click="saveRename" :disabled="savingRename || !editingName.trim()">
                    {{ savingRename ? '保存中...' : '保存' }}
                  </button>
                  <button class="btn-secondary btn-xs" @click="cancelRename" :disabled="savingRename">取消</button>
                </template>
                <template v-else>
                  <button
                    class="btn-secondary btn-xs"
                    @click="startRename(d)"
                    :disabled="d.isProtected"
                    :title="d.isProtected ? '系统保留部门不可改名' : '重命名部门'"
                  >
                    重命名
                  </button>
                  <button
                    class="btn-danger btn-xs"
                    @click="deleteDepartment(d)"
                    :disabled="d.isProtected || d.userCount > 0"
                    :title="deleteHint(d)"
                  >
                    删除
                  </button>
                </template>
              </div>
            </td>
          </tr>
          <tr v-if="!loading && departments.length === 0">
            <td colspan="3" class="text-center text-secondary" style="padding:32px">暂无部门数据</td>
          </tr>
        </tbody>
      </table>
    </div>
    <p v-if="rowError" class="form-error">{{ rowError }}</p>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import api from '../api/index'

interface Department {
  id: string
  name: string
  userCount: number
  isProtected: boolean
}

const departments = ref<Department[]>([])
const loading = ref(false)
const newDeptName = ref('')
const adding = ref(false)
const addError = ref('')
const rowError = ref('')
const editingId = ref<string | null>(null)
const editingName = ref('')
const savingRename = ref(false)

onMounted(() => {
  fetchDepartments()
})

function errorMessage(e: any, fallback: string) {
  return e?.response?.data?.error?.message || e?.response?.data?.message || fallback
}

function deleteHint(d: Department) {
  if (d.isProtected) return '系统保留部门不可删除'
  if (d.userCount > 0) return '部门下仍有用户，请先调整用户部门'
  return '删除部门'
}

async function fetchDepartments() {
  loading.value = true
  try {
    const r = await api.get('/admin/departments')
    departments.value = Array.isArray(r.data) ? r.data : []
  } catch {
    departments.value = []
  } finally {
    loading.value = false
  }
}

async function addDepartment() {
  const name = newDeptName.value.trim()
  if (!name) return
  addError.value = ''
  rowError.value = ''
  adding.value = true
  try {
    await api.post('/admin/departments', { name })
    newDeptName.value = ''
    await fetchDepartments()
  } catch (e: any) {
    addError.value = errorMessage(e, '添加失败')
  } finally {
    adding.value = false
  }
}

function startRename(d: Department) {
  if (d.isProtected) return
  rowError.value = ''
  editingId.value = d.id
  editingName.value = d.name
}

function cancelRename() {
  editingId.value = null
  editingName.value = ''
}

async function saveRename() {
  if (!editingId.value) return
  const name = editingName.value.trim()
  if (!name) return
  rowError.value = ''
  savingRename.value = true
  try {
    await api.patch('/admin/departments/' + encodeURIComponent(editingId.value), { name })
    cancelRename()
    await fetchDepartments()
  } catch (e: any) {
    rowError.value = errorMessage(e, '重命名失败')
  } finally {
    savingRename.value = false
  }
}

async function deleteDepartment(d: Department) {
  if (d.isProtected || d.userCount > 0) return
  if (!confirm('确定删除部门 "' + d.name + '" 吗？')) return
  rowError.value = ''
  try {
    await api.delete('/admin/departments/' + encodeURIComponent(d.id))
    await fetchDepartments()
  } catch (e: any) {
    rowError.value = errorMessage(e, '删除失败')
  }
}
</script>

<style scoped>
.admin-page { max-width: 900px }
.section-title { font-size: 1rem; margin-bottom: 14px }
.add-row { display: flex; gap: 10px }
.add-input { flex: 1; padding: 10px 12px; border: 1px solid var(--border); border-radius: var(--radius-sm); background: var(--bg-input); color: var(--text-primary); font-family: var(--font-body); font-size: .875rem }
.inline-input { max-width: 220px }
.form-error { margin-top: 8px; font-size: .8rem; color: var(--accent-coral) }
.field-hint { margin-top: 8px; font-size: .78rem; color: var(--text-secondary) }
.badge-protected { margin-left: 8px; padding: 2px 8px; border-radius: 999px; font-size: .7rem; background: var(--bg-input); color: var(--text-secondary); border: 1px solid var(--border) }
.row-actions { display: flex; gap: 8px }
.btn-xs { padding: 4px 12px; font-size: .75rem; border-radius: var(--radius-sm); cursor: pointer; border: none; font-family: var(--font-body) }
.btn-secondary { background: var(--bg-input); color: var(--text-primary); border: 1px solid var(--border) }
.btn-danger { background: var(--accent-coral); color: #fff }
.btn-secondary:disabled, .btn-danger:disabled { opacity: 0.4; cursor: not-allowed }
.text-center { text-align: center }
</style>
