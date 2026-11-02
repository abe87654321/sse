<template>
  <Teleport to="body">
    <div v-if="open" class="modal-overlay" @click.self="requestClose">
      <div ref="modalRef" class="modal model-picker" role="dialog" aria-modal="true" aria-labelledby="model-picker-title" @keydown="handleKeydown">
        <div class="modal-header">
          <h3 id="model-picker-title" class="modal-title font-heading">选择模型</h3>
          <button class="modal-close" aria-label="关闭" @click="requestClose">×</button>
        </div>

        <div class="picker-toolbar">
          <input ref="searchInput" v-model="search" class="search-input" aria-label="搜索模型" placeholder="搜索模型 ID 或名称" />
          <button class="refresh-btn" :disabled="loading" aria-label="刷新模型列表" title="刷新模型列表" @click="refresh">
            <svg v-if="!loading" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M21 12a9 9 0 1 1-2.64-6.36" />
              <polyline points="21 3 21 9 15 9" />
            </svg>
            <span v-else class="spinner" />
          </button>
        </div>

        <div class="tabs" role="tablist">
          <button
            v-for="tabName in TABS"
            :key="tabName"
            class="tab"
            role="tab"
            :aria-selected="tab === tabName"
            :class="{ active: tab === tabName }"
            @click="tab = tabName"
            @keydown.left.prevent="moveTab(-1)"
            @keydown.right.prevent="moveTab(1)"
          >
            {{ tabName }} <span class="tab-count">{{ countFor(tabName) }}</span>
          </button>
        </div>

        <div v-if="error" class="picker-error" role="alert">{{ error }}</div>

        <div class="model-list">
          <div v-for="model in filteredModels" :key="model.id" class="model-row">
            <div class="model-main">
              <div class="model-id">
                {{ model.id }}
                <span v-if="model.missing" class="missing">当前地址未返回</span>
              </div>
              <div v-if="model.name && model.name !== model.id" class="model-name">{{ model.name }}</div>
              <div class="model-tags">
                <span v-for="tag in tagsOf(model)" :key="tag" class="tag">{{ tag }}</span>
                <button class="tag-edit" @click="editingId = editingId === model.id ? '' : model.id">
                  编辑标签
                </button>
              </div>
              <div v-if="editingId === model.id" class="tag-editor">
                <div class="tag-hint">手动标签会覆盖自动标签</div>
                <label v-for="tag in TAG_OPTIONS" :key="tag" class="tag-option">
                  <input
                    type="checkbox"
                    :checked="(model.manualTags || []).includes(tag)"
                    @change="toggleManualTag(model, tag)"
                  />
                  {{ tag }}
                </label>
                <button class="restore-btn" @click="restoreAuto(model)">恢复自动</button>
              </div>
            </div>
            <button
              class="toggle-btn"
              :class="{ selected: model.selected }"
              :title="model.selected ? '从模型文本框移出' : '加入模型文本框'"
              :aria-label="model.selected ? `将 ${model.id} 移出模型文本框` : `将 ${model.id} 加入模型文本框`"
              :aria-pressed="model.selected"
              @click="toggleModel(model)"
            >
              {{ model.selected ? '−' : '+' }}
            </button>
          </div>
          <div v-if="filteredModels.length === 0" class="empty-state" role="status">没有匹配的模型</div>
        </div>

        <div class="modal-footer">
          <span class="selected-count">已选 {{ selectedCount }} 个模型</span>
          <div class="footer-actions">
            <button class="btn-secondary" @click="requestClose">取消</button>
            <button class="btn-primary" @click="confirm">确定</button>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import api from '../api/index'

const TABS = ['全部', '推理', '视觉', '联网', '免费', '嵌入', '重排', '工具'] as const
const TAG_OPTIONS = ['推理', '视觉', '联网', '免费', '嵌入', '重排', '工具'] as const

const props = defineProps<{
  open: boolean
  endpoint: string
  apiKey: string
  catalog: any | null
  activeModel: string
}>()

const emit = defineEmits<{
  (event: 'update:open', value: boolean): void
  (event: 'confirm', payload: { catalog: any; activeModel: string }): void
}>()

const draft = ref<any[]>([])
const draftSource = ref<'openai' | 'ollama' | 'openrouter'>('openai')
const active = ref('')
const search = ref('')
const tab = ref<(typeof TABS)[number]>('全部')
const loading = ref(false)
const error = ref('')
const editingId = ref('')
const modalRef = ref<HTMLElement | null>(null)
const searchInput = ref<HTMLInputElement | null>(null)
const previouslyFocused = ref<HTMLElement | null>(null)
const dirty = ref(false)
const draftFetchedAt = ref('')

watch(
  () => props.open,
  (open) => {
    if (!open) {
      cleanupOverlay()
      return
    }
    previouslyFocused.value = document.activeElement as HTMLElement | null
    document.body.style.overflow = 'hidden'
    draft.value = JSON.parse(JSON.stringify(props.catalog?.models || []))
    draftSource.value = props.catalog?.source || 'openai'
    draftFetchedAt.value = props.catalog?.fetchedAt || ''
    active.value = props.activeModel
    if (active.value && !draft.value.some(model => model.id === active.value)) {
      draft.value.unshift({
        id: active.value,
        name: active.value,
        autoTags: [],
        manualTags: [],
        selected: true,
        metadata: {},
        missing: true,
      })
    }
    search.value = ''
    tab.value = '全部'
    error.value = ''
    editingId.value = ''
    dirty.value = false
    nextTick(() => searchInput.value?.focus())
    if ((props.catalog?.models || []).length === 0 && props.endpoint) refresh()
  },
  { immediate: true },
)

function cleanupOverlay() {
  document.body.style.overflow = ''
  if (previouslyFocused.value) {
    previouslyFocused.value.focus()
    previouslyFocused.value = null
  }
}

function handleKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    event.preventDefault()
    requestClose()
    return
  }
  if (event.key !== 'Tab') return
  const root = modalRef.value
  if (!root) return
  const focusable = Array.from(root.querySelectorAll<HTMLElement>(
    'button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])'
  )).filter(element => element.offsetParent !== null)
  if (focusable.length === 0) return
  const first = focusable[0]
  const last = focusable[focusable.length - 1]
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault()
    last.focus()
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault()
    first.focus()
  }
}

function moveTab(delta: number) {
  const index = TABS.indexOf(tab.value)
  const nextIndex = (index + delta + TABS.length) % TABS.length
  tab.value = TABS[nextIndex]
}

onBeforeUnmount(cleanupOverlay)

const selectedCount = computed(() => draft.value.filter(model => model.selected).length)

function tagsOf(model: any): string[] {
  return Array.isArray(model.manualTags) && model.manualTags.length > 0
    ? model.manualTags
    : (model.autoTags || [])
}

function countFor(tabName: string): number {
  if (tabName === '全部') return draft.value.length
  return draft.value.filter(model => tagsOf(model).includes(tabName)).length
}

const filteredModels = computed(() => {
  const keyword = search.value.trim().toLowerCase()
  return draft.value.filter((model) => {
    const matchesTab = tab.value === '全部' || tagsOf(model).includes(tab.value)
    const matchesSearch = !keyword
      || String(model.id).toLowerCase().includes(keyword)
      || String(model.name || '').toLowerCase().includes(keyword)
    return matchesTab && matchesSearch
  })
})

async function refresh() {
  if (!props.endpoint) {
    error.value = '请先填写 API 地址'
    return
  }
  loading.value = true
  error.value = ''
  try {
    const response = await api.post('/admin/ai-models', {
      endpoint: props.endpoint,
      apiKey: props.apiKey || undefined,
    }, { timeout: 30000 })
    const fetchedCatalog = response.data?.catalog
    const fetchedModels = fetchedCatalog?.models || response.data?.models || []
    draftSource.value = fetchedCatalog?.source
      || (response.data?.source === 'ollama'
        ? 'ollama'
        : response.data?.source === 'openrouter' ? 'openrouter' : 'openai')
    draftFetchedAt.value = fetchedCatalog?.fetchedAt || new Date().toISOString()
    const existing = new Map(draft.value.map(model => [model.id, model]))
    const next = fetchedModels.map((model: any) => {
      const old = existing.get(model.id)
      return {
        ...model,
        manualTags: old?.manualTags ?? model.manualTags ?? [],
        selected: old?.selected ?? model.selected ?? false,
        missing: model.missing === true,
      }
    })
    for (const old of draft.value) {
      if (old.selected && !next.some((model: any) => model.id === old.id)) {
        next.push({ ...old, missing: true })
      }
    }
    draft.value = next.filter((model: any) => !model.missing || model.selected)
  } catch (e: any) {
    error.value = e?.response?.data?.message || e?.message || '获取模型列表失败'
  } finally {
    loading.value = false
  }
}

function toggleManualTag(model: any, tag: string) {
  const tags = Array.isArray(model.manualTags) ? [...model.manualTags] : []
  const index = tags.indexOf(tag)
  if (index >= 0) tags.splice(index, 1)
  else tags.push(tag)
  model.manualTags = tags
  dirty.value = true
}

function restoreAuto(model: any) {
  model.manualTags = []
  dirty.value = true
}

function toggleModel(model: any) {
  model.selected = !model.selected
  dirty.value = true
}

function requestClose() {
  if (dirty.value && !window.confirm('放弃未保存的模型选择修改？')) return
  close()
}

function close() {
  cleanupOverlay()
  emit('update:open', false)
}

function confirm() {
  const selectedIds = draft.value.filter(model => model.selected).map(model => model.id)
  const activeModel = selectedIds.includes(active.value) ? active.value : (selectedIds[0] || '')
  dirty.value = false
  emit('confirm', {
    catalog: {
      fetchedAt: draftFetchedAt.value || new Date().toISOString(),
      source: draftSource.value,
      models: draft.value,
    },
    activeModel,
  })
  emit('update:open', false)
}
</script>

<style scoped>
.modal-overlay { position: fixed; inset: 0; background: rgba(45,36,32,0.4); backdrop-filter: blur(4px); display: flex; align-items: center; justify-content: center; z-index: 300; }
.modal { background: var(--bg-card); border-radius: var(--radius-lg); width: 92%; max-width: 720px; max-height: 88vh; display: flex; flex-direction: column; }
.modal-header { display: flex; align-items: center; justify-content: space-between; padding: 18px 22px; border-bottom: 1px solid var(--border-light); }
.modal-title { font-size: 1.05rem; }
.modal-close { background: none; border: none; cursor: pointer; color: var(--text-secondary); font-size: 1.3rem; line-height: 1; }
.picker-toolbar { display: flex; gap: 8px; padding: 14px 22px 0; }
.search-input { flex: 1; padding: 9px 11px; border: 1px solid var(--border); border-radius: var(--radius-sm); background: var(--bg-input); color: var(--text-primary); font-size: .875rem; }
.refresh-btn { width: 38px; border: 1px solid var(--border); border-radius: var(--radius-sm); background: var(--bg-input); color: var(--text-secondary); cursor: pointer; display: grid; place-items: center; }
.refresh-btn:disabled { opacity: .5; cursor: wait; }
.spinner { width: 14px; height: 14px; border: 2px solid var(--border); border-top-color: var(--accent-coral); border-radius: 50%; animation: spin .7s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
.tabs { display: flex; gap: 4px; overflow-x: auto; padding: 12px 22px 0; }
.tab { border: 1px solid var(--border); background: var(--bg-input); color: var(--text-secondary); border-radius: 999px; padding: 5px 10px; font-size: .78rem; cursor: pointer; white-space: nowrap; }
.tab.active { background: var(--accent-coral); border-color: var(--accent-coral); color: #fff; }
.tab-count { opacity: .75; margin-left: 2px; }
.picker-error { margin: 10px 22px 0; padding: 8px 10px; border-radius: var(--radius-sm); background: var(--accent-coral-bg); color: var(--accent-coral); font-size: .8rem; }
.model-list { flex: 1; overflow-y: auto; padding: 12px 22px; display: flex; flex-direction: column; gap: 8px; }
.model-row { display: flex; gap: 12px; align-items: flex-start; padding: 10px 12px; border: 1px solid var(--border-light); border-radius: var(--radius-sm); }
.model-main { flex: 1; min-width: 0; }
.model-id { font-size: .88rem; color: var(--text-primary); word-break: break-all; }
.model-name { font-size: .78rem; color: var(--text-muted); margin-top: 2px; }
.missing { margin-left: 6px; font-size: .72rem; color: var(--accent-coral); }
.model-tags { display: flex; flex-wrap: wrap; gap: 4px; align-items: center; margin-top: 5px; }
.tag { font-size: .7rem; padding: 1px 7px; border-radius: 999px; background: var(--accent-mint-bg); color: #2b7a3d; }
.tag-edit { border: none; background: none; color: var(--text-muted); font-size: .72rem; cursor: pointer; text-decoration: underline; }
.tag-editor { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 8px; padding: 8px; background: var(--bg-input); border-radius: var(--radius-sm); }
.tag-hint { width:100%; font-size:.72rem; color: var(--text-muted); }
.tag-option { display: flex; align-items: center; gap: 4px; font-size: .78rem; color: var(--text-secondary); }
.restore-btn { border: none; background: none; color: var(--accent-coral); font-size: .75rem; cursor: pointer; }
.toggle-btn { width: 34px; height: 34px; flex: 0 0 auto; border-radius: 50%; border: 1px solid var(--border); background: var(--bg-input); color: var(--text-primary); font-size: 1.2rem; line-height: 1; cursor: pointer; }
.toggle-btn.selected { background: var(--accent-coral); border-color: var(--accent-coral); color: #fff; }
.modal-footer { display: flex; align-items: center; justify-content: space-between; padding: 14px 22px; border-top: 1px solid var(--border-light); }
.selected-count { font-size: .82rem; color: var(--text-secondary); }
.footer-actions { display: flex; gap: 8px; }
.empty-state { text-align: center; color: var(--text-muted); padding: 28px 0; font-size: .85rem; }
</style>
