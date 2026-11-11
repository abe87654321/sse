<template>
  <div class="ontology-page">
    <div v-if="disabled" class="banner banner-warning">
      <strong>本体 v2 查询服务未启用。</strong>
      <span>当前仅显示旧版图谱视图；校验、影响分析、异常与解释功能需要设置 ONTOLOGY_V2=on 或 shadow 后重启 API。</span>
    </div>
    <div v-else-if="serviceError" class="banner banner-error">
      <strong>本体服务请求失败。</strong>
      <span>{{ serviceError }}</span>
    </div>

    <header class="workbench-header">
      <div>
        <h1 class="workbench-title">本体工作台</h1>
        <p class="workbench-subtitle">图谱探索、业务校验、影响分析与异常监控</p>
      </div>
      <div class="header-actions">
        <SyncStatus
          @status="handleStatus"
          @unavailable="disabled = true"
          @error="serviceError = $event"
        />
        <button class="btn-secondary btn-sm" :disabled="graphLoading" @click="refresh">
          {{ graphLoading ? '刷新中...' : '刷新' }}
        </button>
      </div>
    </header>

    <nav class="workbench-tabs">
      <button
        v-for="tab in tabs"
        :key="tab.id"
        type="button"
        class="tab-button"
        :class="{ active: activeTab === tab.id }"
        @click="activeTab = tab.id"
      >
        {{ tab.label }}
      </button>
    </nav>

    <div v-show="activeTab === 'explorer'" class="explorer-tab">
      <div class="explorer-layout">
        <GraphExplorer
          :nodes="graphNodes"
          :edges="graphEdges"
          :selected="selectedUri"
          :loading="graphLoading"
          :max-nodes="400"
          :depth="depth"
          @select="selectEntity"
          @depth-change="handleDepthChange"
          @refresh="refresh"
        />
        <EntityDetail
          :entity="entity"
          :explanation="explanation"
          :loading="detailLoading"
          :error="detailError"
          @select="selectEntity"
        />
      </div>
      <section class="card legend-panel" aria-label="图例">
        <h4>图例</h4>
        <div class="legend-grid">
          <div v-for="item in legendItems" :key="item.type" class="legend-item">
            <span class="legend-dot" :style="{ background: item.color }"></span>
            <span>{{ item.type }}<template v-if="item.label"> ({{ item.label }})</template></span>
          </div>
        </div>
      </section>
    </div>

    <ValidationPanel
      v-if="activeTab === 'validate'"
      @select="openEntity"
    />
    <ImpactPanel
      v-else-if="activeTab === 'impact'"
      @select="openEntity"
    />
    <AnomalyPanel
      v-else-if="activeTab === 'anomalies'"
      @select="openEntity"
    />

    <section v-if="isAdmin" class="admin-tools card">
      <button type="button" class="admin-toggle" @click="showAdmin = !showAdmin">
        {{ showAdmin ? '收起管理员工具' : '展开管理员工具（手动编辑）' }}
      </button>
      <div v-if="showAdmin" class="admin-body">
        <p class="admin-hint">
          手动编辑在 ONTOLOGY_V2=on/shadow 时写入 <code>urn:sse:manual</code> 并持久化为快照；
          关闭 v2 时仍写入旧版本体库。保存成功后图谱会立即刷新。
        </p>
        <div class="admin-row">
          <input v-model="newNodeUri" class="input-sm" placeholder="URI（如 person/zhangsan）" />
          <input v-model="newNodeType" class="input-sm" placeholder="类型（如 Person）" />
          <input v-model="newNodeProps" class="input-sm" placeholder='属性 JSON（如 {"name":"张三"}）' />
          <button class="btn-secondary btn-sm" @click="addNode">+ 节点</button>
        </div>
        <div class="admin-row">
          <input v-model="newRelFrom" class="input-sm" placeholder="来源 URI" />
          <input v-model="newRelPredicate" class="input-sm" placeholder="关系谓词" />
          <input v-model="newRelTo" class="input-sm" placeholder="目标 URI" />
          <button class="btn-secondary btn-sm" @click="addRelation">+ 关系</button>
        </div>
        <div class="admin-row nl-row">
          <input
            v-model="nlText"
            class="input-sm"
            placeholder="自然语言生成图谱，例如：张三属于技术部，提交了报销单 RE-001"
            @keyup.enter="generateFromText"
          />
          <button class="btn-primary btn-sm" :disabled="generating || !nlText.trim()" @click="generateFromText">
            {{ generating ? '生成中...' : '生成本体' }}
          </button>
        </div>
        <p
          v-if="adminMessage"
          class="admin-message"
          :class="{ 'admin-message-warning': adminWarning }"
        >{{ adminMessage }}</p>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import api from '../api/index'
import {
  ontologyApi,
  type EntityDetail as EntityDetailModel,
  type Explanation,
  type GraphNode,
  type NetworkResult,
  type OntologyGraphResponse,
  type OntologyStatus,
} from '../api/ontology'
import { useAuthStore } from '../stores/auth'
import GraphExplorer from '../components/ontology/GraphExplorer.vue'
import EntityDetail from '../components/ontology/EntityDetail.vue'
import ValidationPanel from '../components/ontology/ValidationPanel.vue'
import ImpactPanel from '../components/ontology/ImpactPanel.vue'
import AnomalyPanel from '../components/ontology/AnomalyPanel.vue'
import SyncStatus from '../components/ontology/SyncStatus.vue'
import { entityLabel } from '../components/ontology/utils'
import { graphLegendItems } from '../components/ontology/graph-style'
import { patchGraphViewState, readGraphViewState } from '../components/ontology/graph-view-state'

type TabId = 'explorer' | 'validate' | 'impact' | 'anomalies'

interface WorkbenchNode {
  id: string
  uri: string
  label: string
  type: string
  properties: Record<string, string>
}

interface WorkbenchEdge {
  id: string
  from: string
  to: string
  predicate?: string
  label: string
}

const tabs: Array<{ id: TabId; label: string }> = [
  { id: 'explorer', label: '图谱' },
  { id: 'validate', label: '校验' },
  { id: 'impact', label: '影响分析' },
  { id: 'anomalies', label: '异常' },
]

const auth = useAuthStore()
const savedViewState = readGraphViewState()
const activeTab = ref<TabId>('explorer')
const graphNodes = ref<WorkbenchNode[]>([])
const graphEdges = ref<WorkbenchEdge[]>([])
const legendItems = computed(() => graphLegendItems(graphNodes.value.map((node) => node.type)))
const graphLoading = ref(false)
const selectedUri = ref<string | null>(savedViewState.selectedUri)
const entity = ref<EntityDetailModel | null>(null)
const explanation = ref<Explanation | null>(null)
const detailLoading = ref(false)
const detailError = ref<string | null>(null)
const depth = ref(savedViewState.depth)
const disabled = ref(false)
const serviceError = ref<string | null>(null)

const showAdmin = ref(false)
const newNodeUri = ref('')
const newNodeType = ref('')
const newNodeProps = ref('')
const newRelFrom = ref('')
const newRelPredicate = ref('')
const newRelTo = ref('')
const nlText = ref('')
const generating = ref(false)
const adminMessage = ref('')
const adminWarning = ref(false)

const isAdmin = computed(() => auth.user?.role === 'admin')

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

function normalizeGraph(payload: OntologyGraphResponse): { nodes: WorkbenchNode[]; edges: WorkbenchEdge[] } {
  const rawNodes = payload.graph?.nodes ?? payload.nodes ?? []
  const rawEdges = payload.graph?.edges ?? payload.edges ?? []

  const nodes = rawNodes.map((node: GraphNode) => ({
    id: node.id || node.uri,
    uri: node.uri || node.id,
    label: entityLabel(node),
    type: node.type || '',
    properties: node.properties ?? {},
  }))
  const ids = new Set(nodes.map((node) => node.id))
  const edges = rawEdges
    .filter((edge) => ids.has(edge.from) && ids.has(edge.to))
    .map((edge) => ({
      id: edge.id,
      from: edge.from,
      to: edge.to,
      predicate: edge.predicate,
      label: edge.label || edge.predicate || '',
    }))

  return { nodes, edges }
}

function handleStatus(_status: OntologyStatus): void {
  disabled.value = false
  serviceError.value = null
}

async function loadGraph(): Promise<void> {
  graphLoading.value = true
  try {
    const response = await ontologyApi.graph()
    const normalized = normalizeGraph(response.data)
    graphNodes.value = normalized.nodes
    graphEdges.value = normalized.edges
    serviceError.value = null
  } catch (err) {
    if (isUnavailable(err)) disabled.value = true
    serviceError.value = errorMessage(err)
    graphNodes.value = []
    graphEdges.value = []
  } finally {
    graphLoading.value = false
  }
}

let entityRequestId = 0

async function loadEntity(uri: string): Promise<void> {
  const requestId = ++entityRequestId
  detailLoading.value = true
  detailError.value = null
  explanation.value = null
  try {
    const response = await ontologyApi.entity(uri)
    if (requestId !== entityRequestId) return
    entity.value = response.data
    if (isReport(response.data)) {
      await loadExplanation(uri, requestId)
    }
  } catch (err) {
    if (requestId !== entityRequestId) return
    entity.value = null
    detailError.value = errorMessage(err)
    if (isUnavailable(err)) disabled.value = true
  } finally {
    if (requestId === entityRequestId) detailLoading.value = false
  }
}

function isReport(detail: EntityDetailModel): boolean {
  return detail.type === 'ExpenseReport' || detail.uri.includes('/report/')
}

async function loadExplanation(uri: string, requestId: number): Promise<void> {
  try {
    const response = await ontologyApi.explain(uri)
    if (requestId !== entityRequestId) return
    explanation.value = response.data
  } catch (err) {
    if (requestId !== entityRequestId) return
    if (isUnavailable(err)) disabled.value = true
    explanation.value = null
  }
}

async function selectEntity(uri: string): Promise<void> {
  if (!uri || selectedUri.value === uri) return
  selectedUri.value = uri
  await loadEntity(uri)
}

async function loadNetwork(uri: string): Promise<void> {
  graphLoading.value = true
  try {
    const response = await ontologyApi.network(uri, depth.value, 'both')
    const normalized = normalizeNetwork(response.data)
    graphNodes.value = normalized.nodes
    graphEdges.value = normalized.edges
    serviceError.value = null
  } catch (err) {
    serviceError.value = errorMessage(err)
    if (isUnavailable(err)) disabled.value = true
  } finally {
    graphLoading.value = false
  }
}

function normalizeNetwork(payload: NetworkResult): { nodes: WorkbenchNode[]; edges: WorkbenchEdge[] } {
  const nodes = payload.nodes.map((node) => ({
    id: node.id || node.uri,
    uri: node.uri,
    label: entityLabel(node),
    type: node.type || '',
    properties: node.properties ?? {},
  }))
  const ids = new Set(nodes.map((node) => node.id))
  const edges = payload.edges
    .filter((edge) => ids.has(edge.from) && ids.has(edge.to))
    .map((edge) => ({
      id: edge.id,
      from: edge.from,
      to: edge.to,
      predicate: edge.predicate,
      label: edge.label || edge.predicate || '',
    }))
  return { nodes, edges }
}

async function handleDepthChange(nextDepth: number): Promise<void> {
  depth.value = nextDepth
  if (selectedUri.value) {
    await loadNetwork(selectedUri.value)
  }
}

async function openEntity(uri: string): Promise<void> {
  activeTab.value = 'explorer'
  if (selectedUri.value === uri) {
    await loadEntity(uri)
    return
  }
  await selectEntity(uri)
}

async function refresh(): Promise<void> {
  serviceError.value = null
  disabled.value = false
  await loadGraph()
  if (selectedUri.value) {
    await loadEntity(selectedUri.value)
  }
}

async function addNode(): Promise<void> {
  if (!newNodeUri.value || !newNodeType.value) {
    adminMessage.value = '请填写 URI 和类型'
    return
  }
  let properties: Record<string, string> = {}
  try {
    if (newNodeProps.value.trim()) properties = JSON.parse(newNodeProps.value)
  } catch {
    adminMessage.value = '属性 JSON 格式错误'
    return
  }
  adminWarning.value = false
  try {
    const response = await api.put('/ontology/entity', {
      uri: newNodeUri.value,
      type: newNodeType.value,
      properties,
    })
    newNodeUri.value = ''
    newNodeType.value = ''
    newNodeProps.value = ''
    adminWarning.value = response.data?.persisted === false
    adminMessage.value = adminWarning.value
      ? '节点已写入内存，但快照持久化失败；服务重启或重建后可能丢失'
      : '节点已保存'
    await loadGraph()
  } catch (err) {
    adminWarning.value = false
    adminMessage.value = `保存失败：${errorMessage(err)}`
  }
}

async function addRelation(): Promise<void> {
  if (!newRelFrom.value || !newRelPredicate.value || !newRelTo.value) {
    adminMessage.value = '请填写完整的关系信息'
    return
  }
  adminWarning.value = false
  try {
    const response = await api.post('/ontology/relation', {
      from: newRelFrom.value,
      predicate: newRelPredicate.value,
      to: newRelTo.value,
    })
    newRelFrom.value = ''
    newRelPredicate.value = ''
    newRelTo.value = ''
    adminWarning.value = response.data?.persisted === false
    adminMessage.value = adminWarning.value
      ? '关系已写入内存，但快照持久化失败；服务重启或重建后可能丢失'
      : '关系已保存'
    await loadGraph()
  } catch (err) {
    adminWarning.value = false
    adminMessage.value = `保存失败：${errorMessage(err)}`
  }
}

async function generateFromText(): Promise<void> {
  if (!nlText.value.trim()) return
  generating.value = true
  adminMessage.value = ''
  adminWarning.value = false
  try {
    const response = await api.post('/ontology/from-text', { text: nlText.value })
    nlText.value = ''
    adminWarning.value = response.data?.persisted === false
    adminMessage.value = adminWarning.value
      ? '本体已生成到内存，但快照持久化失败；服务重启或重建后可能丢失'
      : '本体已生成'
    await loadGraph()
  } catch (err) {
    adminWarning.value = false
    adminMessage.value = `生成失败：${errorMessage(err)}`
  } finally {
    generating.value = false
  }
}

watch(selectedUri, (uri) => {
  patchGraphViewState({ selectedUri: uri })
})
watch(depth, (value) => {
  patchGraphViewState({ depth: value })
})

onMounted(async () => {
  await loadGraph()
  if (selectedUri.value) {
    const uri = selectedUri.value
    await loadEntity(uri)
    if (!entity.value && !disabled.value) {
      selectedUri.value = null
    }
  }
})
</script>

<style scoped>
.ontology-page {
  max-width: 100%;
}
.banner {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 10px;
  align-items: baseline;
  padding: 10px 16px;
  margin-bottom: 14px;
  border-radius: var(--radius-sm);
  font-size: 0.84rem;
}
.banner-warning {
  background: rgba(245, 158, 11, 0.12);
  border: 1px solid rgba(245, 158, 11, 0.35);
}
.banner-error {
  background: rgba(220, 38, 38, 0.1);
  border: 1px solid rgba(220, 38, 38, 0.3);
}
.workbench-header {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 14px;
}
.workbench-title {
  font-family: Georgia, 'Times New Roman', serif;
  font-weight: bold;
  font-size: 30px;
  color: #111;
  margin: 0;
  line-height: 1.1;
}
.workbench-subtitle {
  font-family: Georgia, 'Times New Roman', serif;
  font-style: italic;
  font-size: 15px;
  color: #666;
  margin: 2px 0 0;
}
.header-actions {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}
.workbench-tabs {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-bottom: 12px;
  border-bottom: 1px solid var(--border-color);
}
.tab-button {
  border: none;
  background: none;
  padding: 8px 16px;
  font-size: 0.86rem;
  color: var(--text-secondary);
  cursor: pointer;
  border-bottom: 2px solid transparent;
  margin-bottom: -1px;
}
.tab-button.active {
  color: var(--text-primary);
  border-bottom-color: var(--accent-coral);
  font-weight: 600;
}
.explorer-layout {
  display: grid;
  grid-template-columns: minmax(0, 1.6fr) minmax(320px, 1fr);
  gap: 14px;
  align-items: start;
}
.legend-panel {
  margin-top: 12px;
  padding: 14px 18px;
}
.legend-panel h4 {
  margin: 0 0 8px;
  font-size: 0.88rem;
  color: var(--text-secondary);
}
.legend-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 12px 20px;
}
.legend-item {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 0.82rem;
  color: var(--text-secondary);
}
.legend-dot {
  width: 12px;
  height: 12px;
  border-radius: 2px;
  flex-shrink: 0;
}
.admin-tools {
  margin-top: 16px;
  padding: 12px 16px;
}
.admin-toggle {
  border: none;
  background: none;
  padding: 0;
  color: var(--text-secondary);
  font-size: 0.82rem;
  cursor: pointer;
}
.admin-body {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 10px;
}
.admin-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.admin-row .input-sm {
  flex: 1 1 160px;
  height: 32px;
  font-size: 0.8rem;
  padding: 0 8px;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-sm);
  background: var(--bg-card);
  color: var(--text-primary);
}
.nl-row {
  margin-top: 4px;
}
.admin-hint {
  margin: 0 0 6px;
  font-size: 0.76rem;
  line-height: 1.5;
  color: var(--text-secondary);
}
.admin-hint code {
  padding: 1px 5px;
  border-radius: 4px;
  background: rgba(0, 0, 0, 0.06);
  font-size: 0.74rem;
}
.admin-message {
  margin: 0;
  font-size: 0.78rem;
  color: var(--accent-coral);
}
.admin-message-warning {
  padding: 6px 10px;
  border-radius: var(--radius-sm);
  background: rgba(245, 158, 11, 0.12);
  border: 1px solid rgba(245, 158, 11, 0.35);
  color: #b45309;
}
@media (max-width: 1024px) {
  .explorer-layout {
    grid-template-columns: 1fr;
  }
}
</style>
