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
        :value="depth"
        class="input-sm depth-select"
        aria-label="关系深度"
        @change="handleDepthChange"
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

    <div ref="graphWrapper" class="graph-canvas-wrap">
      <div ref="graphContainer" class="graph-canvas"></div>
      <div
        v-if="tooltip.visible"
        class="graph-tooltip"
        :style="{ left: tooltip.x + 'px', top: tooltip.y + 'px' }"
        role="tooltip"
      >
        <div class="graph-tooltip-type">
          {{ tooltip.type }}<span v-if="tooltip.typeLabel"> · {{ tooltip.typeLabel }}</span>
        </div>
        <div class="graph-tooltip-label">{{ tooltip.label }}</div>
        <dl v-if="tooltip.props.length" class="graph-tooltip-props">
          <template v-for="prop in tooltip.props" :key="prop.key">
            <dt>{{ prop.key }}</dt>
            <dd>{{ prop.value }}</dd>
          </template>
        </dl>
      </div>
    </div>

    <div v-if="loading" class="graph-overlay">加载图谱中...</div>
    <div v-else-if="nodes.length === 0" class="graph-overlay">暂无图谱数据</div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { Network } from 'vis-network'
import { DataSet } from 'vis-data'
import {
  entityLabel,
  graphNodeId,
  matchesGraphFilters,
  selectVisibleGraphNodes,
  type GraphFilters,
} from './utils'
import {
  GRAPH_COLORS as COLORS,
  GRAPH_SHAPES as SHAPES,
  GRAPH_TYPE_LABELS,
} from './graph-style'
import {
  patchGraphViewState,
  readGraphViewState,
  type GraphViewport,
} from './graph-view-state'

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
    depth?: number
  }>(),
  {
    selected: null,
    loading: false,
    maxNodes: 400,
    depth: 2,
  },
)

const emit = defineEmits<{
  (event: 'select', uri: string): void
  (event: 'depth-change', depth: number): void
  (event: 'refresh'): void
}>()



const savedViewState = readGraphViewState()
const graphWrapper = ref<HTMLElement | null>(null)
const graphContainer = ref<HTMLElement | null>(null)
const searchInput = ref(savedViewState.filters.search)
const searchTerm = ref(savedViewState.filters.search)
const typeFilter = ref(savedViewState.filters.type)
const statusFilter = ref(savedViewState.filters.status)
const departmentFilter = ref(savedViewState.filters.department)

interface NodeTooltip {
  visible: boolean
  x: number
  y: number
  type: string
  typeLabel: string
  label: string
  props: Array<{ key: string; value: string }>
}

const tooltip = ref<NodeTooltip>({
  visible: false,
  x: 0,
  y: 0,
  type: '',
  typeLabel: '',
  label: '',
  props: [],
})
let tooltipTimer: ReturnType<typeof setTimeout> | null = null
const TOOLTIP_DURATION_MS = 3000

let network: Network | null = null
let nodesData: DataSet<any> | null = null
let edgesData: DataSet<any> | null = null
let debounceTimer: ReturnType<typeof setTimeout> | null = null
let resizeObserver: ResizeObserver | null = null
let lastSignature = ''
let filterPersistTimer: ReturnType<typeof setTimeout> | null = null
let viewportPersistTimer: ReturnType<typeof setTimeout> | null = null
let pendingViewport: GraphViewport | null = savedViewState.viewport
let viewportRestored = !savedViewState.viewport
let layoutGeneration = 0
let physicsSettleTimer: ReturnType<typeof setTimeout> | null = null
const PHYSICS_SETTLE_MS = 900

const nodeId = (node: ExplorerNode): string => graphNodeId(node)
const renderedCount = ref(0)

const typeOptions = computed(() =>
  unique(
    props.nodes
      .map((node) => node.type)
      .filter((value): value is string => typeof value === 'string' && value.trim() !== ''),
  ),
)
const statusOptions = computed(() =>
  unique(props.nodes.map((node) => node.properties?.status).filter((value): value is string => !!value)),
)
const departmentOptions = computed(() =>
  unique(props.nodes.map((node) => node.properties?.department).filter((value): value is string => !!value)),
)

function currentFilters(): GraphFilters {
  return {
    type: typeFilter.value,
    status: statusFilter.value,
    department: departmentFilter.value,
    term: searchTerm.value,
  }
}

const sourceTruncated = computed(
  () => props.nodes.filter((node) => matchesGraphFilters(node, currentFilters())).length > props.maxNodes,
)

const selectedLabel = computed(() => {
  const node = props.nodes.find((candidate) => nodeId(candidate) === props.selected)
  return node ? entityLabel(node) : ''
})

const displayedCount = computed(() => renderedCount.value)

function hideTooltip(): void {
  if (tooltipTimer) {
    clearTimeout(tooltipTimer)
    tooltipTimer = null
  }
  tooltip.value.visible = false
}

function showTooltip(nodeKey: string): void {
  if (!network || !graphContainer.value) return
  const node = props.nodes.find((candidate) => nodeId(candidate) === nodeKey)
  if (!node) return
  const position = network.getPositions([nodeKey])[nodeKey]
  if (!position) return
  const dom = network.canvasToDOM(position)
  const canvasRect = graphContainer.value.getBoundingClientRect()
  const wrapRect = graphWrapper.value?.getBoundingClientRect()
  const offsetX = wrapRect ? canvasRect.left - wrapRect.left : 0
  const offsetY = wrapRect ? canvasRect.top - wrapRect.top : 0
  const width = graphWrapper.value?.clientWidth || graphContainer.value.clientWidth || 0
  const x = width > 0 ? Math.min(Math.max(dom.x + offsetX, 90), width - 90) : dom.x + offsetX
  const y = Math.max(12, dom.y + offsetY - 18)
  const entries = Object.entries(node.properties ?? {}).slice(0, 6)
  tooltip.value = {
    visible: true,
    x,
    y,
    type: node.type || 'Unknown',
    typeLabel: GRAPH_TYPE_LABELS[node.type] ?? '',
    label: entityLabel(node),
    props: entries.map(([key, value]) => ({
      key,
      value: String(value).length > 80 ? `${String(value).slice(0, 77)}...` : String(value),
    })),
  }
  if (tooltipTimer) clearTimeout(tooltipTimer)
  tooltipTimer = setTimeout(() => {
    tooltip.value.visible = false
    tooltipTimer = null
  }, TOOLTIP_DURATION_MS)
}

function unique(values: string[]): string[] {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b))
}

function handleDepthChange(event: Event): void {
  const next = Number((event.target as HTMLSelectElement).value)
  if (next === 1 || next === 2 || next === 3) {
    emit('depth-change', next)
  }
}

function persistFilters(): void {
  patchGraphViewState({
    filters: {
      type: typeFilter.value,
      status: statusFilter.value,
      department: departmentFilter.value,
      search: searchInput.value,
    },
  })
}

function scheduleFilterPersist(): void {
  if (filterPersistTimer) clearTimeout(filterPersistTimer)
  filterPersistTimer = setTimeout(() => {
    filterPersistTimer = null
    persistFilters()
  }, 200)
}

function captureViewport(): GraphViewport | null {
  if (!network) return null
  const position = network.getViewPosition()
  const scale = network.getScale()
  if (!Number.isFinite(scale) || scale <= 0) return null
  if (!Number.isFinite(position.x) || !Number.isFinite(position.y)) return null
  return { scale, position: { x: position.x, y: position.y } }
}

function persistViewport(): void {
  if (!viewportRestored) return
  if (!nodesData || (nodesData.getIds() as string[]).length === 0) return
  const viewport = captureViewport()
  if (viewport) patchGraphViewState({ viewport })
}

function scheduleViewportPersist(): void {
  if (!viewportRestored) return
  if (viewportPersistTimer) clearTimeout(viewportPersistTimer)
  viewportPersistTimer = setTimeout(() => {
    viewportPersistTimer = null
    persistViewport()
  }, 250)
}

function enableDragPhysics(): void {
  if (physicsSettleTimer) {
    clearTimeout(physicsSettleTimer)
    physicsSettleTimer = null
  }
  network?.setOptions({ physics: { enabled: true } })
}

function schedulePhysicsStop(): void {
  if (physicsSettleTimer) clearTimeout(physicsSettleTimer)
  physicsSettleTimer = setTimeout(() => {
    physicsSettleTimer = null
    network?.setOptions({ physics: { enabled: false } })
  }, PHYSICS_SETTLE_MS)
}

function flushOnPageHide(): void {
  if (filterPersistTimer) {
    clearTimeout(filterPersistTimer)
    filterPersistTimer = null
  }
  if (viewportPersistTimer) {
    clearTimeout(viewportPersistTimer)
    viewportPersistTimer = null
  }
  persistFilters()
  persistViewport()
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

  const visibleNodes = selectVisibleGraphNodes(
    props.nodes,
    currentFilters(),
    props.maxNodes,
    props.selected,
  )
  const visibleIds = new Set(visibleNodes.map(nodeId))
  // Relayout only when the source graph changes, not on every filter keystroke.
  const signature = `${props.nodes.map(nodeId).join('|')}#${props.maxNodes}`

  const existingNodeIds = nodesData.getIds() as string[]
  const staleNodeIds = existingNodeIds.filter((id) => !visibleIds.has(id))
  if (staleNodeIds.length > 0) nodesData.remove(staleNodeIds)

  nodesData.update(visibleNodes.map(nodeVisual))

  const desiredEdges = props.edges.filter(
    (edge) => visibleIds.has(edge.from) && visibleIds.has(edge.to),
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

  renderedCount.value = (nodesData.getIds() as string[]).length

  if (signature !== lastSignature) {
    lastSignature = signature
    relayout()
  }
}

function relayout(): void {
  if (!network) return
  if (physicsSettleTimer) {
    clearTimeout(physicsSettleTimer)
    physicsSettleTimer = null
  }
  const generation = ++layoutGeneration
  network.setOptions({ physics: { enabled: true } })
  network.stabilize(60)
  network.once('stabilizationIterationsDone', () => {
    if (!network || generation !== layoutGeneration) return
    network.setOptions({ physics: { enabled: false } })
    const hasNodes = ((nodesData?.getIds() as string[]) ?? []).length > 0
    if (pendingViewport && hasNodes) {
      const target = pendingViewport
      pendingViewport = null
      viewportRestored = true
      network.moveTo({ scale: target.scale, position: target.position, animation: false })
      return
    }
    if (!pendingViewport) {
      network.fit({ animation: false })
    }
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
    hideTooltip()
    if (params.nodes.length > 0) selectNode(params.nodes[0])
  })
  network.on('hoverNode', (params: { node: string }) => showTooltip(params.node))
  network.on('blurNode', () => hideTooltip())
  network.on('dragStart', (params: { nodes: string[] }) => {
    hideTooltip()
    if (params.nodes.length > 0) enableDragPhysics()
  })
  network.on('zoom', () => {
    hideTooltip()
    scheduleViewportPersist()
  })
  network.on('dragEnd', (params: { nodes: string[] }) => {
    scheduleViewportPersist()
    if (params.nodes.length > 0) schedulePhysicsStop()
  })
  window.addEventListener('pagehide', flushOnPageHide)

  // vis-network keeps the initial container size; observe layout changes so the
  // canvas fills the card instead of rendering into a short strip.
  resizeObserver = new ResizeObserver(() => {
    if (!network || !graphContainer.value) return
    const width = graphContainer.value.clientWidth
    const height = graphContainer.value.clientHeight
    if (width > 0 && height > 0) {
      network.setSize(`${width}px`, `${height}px`)
      network.redraw()
    }
  })
  resizeObserver.observe(graphContainer.value)

  syncData()
})

onUnmounted(() => {
  if (debounceTimer) clearTimeout(debounceTimer)
  if (tooltipTimer) clearTimeout(tooltipTimer)
  if (filterPersistTimer) clearTimeout(filterPersistTimer)
  if (viewportPersistTimer) clearTimeout(viewportPersistTimer)
  if (physicsSettleTimer) clearTimeout(physicsSettleTimer)
  window.removeEventListener('pagehide', flushOnPageHide)
  resizeObserver?.disconnect()
  resizeObserver = null
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
watch([searchTerm, typeFilter, statusFilter, departmentFilter], () => syncData())
watch([searchInput, typeFilter, statusFilter, departmentFilter], () => scheduleFilterPersist())
watch([typeOptions, statusOptions, departmentOptions], () => {
  if (props.nodes.length === 0) return
  let changed = false
  if (typeFilter.value && !typeOptions.value.includes(typeFilter.value)) {
    typeFilter.value = ''
    changed = true
  }
  if (statusFilter.value && !statusOptions.value.includes(statusFilter.value)) {
    statusFilter.value = ''
    changed = true
  }
  if (departmentFilter.value && !departmentOptions.value.includes(departmentFilter.value)) {
    departmentFilter.value = ''
    changed = true
  }
  if (changed) persistFilters()
}, { immediate: true })
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
.explorer-toolbar select {
  width: auto;
  flex: 0 0 auto;
}
.depth-select {
  width: auto;
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
.graph-canvas-wrap {
  position: relative;
  flex: 0 0 560px;
  height: 560px;
  min-height: 460px;
}
.graph-canvas {
  position: relative;
  width: 100%;
  height: 100%;
  box-sizing: border-box;
  border-radius: var(--radius-md);
  background: #fafbfc;
  border: 1px solid #e5e7eb;
  box-shadow: inset 0 0 30px rgba(0, 0, 0, 0.03);
}
.graph-tooltip {
  position: absolute;
  z-index: 20;
  transform: translate(-50%, -100%);
  min-width: 120px;
  max-width: 280px;
  padding: 8px 10px;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  background: var(--bg-card);
  color: var(--text-primary);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.12);
  font-size: 0.75rem;
  line-height: 1.35;
  pointer-events: none;
  white-space: normal;
}
.graph-tooltip-type {
  font-weight: 600;
}
.graph-tooltip-label {
  margin-top: 2px;
  color: var(--text-secondary);
  word-break: break-all;
}
.graph-tooltip-props {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 2px 8px;
  margin: 6px 0 0;
  color: var(--text-secondary);
}
.graph-tooltip-props dt {
  font-weight: 600;
  white-space: nowrap;
}
.graph-tooltip-props dd {
  margin: 0;
  word-break: break-all;
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
