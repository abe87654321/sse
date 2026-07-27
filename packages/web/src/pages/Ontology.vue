<template>
  <div class="ontology-page">
    <div class="page-header">
      <h2 class="page-header-title">本体可视化</h2>
      <div class="header-spacer"></div>
      <button class="btn-secondary btn-sm" @click="syncFromDB" :disabled="syncing">从数据库同步</button>
    </div>

    <div class="card nl-input-section">
      <label>自然语言描述（描述实体和关系）</label>
      <div class="nl-input-row">
        <input
          v-model="nlText"
          placeholder='例如：张三属于技术部，提交了报销单RE-001，包含住宿费2000元，由李四审批'
          @keyup.enter="generateFromText"
        />
        <button class="btn-primary btn-sm" @click="generateFromText" :disabled="generating || !nlText.trim()">
          {{ generating ? '生成中...' : '生成本体' }}
        </button>
      </div>
    </div>

    <div v-if="showManualAdd" class="card manual-add-section">
      <div class="manual-row">
        <input v-model="newNodeUri" placeholder="URI (如 person/zhangsan)" class="input-sm" />
        <input v-model="newNodeType" placeholder="类型 (如 Person)" class="input-sm" />
        <input v-model="newNodeProps" placeholder='属性 (JSON, 如 {"name":"张三"})' class="input-sm" />
        <button class="btn-secondary btn-sm" @click="addNode">+ 添加节点</button>
      </div>
      <div class="manual-row" style="margin-top:8px">
        <input v-model="newRelFrom" placeholder="来源 URI" class="input-sm" />
        <input v-model="newRelPredicate" placeholder="关系 (如 submittedBy)" class="input-sm" />
        <input v-model="newRelTo" placeholder="目标 URI" class="input-sm" />
        <button class="btn-secondary btn-sm" @click="addRelation">+ 添加关系</button>
      </div>
    </div>
    <div class="toolbar-row">
      <button class="btn-text btn-sm" @click="showManualAdd = !showManualAdd">
        {{ showManualAdd ? '收起' : '+ 手动添加' }}
      </button>
      <span class="text-muted" style="font-size:0.78rem">节点: {{ graph.nodes.length }} · 边: {{ graph.edges.length }}</span>
    </div>

    <div class="card graph-container" ref="graphContainer"></div>

    <div v-if="selectedNode" class="card properties-panel">
      <h4>{{ selectedNode.label }}</h4>
      <div class="prop-item"><span class="prop-label">URI：</span>{{ selectedNode.id }}</div>
      <div class="prop-item"><span class="prop-label">类型：</span>{{ selectedNode.type }}</div>
      <div v-for="(val, key) in editableProps" :key="key" class="prop-item prop-editable">
        <span class="prop-label">{{ key }}：</span>
        <input v-model="editableProps[key]" class="input-sm" />
      </div>
      <div class="prop-actions">
        <button class="btn-primary btn-sm" @click="saveNode">保存</button>
        <button class="btn-danger btn-sm" @click="deleteSelectedNode">删除</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted, onUnmounted, nextTick, watch } from 'vue'
import api from '../api/index'
import cytoscape, { type Core, type NodeSingular } from 'cytoscape'

const graphContainer = ref<HTMLElement | null>(null)
const graph = ref<{ nodes: any[]; edges: any[] }>({ nodes: [], edges: [] })
const selectedNode = ref<any>(null)
const editableProps = reactive<Record<string, string>>({})
const generating = ref(false)
const syncing = ref(false)
const nlText = ref('')
const showManualAdd = ref(false)
const newNodeUri = ref('')
const newNodeType = ref('')
const newNodeProps = ref('')
const newRelFrom = ref('')
const newRelPredicate = ref('')
const newRelTo = ref('')

let cy: Core | null = null

const COLORS: Record<string, string> = {
  Person: '#f97316', Department: '#6366f1', Company: '#a855f7',
  Report: '#10b981', DraftReport: '#94a3b8', PendingReport: '#f59e0b',
  ApprovedReport: '#10b981', ExpenseItem: '#3b82f6', Invoice: '#ef4444',
  ApprovalRule: '#ec4899', Approver: '#14b8a6', Unknown: '#6b7280',
}

watch(selectedNode, (node) => {
  if (node) {
    editableProps.name = node.properties?.name || ''
    editableProps.department = node.properties?.department || ''
    editableProps.title = node.properties?.title || ''
    editableProps.amount = node.properties?.amount || ''
    editableProps.status = node.properties?.status || ''
    editableProps.serialNo = node.properties?.serialNo || ''
    for (const [k, v] of Object.entries(node.properties || {})) {
      if (!(k in editableProps)) editableProps[k] = v as string
    }
  }
})

function buildCyElements() {
  const nodes = graph.value.nodes.map((n: any) => ({
    data: {
      id: n.id,
      label: n.label || n.id.split('/').pop() || n.id,
      type: n.type,
      color: COLORS[n.type] || COLORS.Unknown,
      propsJson: JSON.stringify(n.properties || {}),
    },
  }))
  const edges = graph.value.edges.map((e: any) => ({
    data: {
      id: e.id,
      source: e.from,
      target: e.to,
      label: e.label,
    },
  }))
  return nodes.concat(edges as any)
}

function initCytoscape() {
  if (!graphContainer.value) return
  if (cy) cy.destroy()
  cy = cytoscape({
    container: graphContainer.value,
    elements: buildCyElements(),
    style: [
      { selector: 'node', style: { 'label': 'data(label)', 'background-color': 'data(color)', 'color': '#fff', 'text-valign': 'bottom', 'text-halign': 'center', 'font-size': '10px', 'text-margin-y': 6, 'width': 48, 'height': 48, 'text-outline-width': 1, 'text-outline-color': '#1e1e2e' } },
      { selector: 'edge', style: { 'label': 'data(label)', 'curve-style': 'bezier', 'line-color': '#64748b', 'target-arrow-color': '#64748b', 'target-arrow-shape': 'triangle', 'width': 1.5, 'font-size': '9px', 'color': '#94a3b8', 'text-rotation': 'autorotate' } },
    ],
    layout: { name: 'cose', animate: false, padding: 50, nodeRepulsion: () => 4000, idealEdgeLength: () => 120 },
    minZoom: 0.1,
    maxZoom: 4,
  })
  cy.on('tap', 'node', (evt) => {
    const data = (evt.target as NodeSingular).data()
    let props: Record<string, string> = {}
    try { props = JSON.parse(data.propsJson || '{}') } catch { /* */ }
    selectedNode.value = { id: data.id, label: data.label, type: data.type, properties: props }
  })
  cy.on('tap', (evt) => {
    if (evt.target === cy) selectedNode.value = null
  })
}

async function fetchGraph() {
  try {
    const res = await api.get('/ontology/graph')
    graph.value = res.data
    await nextTick()
    initCytoscape()
  } catch (err: any) { console.error('加载图谱失败', err) }
}

async function generateFromText() {
  if (!nlText.value.trim()) return
  generating.value = true
  try {
    const res = await api.post('/ontology/from-text', { text: nlText.value })
    graph.value = res.data.graph
    nlText.value = ''
    await nextTick()
    initCytoscape()
  } catch (err: any) { alert('生成失败: ' + (err.response?.data?.message || err.message)) }
  finally { generating.value = false }
}

async function syncFromDB() {
  syncing.value = true
  try {
    await api.get('/ontology/sync')
    await fetchGraph()
  } catch (err: any) { alert('同步失败: ' + (err.response?.data?.message || err.message)) }
  finally { syncing.value = false }
}

async function saveNode() {
  if (!selectedNode.value) return
  try {
    await api.put('/ontology/entity', { uri: selectedNode.value.id, type: selectedNode.value.type, properties: { ...editableProps } })
    if (selectedNode.value) selectedNode.value.properties = { ...editableProps }
  } catch (err: any) { alert('保存失败: ' + (err.response?.data?.message || err.message)) }
}

async function deleteSelectedNode() {
  if (!selectedNode.value) return
  if (!confirm('确定删除此节点？')) return
  try {
    await api.delete(`/ontology/entity?uri=${encodeURIComponent(selectedNode.value.id)}`)
    selectedNode.value = null
    await fetchGraph()
  } catch (err: any) { alert('删除失败: ' + (err.response?.data?.message || err.message)) }
}

async function addNode() {
  if (!newNodeUri.value || !newNodeType.value) { alert('请填写 URI 和类型'); return }
  let props: Record<string, string> = {}
  try { if (newNodeProps.value.trim()) props = JSON.parse(newNodeProps.value) } catch { alert('属性 JSON 格式错误'); return }
  try {
    await api.put('/ontology/entity', { uri: newNodeUri.value, type: newNodeType.value, properties: props })
    newNodeUri.value = ''; newNodeType.value = ''; newNodeProps.value = ''
    await fetchGraph()
  } catch (err: any) { alert('添加失败: ' + (err.response?.data?.message || err.message)) }
}

async function addRelation() {
  if (!newRelFrom.value || !newRelTo.value || !newRelPredicate.value) { alert('请填写完整'); return }
  try {
    await api.post('/ontology/relation', { from: newRelFrom.value, to: newRelTo.value, predicate: newRelPredicate.value })
    newRelFrom.value = ''; newRelTo.value = ''; newRelPredicate.value = ''
    await fetchGraph()
  } catch (err: any) { alert('添加失败: ' + (err.response?.data?.message || err.message)) }
}

onMounted(fetchGraph)
onUnmounted(() => { if (cy) cy.destroy() })
</script>

<style scoped>
.ontology-page { max-width: 100%; }
.header-spacer { flex: 1; }
.nl-input-section { margin-bottom: 12px; padding: 14px 18px; }
.nl-input-section label { font-weight: 600; font-size: 0.88rem; display: block; margin-bottom: 8px; color: var(--text-primary); }
.nl-input-row { display: flex; gap: 8px; }
.nl-input-row input { flex: 1; }
.manual-add-section { margin-bottom: 12px; padding: 12px 18px; }
.manual-row { display: flex; gap: 8px; align-items: center; }
.manual-row input { flex: 1; }
.input-sm { height: 32px; font-size: 0.82rem; padding: 0 8px; border: 1px solid var(--border); border-radius: var(--radius-sm); background: var(--bg-card); color: var(--text-primary); }
.btn-text { background: none; color: var(--accent-coral); font-weight: 500; border-radius: var(--radius-sm); transition: all var(--transition); }
.btn-text:hover { background: var(--accent-coral-bg); }
.toolbar-row { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; }
.graph-container { height: 520px; padding: 0; overflow: hidden; border-radius: var(--radius); }
.properties-panel { margin-top: 12px; padding: 16px 20px; }
.properties-panel h4 { margin: 0 0 10px; font-size: 0.95rem; color: var(--accent-coral); }
.prop-item { margin-bottom: 6px; font-size: 0.85rem; display: flex; align-items: center; }
.prop-label { font-weight: 600; color: var(--text-secondary); min-width: 70px; }
.prop-editable input { flex: 1; }
.prop-actions { margin-top: 12px; display: flex; gap: 8px; }
</style>
