<template>
  <section class="graph-explorer card">
    <div class="explorer-toolbar">
      <input
        v-model="searchInput"
        class="input-sm explorer-search"
        placeholder="搜索节点 / 属性..."
        aria-label="搜索节点"
      />
      <select v-model="typeFilter" class="input-sm" aria-label="按类型筛选">
        <option value="">全部类型</option>
        <option v-for="type in typeOptions" :key="type" :value="type">{{ type }}</option>
      </select>
      <select v-model="statusFilter" class="input-sm" aria-label="按状态筛选">
        <option value="">全部状态</option>
        <option v-for="status in statusOptions" :key="status" :value="status">{{ status }}</option>
      </select>
      <select v-model="departmentFilter" class="input-sm" aria-label="按部门筛选">
        <option value="">全部部门</option>
        <option v-for="department in departmentOptions" :key="department" :value="department">{{ department }}</option>
      </select>
      <select
        v-model.number="depth"
        class="input-sm depth-select"
        aria-label="关系深度"
        @change="emit('depth-change', depth)"
      >
        <option :value="1">深度 1</option>
        <option :value="2">深度 2</option>
        <option :value="3">深度 3</option>
      </select>
      <button class="btn-secondary btn-sm" :disabled="loading" @click="emit('refresh')">
        {{ loading ? '刷新中...' : '刷新' }}
      </button>
    </div>

    <p class="explorer-hint">
      显示 {{ displayedCount }} / {{ nodes.length }} 个节点 · {{ edges.length }} 条关系
      <span v-if="sourceTruncated" class="cap-note">（已限制为前 {{ maxNodes }} 个节点）</span>
      <span v-if="selected" class="selected-note"> · 已选中 {{ selectedLabel }}</span>
    </p>

    <div ref="graphContainer" class="graph-canvas"></div>

    <div v-if="loading" class="graph-overlay">加载图谱中...</div>
    <div v-else-if="nodes.length === 0" class="graph-overlay">暂无图谱数据</div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { Network } from 'vis-network'
import { DataSet } from 'vis-data'
import { entityLabel } from './utils'

export interface ExplorerNode {
  id?: string
  uri: string
  label?: string
  type: string
  properties?: Record<string, string>
}

export interface ExplorerEdge {
  id: string
  from: string
  to: string
  predicate?: string
  label?: string
}

const props = withDefaults(
  defineProps<{
    nodes: ExplorerNode[]
    edges: ExplorerEdge[]
    selected?: string | null
    loading?: boolean
    maxNodes?: number
  }>(),
  {
    selected: null,
    loading: false,
    maxNodes: 400,
  },
)

const emit = defineEmits<{
  (event: 'select', uri: string): void
  (event: 'depth-change', depth: number): void
  (event: 'refresh'): void
}>()

const COLORS: Record<string, string> = {
  Person: '#e878b0',
  Department: '#5898e0',
  Company: '#88c040',
  ExpenseReport: '#48b8a8',
  Report: '#48b8a8',
  DraftReport: '#48b8a8',
  PendingReport: '#48b8a8',
  ApprovedReport: '#48b8a8',
  RejectedReport: '#e87870',
  PaidReport: '#88c040',
  ExpenseItem: '#e8c820',
  Invoice: '#e87870',
  ApprovalRule: '#c080e0',
  ApprovalRecord: '#48b0c8',
  Approver: '#48b0c8',
  PaymentReceipt: '#88c040',
  Unknown: '#999',
}

const SHAPES: Record<string, string> = {
  Person: 'dot',
  Department: 'diamond',
  Company: 'hexagon',
  ExpenseReport: 'dot',
  Report: 'dot',
  ExpenseItem: 'box',
  Invoice: 'star',
  ApprovalRule: 'square',
  ApprovalRecord: 'dot',
  Approver: 'dot',
  PaymentReceipt: 'hexagon',
  Unknown: 'dot',
}

const graphContainer = ref<HTMLElement | null>(null)
const searchInput = ref('')
const searchTerm = ref('')
const typeFilter = ref('')
const statusFilter = ref('')
const departmentFilter = ref('')
const depth = ref(2)

let network: Network | null = null
let nodesData: DataSet<any> | null = null
let edgesData: DataSet<any> | null = null
let debounceTimer: ReturnType<typeof setTimeout> | null = null
let lastSignature = ''

const nodeId = (node: ExplorerNode): string => node.id || node.uri

const typeOptions = computed(() => unique(props.nodes.map((node) => node.type)))
const statusOptions = computed(() =>
  unique(props.nodes.map((node) => node.properties?.status).filter((value): value is string => !!value)),
)
const departmentOptions = computed(() =>
  unique(props.nodes.map((node) => node.properties?.department).filter((value): value is string => !!value)),
)

const sourceTruncated = computed(() => props.nodes.length > props.maxNodes)

const selectedLabel = computed(() => {
  const node = props.nodes.find((candidate) => nodeId(candidate) === props.selected)
  return node ? entityLabel(node) : ''
})

const displayedCount = computed(() => {
  const visible = new Set(
    props.nodes.filter(matchesFilters).slice(0, props.maxNodes).map(nodeId),
  )
  return visible.size
})

function unique(values: string[]): string[] {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b))
}

function matchesFilters(node: ExplorerNode): boolean {
  if (typeFilter.value && node.type !== typeFilter.value) return false
  if (statusFilter.value && node.properties?.status !== statusFilter.value) return false
  if (departmentFilter.value && node.properties?.department !== departmentFilter.value) return false
  const term = searchTerm.value.trim().toLowerCase()
  if (!term) return true
  const haystack = [
    nodeId(node),
    node.label ?? '',
    node.type,
    ...Object.values(node.properties ?? {}),
  ]
    .join(' ')
    .toLowerCase()
  return haystack.includes(term)
}

function nodeVisual(node: ExplorerNode): Record<string, unknown> {
  const id = nodeId(node)
  const label = entityLabel(node)
  const color = COLORS[node.type] || COLORS.Unknown
  const shape = SHAPES[node.type] || 'dot'
  const isSelected = props.selected === id
  const visual: Record<string, unknown> = {
    id,
    label,
    title: `${node.type}: ${label}\n${JSON.stringify(node.properties ?? {}, null, 2)}`,
    color: {
      background: color,
      border: color,
      highlight: { background: color, border: color },
    },
    shape,
    borderWidth: isSelected ? 4 : 0,
    borderWidthSelected: 5,
    shadow: { enabled: true, color: 'rgba(0,0,0,0.2)', size: 16, x: 0, y: 2 },
  }
  if (shape === 'box') {
    visual.widthConstraint = { maximum: 90 }
    visual.heightConstraint = { maximum: 24 }
  } else {
    visual.size = isSelected ? 24 : 20
  }
  return visual
}

function syncData(): void {
  if (!nodesData || !edgesData) return

  const cappedNodes = props.nodes.slice(0, props.maxNodes)
  const cappedIds = new Set(cappedNodes.map(nodeId))
  const signature = cappedNodes.map(nodeId).join('|')

  const existingNodeIds = nodesData.getIds() as string[]
  const staleNodeIds = existingNodeIds.filter((id) => !cappedIds.has(id))
  if (staleNodeIds.length > 0) nodesData.remove(staleNodeIds)

  nodesData.update(cappedNodes.map(nodeVisual))

  const desiredEdges = props.edges.filter(
    (edge) => cappedIds.has(edge.from) && cappedIds.has(edge.to),
  )
  const desiredEdgeIds = new Set(desiredEdges.map((edge) => edge.id))
  const existingEdgeIds = edgesData.getIds() as string[]
  const staleEdgeIds = existingEdgeIds.filter((id) => !desiredEdgeIds.has(id))
  if (staleEdgeIds.length > 0) edgesData.remove(staleEdgeIds)

  edgesData.update(
    desiredEdges.map((edge) => ({
      id: edge.id,
      from: edge.from,
      to: edge.to,
      label: edge.label || edge.predicate || '',
      arrows: { to: { enabled: true, scaleFactor: 0.5 } },
      color: { color: '#999', highlight: '#555' },
      font: { color: '#666', size: 11, align: 'horizontal', background: 'rgba(255,255,255,0.65)' },
      smooth: false,
      width: 1,
    })),
  )

  applyFilters()

  if (signature !== lastSignature) {
    lastSignature = signature
    relayout()
  }
}

function applyFilters(): void {
  if (!nodesData || !edgesData) return

  const visible = new Set(
    props.nodes.filter(matchesFilters).slice(0, props.maxNodes).map(nodeId),
  )

  const nodeUpdates = (nodesData.getIds() as string[]).map((id) => ({
    id,
    hidden: !visible.has(id),
    opacity: visible.has(id) ? 1 : 0.15,
  }))
  if (nodeUpdates.length > 0) nodesData.update(nodeUpdates)

  const edgeUpdates = (edgesData.getIds() as string[]).map((id) => {
    const edge = edgesData!.get(id) as { from: string; to: string }
    return {
      id,
      hidden: !visible.has(edge.from) || !visible.has(edge.to),
    }
  })
  if (edgeUpdates.length > 0) edgesData.update(edgeUpdates)
}

function relayout(): void {
  if (!network) return
  network.setOptions({ physics: { enabled: true } })
  network.stabilize(60)
  network.once('stabilizationIterationsDone', () => {
    network?.setOptions({ physics: { enabled: false } })
  })
}

function selectNode(id: string): void {
  const node = props.nodes.find((candidate) => nodeId(candidate) === id)
  if (!node) return
  emit('select', node.uri || id)
}

onMounted(() => {
  if (!graphContainer.value) return

  nodesData = new DataSet([])
  edgesData = new DataSet([])

  network = new Network(
    graphContainer.value,
    { nodes: nodesData, edges: edgesData },
    {
      autoResize: true,
      physics: {
        solver: 'forceAtlas2Based',
        forceAtlas2Based: {
          gravitationalConstant: -50,
          centralGravity: 0.01,
          springLength: 150,
          springConstant: 0.08,
        },
        stabilization: { iterations: 120 },
      },
      interaction: { hover: true, tooltipDelay: 200, navigationButtons: true, keyboard: true },
      nodes: { font: { color: '#333', size: 13, face: 'sans-serif', align: 'below' } },
      edges: { smooth: false },
      layout: { improvedLayout: true, randomSeed: 42 },
    },
  )

  network.on('click', (params: { nodes: string[] }) => {
    if (params.nodes.length > 0) selectNode(params.nodes[0])
  })

  syncData()
})

onUnmounted(() => {
  if (debounceTimer) clearTimeout(debounceTimer)
  if (network) {
    network.destroy()
    network = null
  }
  nodesData = null
  edgesData = null
})

watch(
  () => props.nodes,
  () => syncData(),
)
watch(
  () => props.edges,
  () => syncData(),
)
watch(
  () => props.maxNodes,
  () => syncData(),
)
watch(
  () => props.selected,
  () => syncData(),
)
watch(searchInput, (value) => {
  if (debounceTimer) clearTimeout(debounceTimer)
  debounceTimer = setTimeout(() => {
    searchTerm.value = value
  }, 250)
})
watch([searchTerm, typeFilter, statusFilter, departmentFilter], () => applyFilters())
</script>

<style scoped>
.graph-explorer {
  position: relative;
  display: flex;
  flex-direction: column;
  min-height: 560px;
  padding: 14px 16px;
  overflow: hidden;
}
.explorer-toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
}
.explorer-search {
  flex: 1 1 180px;
  min-width: 140px;
}
.explorer-toolbar .input-sm {
  height: 32px;
  font-size: 0.8rem;
  padding: 0 8px;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-sm);
  background: var(--bg-card);
  color: var(--text-primary);
}
.depth-select {
  max-width: 96px;
}
.explorer-hint {
  margin: 8px 0;
  font-size: 0.78rem;
  color: var(--text-secondary);
}
.cap-note {
  color: var(--accent-coral);
}
.selected-note {
  color: var(--text-primary);
}
.graph-canvas {
  flex: 1;
  min-height: 460px;
  border-radius: var(--radius-md);
  background: #fafbfc;
  border: 1px solid #e5e7eb;
  box-shadow: inset 0 0 30px rgba(0, 0, 0, 0.03);
}
.graph-overlay {
  position: absolute;
  inset: 96px 16px 16px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.9rem;
  color: var(--text-secondary);
  pointer-events: none;
}
</style>
