<template>
  <div class="page">
    <h2 class="font-heading page-title">备份与恢复</h2>

    <div class="card toolbar">
      <button data-test="create-backup" class="btn-primary btn-sm" @click="create">创建备份</button>
      <label><input v-model="includeSecrets" type="checkbox" /> 包含 .env</label>
      <label><input v-model="upload" type="checkbox" /> 上传到 MinIO</label>
      <button class="btn-secondary btn-sm" @click="refresh">刷新</button>
    </div>

    <div class="card">
      <div v-if="loading" class="no-data">加载中...</div>
      <div v-else-if="items.length === 0" class="no-data">暂无备份</div>
      <table v-else class="data-table">
        <thead>
          <tr><th>备份 ID</th><th>时间</th><th>表/行/对象</th><th>位置</th><th>操作</th></tr>
        </thead>
        <tbody>
          <tr v-for="item in items" :key="item.id">
            <td class="mono">{{ item.id }}</td>
            <td>{{ item.manifest?.createdAt || '-' }}</td>
            <td>
              {{ item.manifest?.counts?.tables ?? '-' }} /
              {{ item.manifest?.counts?.rows ?? '-' }} /
              {{ item.manifest?.counts?.objects ?? '-' }}
            </td>
            <td>{{ item.locations?.join(' + ') || 'local' }}</td>
            <td class="actions">
              <button class="table-link" @click="download(item.id)">下载</button>
              <button class="table-link" @click="verify(item.id)">校验</button>
              <button class="table-link" @click="uploadBackup(item.id)">上传</button>
              <button class="table-link" data-test="open-restore" @click="openRestore(item.id)">恢复</button>
              <button class="table-link danger" @click="remove(item.id)">删除</button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <div class="card" style="margin-top:16px">
      <h3>演练库</h3>
      <p class="text-muted">恢复成功后在这里一键清除，便于反复测试。</p>
      <div v-if="drills.length === 0" class="no-data">暂无演练记录</div>
      <table v-else class="data-table">
        <thead>
          <tr><th>记录</th><th>目标库</th><th>MinIO 前缀</th><th>状态</th><th>操作</th></tr>
        </thead>
        <tbody>
          <tr v-for="drill in drills" :key="drill.id">
            <td class="mono">{{ drill.id }}</td>
            <td class="mono">{{ drill.targetDb }}</td>
            <td class="mono">{{ drill.targetMinioPrefix }}</td>
            <td>{{ drill.status }}</td>
            <td>
              <button
                v-if="drill.status === 'active'"
                class="table-link danger"
                data-test="open-cleanup"
                @click="openCleanup(drill)"
              >清除</button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <div v-if="cleanupOpen" class="card" style="margin-top:16px">
      <h3>清除演练库</h3>
      <p class="mono">{{ cleanup.targetDb }} / {{ cleanup.prefix }}</p>
      <label>确认短语
        <input
          v-model="cleanup.confirm"
          data-test="cleanup-confirm"
          :placeholder="`CLEANUP ${cleanup.targetDb}`"
        />
      </label>
      <button data-test="submit-cleanup" class="btn-primary btn-sm" @click="submitCleanup">确认清除</button>
      <div v-if="cleanupError" class="error">{{ cleanupError }}</div>
    </div>

    <div v-if="restoreOpen" class="card" style="margin-top:16px">
      <h3>恢复到演练库</h3>
      <label>目标库 <input v-model="restore.targetDb" data-test="restore-target" /></label>
      <label>MinIO 前缀 <input v-model="restore.prefix" /></label>
      <label>确认短语
        <input
          v-model="restore.confirm"
          data-test="restore-confirm"
          :placeholder="`RESTORE ${restore.id}`"
        />
      </label>
      <label><input v-model="restore.dryRun" type="checkbox" /> 仅预检</label>
      <button data-test="submit-restore" class="btn-primary btn-sm" @click="submitRestore">开始恢复</button>
      <div v-if="restoreError" class="error">{{ restoreError }}</div>
    </div>

    <div v-if="message" class="inline-result" role="status">{{ message }}</div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import api from '../api/index'

const items = ref<any[]>([])
const drills = ref<any[]>([])
const loading = ref(true)
const includeSecrets = ref(false)
const upload = ref(true)
const message = ref('')

const restoreOpen = ref(false)
const restoreError = ref('')
const restore = reactive({ id: '', targetDb: '', prefix: '', confirm: '', dryRun: false })

const cleanupOpen = ref(false)
const cleanupError = ref('')
const cleanup = reactive({ id: '', targetDb: '', prefix: '', confirm: '' })

async function load(setError = true) {
  loading.value = true
  try {
    const res = await api.get('/admin/backups')
    items.value = res.data.items || []
  } catch (error: any) {
    if (setError) {
      message.value = error?.response?.data?.error?.message || '加载备份失败'
    }
  } finally {
    loading.value = false
  }
}

async function loadDrills() {
  try {
    const res = await api.get('/admin/backups/drills')
    drills.value = res.data.items || []
  } catch {
    drills.value = []
  }
}

async function refresh() {
  message.value = ''
  await Promise.all([load(), loadDrills()])
}

async function create() {
  message.value = ''
  try {
    const res = await api.post('/admin/backups', {
      includeSecrets: includeSecrets.value,
      upload: upload.value,
    })
    message.value = `备份任务已启动：${res.data.id}`
    await load(false)
  } catch (error: any) {
    message.value = error?.response?.data?.error?.message || '创建备份失败'
  }
}

async function verify(id: string) {
  await api.post(`/admin/backups/${id}/verify`)
  message.value = `校验任务已启动：${id}`
}

async function uploadBackup(id: string) {
  await api.post(`/admin/backups/${id}/upload`)
  await load()
}

async function remove(id: string) {
  if (!window.confirm(`确定删除备份 ${id}？`)) return
  await api.delete(`/admin/backups/${id}`)
  await load()
}

async function download(id: string) {
  const res = await api.get(`/admin/backups/${id}/download`, { responseType: 'blob' })
  const url = URL.createObjectURL(res.data)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `${id}.tar.gz`
  anchor.click()
  URL.revokeObjectURL(url)
}

function openRestore(id: string) {
  restore.id = id
  restore.targetDb = `sse_drill_${id.replace(/[^a-z0-9_]/gi, '_').toLowerCase()}`
  restore.prefix = `drills/${id}/`
  restore.confirm = ''
  restore.dryRun = false
  restoreError.value = ''
  restoreOpen.value = true
}

async function submitRestore() {
  restoreError.value = ''
  if (restore.confirm !== `RESTORE ${restore.id}`) {
    restoreError.value = '确认短语不正确'
    return
  }
  try {
    await api.post(`/admin/backups/${restore.id}/restore`, {
      targetDb: restore.targetDb,
      targetMinioPrefix: restore.prefix,
      dryRun: restore.dryRun,
      confirm: restore.confirm,
    })
    restoreOpen.value = false
    await loadDrills()
  } catch (error: any) {
    restoreError.value = error?.response?.data?.error?.message || '恢复失败'
  }
}

function openCleanup(drill: any) {
  cleanup.id = drill.id
  cleanup.targetDb = drill.targetDb
  cleanup.prefix = drill.targetMinioPrefix
  cleanup.confirm = ''
  cleanupError.value = ''
  cleanupOpen.value = true
}

async function submitCleanup() {
  cleanupError.value = ''
  if (cleanup.confirm !== `CLEANUP ${cleanup.targetDb}`) {
    cleanupError.value = '确认短语不正确'
    return
  }
  try {
    await api.post(`/admin/backups/drills/${cleanup.id}/cleanup`, {
      targetDb: cleanup.targetDb,
      targetMinioPrefix: cleanup.prefix,
      confirm: cleanup.confirm,
    })
    cleanupOpen.value = false
    await loadDrills()
  } catch (error: any) {
    cleanupError.value = error?.response?.data?.error?.message || '清除失败'
  }
}

onMounted(() => {
  load()
  loadDrills()
})
</script>

<style scoped>
.page-title { font-size: 1.2rem; margin-bottom: 16px; }
.toolbar { display: flex; gap: 12px; align-items: center; flex-wrap: wrap; margin-bottom: 16px; }
.actions { display: flex; gap: 8px; flex-wrap: wrap; }
.mono { font-family: monospace; font-size: 0.78rem; }
.no-data { font-size: 0.85rem; color: var(--text-muted); padding: 24px 0; text-align: center; }
.error { color: var(--accent-coral); font-size: 0.85rem; margin-top: 8px; }
</style>
