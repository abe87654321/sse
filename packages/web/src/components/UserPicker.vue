<template>
  <div class="user-picker" ref="container">
    <div class="picker-input-wrap" @click="focusInput">
      <span v-for="user in modelValue" :key="user.id" class="picker-tag">
        {{ user.name }}
        <button @click.stop="removeUser(user.id)">&times;</button>
      </span>
      <input
        ref="inputRef"
        v-model="query"
        :placeholder="modelValue.length === 0 ? (placeholder || '搜索用户...') : ''"
        class="picker-input"
        @focus="onFocus"
        @blur="onBlur"
        @keydown.down.prevent="moveHighlight(1)"
        @keydown.up.prevent="moveHighlight(-1)"
        @keydown.enter.prevent="toggleHighlighted"
        @keydown.escape.prevent="closeDropdown"
      />
    </div>
    <div v-if="showDropdown" class="picker-dropdown">
      <div v-if="loading" class="picker-loading">搜索中...</div>
      <div
        v-for="(user, idx) in users"
        :key="user.id"
        class="picker-option"
        :class="{ highlighted: idx === highlightIndex, selected: isSelected(user.id) }"
        @mousedown.prevent="toggleUser(user)"
        @mouseenter="highlightIndex = idx"
      >
        <span class="picker-checkbox">{{ isSelected(user.id) ? '☑' : '☐' }}</span>
        <span class="picker-name">{{ user.name }}</span>
        <span class="picker-meta">{{ user.phone }} · {{ user.department }} / {{ roleLabel(user.role) }}</span>
      </div>
      <div v-if="!loading && users.length === 0" class="picker-empty">无匹配用户</div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, nextTick } from 'vue'
import api from '../api/index'

interface UserItem { id: string; name: string; phone?: string; department?: string; role?: string }

const props = withDefaults(defineProps<{
  modelValue: UserItem[]
  placeholder?: string
}>(), {
  modelValue: () => [],
})

const emit = defineEmits<{
  'update:modelValue': [value: UserItem[]]
}>()

const container = ref<HTMLElement>()
const inputRef = ref<HTMLInputElement>()
const query = ref('')
const users = ref<UserItem[]>([])
const highlightIndex = ref(-1)
const showDropdown = ref(false)
const loading = ref(false)
let searchTimer: ReturnType<typeof setTimeout> | null = null

function roleLabel(role?: string) {
  const m: Record<string, string> = { admin: '管理员', finance: '财务', dept_approver: '审批人', employee: '员工' }
  return m[role || ''] || role || '-'
}

function isSelected(id: string) { return props.modelValue.some(u => u.id === id) }

function focusInput() { inputRef.value?.focus() }

function onFocus() {
  showDropdown.value = true
  fetchUsers()
}

function onBlur() {
  setTimeout(() => { showDropdown.value = false }, 200)
}

function closeDropdown() {
  showDropdown.value = false
  query.value = ''
}

function fetchUsers() {
  if (searchTimer) clearTimeout(searchTimer)
  searchTimer = setTimeout(async () => {
    loading.value = true
    try {
      const q = query.value.trim()
      const res = await api.get('/user/search', { params: q ? { q } : {} })
      users.value = res.data || []
      highlightIndex.value = -1
    } catch {} finally { loading.value = false }
  }, 300)
}

watch(query, fetchUsers)

function toggleUser(user: UserItem) {
  const idx = props.modelValue.findIndex(u => u.id === user.id)
  if (idx >= 0) {
    emit('update:modelValue', props.modelValue.filter((_, i) => i !== idx))
  } else {
    emit('update:modelValue', [...props.modelValue, { id: user.id, name: user.name }])
  }
}

function removeUser(id: string) {
  emit('update:modelValue', props.modelValue.filter(u => u.id !== id))
}

function moveHighlight(dir: number) {
  if (!showDropdown.value) { showDropdown.value = true; fetchUsers(); return }
  highlightIndex.value = Math.max(-1, Math.min(users.value.length - 1, highlightIndex.value + dir))
}

function toggleHighlighted() {
  if (highlightIndex.value >= 0 && users.value[highlightIndex.value]) {
    toggleUser(users.value[highlightIndex.value])
  }
}
</script>

<style scoped>
.user-picker { position: relative; }
.picker-input-wrap {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
  padding: 6px 10px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--bg-tertiary);
  min-height: 38px;
  cursor: text;
}
.picker-tag {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
  background: var(--accent-sky-bg);
  color: var(--accent-sky);
  border-radius: var(--radius-sm);
  font-size: 0.82rem;
}
.picker-tag button {
  background: none;
  border: none;
  color: inherit;
  cursor: pointer;
  font-size: 1rem;
  padding: 0;
  line-height: 1;
}
.picker-input {
  border: none;
  outline: none;
  background: transparent;
  flex: 1;
  min-width: 120px;
  font-size: 0.9rem;
  color: var(--text-primary);
}
.picker-dropdown {
  position: absolute;
  top: 100%;
  left: 0;
  right: 0;
  margin-top: 4px;
  background: var(--bg-card);
  border: 1px solid var(--border-light);
  border-radius: var(--radius-sm);
  box-shadow: var(--shadow);
  max-height: 220px;
  overflow-y: auto;
  z-index: 200;
}
.picker-option {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  cursor: pointer;
  font-size: 0.88rem;
}
.picker-option.highlighted { background: var(--bg-hover); }
.picker-checkbox { flex-shrink: 0; width: 18px; }
.picker-name { font-weight: 500; color: var(--text-primary); white-space: nowrap; }
.picker-meta { font-size: 0.78rem; color: var(--text-muted); margin-left: auto; white-space: nowrap; }
.picker-loading, .picker-empty { padding: 12px; text-align: center; color: var(--text-muted); font-size: 0.85rem; }
</style>
