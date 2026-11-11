<template>
  <div class="sync-status" :class="{ error: !!error }">
    <template v-if="status">
      <span class="sync-item">版本 <strong>v{{ status.version }}</strong></span>
      <span class="sync-item">{{ status.counts?.quads ?? 0 }} quads</span>
      <span class="sync-item">{{ status.counts?.subjects ?? 0 }} subjects</span>
      <span class="sync-item" :class="{ warning: status.lagSeconds > 30 }">
        延迟 {{ status.lagSeconds }}s
      </span>
      <span class="sync-item" :class="{ warning: outboxPending > 0 }">
        待处理 {{ outboxPending }}
      </span>
      <span class="sync-item" :class="{ warning: deadLettered > 0 }">
        死信 {{ deadLettered }}
      </span>
      <span v-if="lastError" class="sync-item sync-error" :title="lastError">
        最近错误：{{ lastError }}
      </span>
    </template>
    <span v-else-if="error" class="sync-item sync-error">同步状态不可用：{{ error }}</span>
    <span v-else class="sync-item">同步状态加载中...</span>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { ontologyApi, type OntologyStatus } from '../../api/ontology'

const props = withDefaults(defineProps<{ pollMs?: number }>(), { pollMs: 10000 })

const emit = defineEmits<{
  (event: 'status', status: OntologyStatus): void
  (event: 'unavailable'): void
  (event: 'error', message: string): void
}>()

const status = ref<OntologyStatus | null>(null)
const error = ref<string | null>(null)
let timer: ReturnType<typeof setInterval> | null = null
let mounted = false
let polling = false

const outboxPending = computed(() => status.value?.outboxPending ?? status.value?.outbox?.pending ?? 0)
const deadLettered = computed(
  () => status.value?.deadLettered ?? status.value?.outbox?.deadLettered ?? 0,
)
const lastError = computed(() => status.value?.outbox?.lastError ?? null)

function errorMessage(err: unknown): string {
  const anyErr = err as {
    response?: { data?: { error?: { message?: string }; message?: string } }
    message?: string
  }
  return (
    anyErr?.response?.data?.error?.message ||
    anyErr?.response?.data?.message ||
    anyErr?.message ||
    '请求失败'
  )
}

function isUnavailable(err: unknown): boolean {
  const anyErr = err as {
    response?: { status?: number; data?: { error?: { code?: string } } }
  }
  return (
    anyErr?.response?.status === 503 ||
    anyErr?.response?.data?.error?.code === 'ONTOLOGY_V2_UNAVAILABLE'
  )
}

async function poll(): Promise<void> {
  if (!mounted || polling) return
  polling = true
  try {
    const response = await ontologyApi.status()
    if (!mounted) return
    status.value = response.data
    error.value = null
    emit('status', response.data)
  } catch (err) {
    if (!mounted) return
    status.value = null
    error.value = errorMessage(err)
    if (isUnavailable(err)) emit('unavailable')
    else emit('error', error.value)
  } finally {
    polling = false
  }
}

onMounted(() => {
  mounted = true
  void poll()
  timer = setInterval(() => {
    void poll()
  }, props.pollMs)
})

onUnmounted(() => {
  mounted = false
  if (timer) {
    clearInterval(timer)
    timer = null
  }
})
</script>

<style scoped>
.sync-status {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 10px;
  align-items: center;
  font-size: 0.76rem;
  color: var(--text-secondary);
  max-width: 640px;
}
.sync-item {
  white-space: nowrap;
}
.sync-item.warning {
  color: #b45309;
  font-weight: 600;
}
.sync-item.sync-error {
  color: #b42318;
  max-width: 320px;
  overflow: hidden;
  text-overflow: ellipsis;
}
.sync-status.error .sync-item {
  color: #b42318;
}
</style>
