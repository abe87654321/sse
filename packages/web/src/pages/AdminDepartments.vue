<template>
  <div class="admin-page">
    <div class="page-header"><h2 class="page-header-title">部门管理</h2></div>

    <div class="card" style="margin-bottom:20px">
      <h3 class="font-heading section-title">新增部门</h3>
      <div class="add-row">
        <input v-model="newDeptName" class="add-input" placeholder="输入部门名称" @keyup.enter="addDepartment" />
        <button class="btn-primary btn-sm" @click="addDepartment" :disabled="adding || !newDeptName.trim()">添加</button>
      </div>
      <p v-if="addError" class="form-error">{{ addError }}</p>
    </div>

    <div class="card" style="padding:0;overflow:hidden">
      <div style="padding:18px 24px;border-bottom:1px solid var(--border-light)"><h3 class="font-heading" style="font-size:1rem">部门列表</h3></div>
      <table class="data-table">
        <thead><tr><th>部门名称</th><th>用户数</th><th>操作</th></tr></thead>
        <tbody>
          <tr v-for="d in departments" :key="d.name">
            <td>{{ d.name }}</td>
            <td class="text-secondary">{{ d.user_count }}</td>
            <td>
              <button class="btn-danger btn-xs" @click="deleteDepartment(d.name)" :disabled="d.user_count > 0">
                删除
              </button>
            </td>
          </tr>
          <tr v-if="!loading && departments.length===0">
            <td colspan="3" class="text-center text-secondary" style="padding:32px">暂无部门数据</td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import api from '../api/index'

interface Department {
  name: string
  user_count: number
}

const departments = ref<Department[]>([])
const loading = ref(false)
const newDeptName = ref('')
const adding = ref(false)
const addError = ref('')

onMounted(() => {
  fetchDepartments()
})

async function fetchDepartments() {
  loading.value = true
  try {
    const r = await api.get('/admin/departments')
    departments.value = r.data || []
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
  adding.value = true
  try {
    await api.post('/admin/departments', { name })
    newDeptName.value = ''
    await fetchDepartments()
  } catch (e: any) {
    addError.value = e?.response?.data?.message || '添加失败'
  } finally {
    adding.value = false
  }
}

async function deleteDepartment(name: string) {
  if (!confirm('确定删除部门 "' + name + '" 吗？')) return
  try {
    await api.delete('/admin/departments/' + encodeURIComponent(name))
    await fetchDepartments()
  } catch {}
}
</script>

<style scoped>
.admin-page { max-width: 900px }
.section-title { font-size: 1rem; margin-bottom: 14px }
.add-row { display: flex; gap: 10px }
.add-input { flex: 1; padding: 10px 12px; border: 1px solid var(--border); border-radius: var(--radius-sm); background: var(--bg-input); color: var(--text-primary); font-family: var(--font-body); font-size: .875rem }
.form-error { margin-top: 8px; font-size: .8rem; color: var(--accent-coral) }
.btn-xs { padding: 4px 12px; font-size: .75rem; border-radius: var(--radius-sm); cursor: pointer; border: none; font-family: var(--font-body) }
.btn-danger { background: var(--accent-coral); color: #fff }
.btn-danger:disabled { opacity: 0.4; cursor: not-allowed }
.text-center { text-align: center }
</style>
