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
        <div class="sync-inline" v-if="status">
          <span>v{{ status.version }}</span>
          <span>{{ status.counts?.quads ?? 0 }} quads</span>
          <span>{{ status.counts?.subjects ?? 0 }} subjects</span>
          <span :class="{ warning: status.lagSeconds > 30 }">延迟 {{ status.lagSeconds }}s</span>
          <span :class="{ warning: status.outboxPending > 0 }">待处理 {{ status.outboxPending }}</span>
        </div>
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

    <div v-if="activeTab === 'explorer'" class="explorer-layout">
      <GraphExplorer
        :nodes="graphNodes"
        :edges="graphEdges"
        :selected="selectedUri"
        :loading="graphLoading"
        :max-nodes="400"
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

    <div v-else class="panel-stub card">
      <p>该面板将在任务 6.3 接入。</p>
    </div>

    <section v-if="isAdmin" class="admin-tools card">
      <button type="button" class="admin-toggle" @click="showAdmin = !showAdmin">
        {{ showAdmin ? '收起管理员工具' : '展开管理员工具（手动编辑）' }}
      </button>
      <div v-if="showAdmin" class="admin-body">
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
        <p v-if="adminMessage" class="admin-message">{{ adminMessage }}</p>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
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
import { entityLabel } from '../components/ontology/utils'

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
const activeTab = ref<TabId>('explorer')
const status = ref<OntologyStatus | null>(null)
const graphNodes = ref<WorkbenchNode[]>([])
const graphEdges = ref<WorkbenchEdge[]>([])
const graphLoading = ref(false)
const selectedUri = ref<string | null>(null)
const entity = ref<EntityDetailModel | null>(null)
const explanation = ref<Explanation | null>(null)
const detailLoading = ref(false)
const detailError = ref<string | null>(null)
const depth = ref(2)
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
    label: node.label || entityLabel(node),
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

async function loadStatus(): Promise<void> {
  try {
    const response = await ontologyApi.status()
    status.value = response.data
    disabled.value = false
  } catch (err) {
    if (isUnavailable(err)) {
      disabled.value = true
      status.value = null
    } else {
      serviceError.value = errorMessage(err)
    }
  }
}

async function loadGraph(): Promise<void> {
  graphLoading.value = true
  try {
    const response = await ontologyApi.graph()
    const normalized = normalizeGraph(response.data)
    graphNodes.value = normalized.nodes
    graphEdges.value = normalized.edges
    disabled.value = false
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

async function loadEntity(uri: string): Promise<void> {
  detailLoading.value = true
  detailError.value = null
  explanation.value = null
  try {
    const response = await ontologyApi.entity(uri)
    entity.value = response.data
    if (isReport(response.data)) {
      await loadExplanation(uri)
    }
  } catch (err) {
    entity.value = null
    detailError.value = errorMessage(err)
    if (isUnavailable(err)) disabled.value = true
  } finally {
    detailLoading.value = false
  }
}

function isReport(detail: EntityDetailModel): boolean {
  return detail.type === 'ExpenseReport' || detail.uri.includes('/report/')
}

async function loadExplanation(uri: string): Promise<void> {
  try {
    const response = await ontologyApi.explain(uri)
    explanation.value = response.data
  } catch (err) {
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
    label: node.label || entityLabel(node),
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

async function refresh(): Promise<void> {
  serviceError.value = null
  await Promise.all([loadStatus(), loadGraph()])
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
  try {
    await api.put('/ontology/entity', {
      uri: newNodeUri.value,
      type: newNodeType.value,
      properties,
    })
    newNodeUri.value = ''
    newNodeType.value = ''
    newNodeProps.value = ''
    adminMessage.value = '节点已保存'
    await loadGraph()
  } catch (err) {
    adminMessage.value = `保存失败：${errorMessage(err)}`
  }
}

async function addRelation(): Promise<void> {
  if (!newRelFrom.value || !newRelPredicate.value || !newRelTo.value) {
    adminMessage.value = '请填写完整的关系信息'
    return
  }
  try {
    await api.post('/ontology/relation', {
      from: newRelFrom.value,
      predicate: newRelPredicate.value,
      to: newRelTo.value,
    })
    newRelFrom.value = ''
    newRelPredicate.value = ''
    newRelTo.value = ''
    adminMessage.value = '关系已保存'
    await loadGraph()
  } catch (err) {
    adminMessage.value = `保存失败：${errorMessage(err)}`
  }
}

async function generateFromText(): Promise<void> {
  if (!nlText.value.trim()) return
  generating.value = true
  adminMessage.value = ''
  try {
    await api.post('/ontology/from-text', { text: nlText.value })
    nlText.value = ''
    adminMessage.value = '本体已生成'
    await loadGraph()
  } catch (err) {
    adminMessage.value = `生成失败：${errorMessage(err)}`
  } finally {
    generating.value = false
  }
}

onMounted(async () => {
  await Promise.all([loadStatus(), loadGraph()])
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
.sync-inline {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  font-size: 0.76rem;
  color: var(--text-secondary);
}
.sync-inline .warning {
  color: #b45309;
  font-weight: 600;
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
.panel-stub {
  padding: 24px;
  color: var(--text-secondary);
  font-size: 0.86rem;
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
.admin-message {
  margin: 0;
  font-size: 0.78rem;
  color: var(--accent-coral);
}
@media (max-width: 1024px) {
  .explorer-layout {
    grid-template-columns: 1fr;
  }
}
</style>
