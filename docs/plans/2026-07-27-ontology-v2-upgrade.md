# 本体可视化升级 — 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 替换 Cytoscape.js 为 vis-network，新增合规校验 + 混合持久化 + 图例面板

**Architecture:** vis-network 开箱即用替代 cytoscape。OwlStore 新增 validateGraph/持久化方法，API 调用校验并写入 Turtle + DB。前端展示警告和图例。

**Tech Stack:** vis-network + vis-data, N3.js, PostgreSQL JSONB, Vue 3

---

### Task 1: OwlStore 新增 validateGraph + 持久化方法

**Files:**
- Modify: `packages/ontology/src/owl-store.ts`
- Modify: `packages/db/src/migrations/003_ontology_snapshots.sql` (新建)

- [ ] **Step 1: 新增 validateGraph 和持久化方法**

在 `packages/ontology/src/owl-store.ts` 的 `clear()` 方法后面追加：

```typescript
  validateGraph(): string[] {
    const warnings: string[] = [];
    const graph = this.getGraph();
    const nodeSet = new Set(graph.nodes.map(n => n.id));

    for (const e of graph.edges) {
      if (!nodeSet.has(e.from)) warnings.push(`关系 "${e.label}" 的来源实体不存在`);
      if (!nodeSet.has(e.to)) warnings.push(`关系 "${e.label}" 的目标实体不存在`);
    }

    const connectedIds = new Set<string>();
    for (const e of graph.edges) { connectedIds.add(e.from); connectedIds.add(e.to); }
    for (const id of nodeSet) {
      if (!connectedIds.has(id)) {
        const node = graph.nodes.find(n => n.id === id);
        warnings.push(`实体 "${node?.label || id}" 是孤立节点，没有任何关系连接`);
      }
    }

    const persons = this.queryByType('Person');
    for (const p of persons) {
      const hasDept = graph.edges.some(e => e.from === p.uri && e.label === 'belongsTo');
      if (!hasDept) warnings.push(`人员 ${p.properties.name || p.uri} 未绑定部门（缺少 belongsTo 关系）`);
    }

    return warnings;
  }

  async saveToDb(): Promise<void> {
    const { pool } = await import('@sse/db');
    const graph = this.getGraph();
    await pool.query(
      `INSERT INTO ontology_snapshots (graph) VALUES ($1)`,
      [JSON.stringify(graph)]
    );
  }

  async loadFromDb(): Promise<void> {
    const { pool } = await import('@sse/db');
    const { rows } = await pool.query(
      'SELECT graph FROM ontology_snapshots ORDER BY created_at DESC LIMIT 1'
    );
    if (rows.length === 0) return;
    const graph = rows[0].graph;
    if (!graph || !graph.nodes) return;
    this.clear();
    for (const node of (graph.nodes as any[])) {
      const uri = node.id.startsWith('http') ? node.id : `${this.baseUri}${node.id}`;
      this.addEntity(uri, node.type, node.properties || {});
    }
    for (const edge of (graph.edges as any[])) {
      this.addRelation(edge.from, edge.predicate || edge.label, edge.to);
    }
  }
```

- [ ] **Step 2: 创建迁移脚本**

`packages/db/src/migrations/003_ontology_snapshots.sql`:

```sql
CREATE TABLE IF NOT EXISTS ontology_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  graph JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ontology_snapshots_created ON ontology_snapshots(created_at DESC);
```

- [ ] **Step 3: 编译验证**

```bash
pnpm --filter @sse/ontology build
```

- [ ] **Step 4: 提交**

```bash
git add packages/ontology/src/owl-store.ts packages/db/src/migrations/003_ontology_snapshots.sql
git commit -m "feat: add validateGraph, saveToDb/loadFromDb to OwlStore, ontology_snapshots migration"
```

---

### Task 2: 替换 cytoscape → vis-network + 图例 + 警告显示

**Files:**
- Modify: `packages/web/src/pages/Ontology.vue` (重写)
- Modify: `packages/web/package.json` (卸载 cytoscape，安装 vis-network)

- [ ] **Step 1: 卸载 cytoscape，安装 vis-network**

```bash
pnpm --filter @sse/web remove cytoscape
pnpm --filter @sse/web add vis-network vis-data
```

- [ ] **Step 2: 重写 Ontology.vue**

用以下完整内容替换 `packages/web/src/pages/Ontology.vue`：

```vue
<template>
  <div class="ontology-page">
    <div class="page-header">
      <h2 class="page-header-title">本体可视化</h2>
      <div class="header-spacer"></div>
      <button class="btn-secondary btn-sm" @click="syncFromDB" :disabled="syncing">从数据库同步</button>
    </div>

    <div class="card nl-input-section">
      <label>自然语言描述</label>
      <div class="nl-input-row">
        <input v-model="nlText" placeholder='例如：张三属于技术部，提交了报销单RE-001，包含住宿费2000元，由李四审批' @keyup.enter="generateFromText" />
        <button class="btn-primary btn-sm" @click="generateFromText" :disabled="generating || !nlText.trim()">{{ generating ? '生成中...' : '生成本体' }}</button>
      </div>
    </div>

    <div class="card nl-input-section" style="padding:10px 18px">
      <div class="nl-input-row">
        <input v-model="searchQuery" placeholder="搜索节点..." class="input-sm" style="max-width:240px" @input="filterGraph" />
        <button class="btn-text btn-sm" @click="showManualAdd = !showManualAdd">{{ showManualAdd ? '收起' : '+ 手动添加' }}</button>
        <span class="text-muted" style="font-size:0.78rem;margin-left:auto">节点: {{ stats.nodes }} · 边: {{ stats.edges }}</span>
        <button class="btn-secondary btn-sm" @click="resetGraph">重置视图</button>
      </div>
    </div>

    <div v-if="showManualAdd" class="card manual-add-section">
      <div class="manual-row">
        <input v-model="newNodeUri" placeholder="URI (如 person/zhangsan)" class="input-sm" />
        <input v-model="newNodeType" placeholder="类型 (如 Person)" class="input-sm" />
        <input v-model="newNodeProps" placeholder='属性 (JSON, 如 {"name":"张三"})' class="input-sm" />
        <button class="btn-secondary btn-sm" @click="addNode">+ 节点</button>
      </div>
      <div class="manual-row" style="margin-top:8px">
        <input v-model="newRelFrom" placeholder="来源" class="input-sm" />
        <input v-model="newRelPredicate" placeholder="关系" class="input-sm" />
        <input v-model="newRelTo" placeholder="目标" class="input-sm" />
        <button class="btn-secondary btn-sm" @click="addRelation">+ 关系</button>
      </div>
    </div>

    <div v-if="warnings.length > 0" class="warnings-panel">
      <span>共 {{ warnings.length }} 个问题</span>
      <ul>
        <li v-for="(w, i) in warnings" :key="i">{{ w }}</li>
      </ul>
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

    <div class="card legend-panel">
      <h4>图例</h4>
      <div class="legend-grid">
        <div class="legend-item"><span class="legend-dot" style="background:#f97316"></span> Person (人员)</div>
        <div class="legend-item"><span class="legend-dot" style="background:#6366f1"></span> Department (部门)</div>
        <div class="legend-item"><span class="legend-dot" style="background:#10b981"></span> Report (报销单)</div>
        <div class="legend-item"><span class="legend-dot" style="background:#3b82f6"></span> ExpenseItem (费用项)</div>
        <div class="legend-item"><span class="legend-dot" style="background:#ef4444"></span> Invoice (发票)</div>
        <div class="legend-item"><span class="legend-dot" style="background:#ec4899"></span> ApprovalRule (规则)</div>
        <div class="legend-item"><span class="legend-dot" style="background:#14b8a6"></span> Approver (审批人)</div>
        <div class="legend-item"><span class="legend-dot" style="background:#a855f7"></span> Company (公司)</div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted, onUnmounted, nextTick, watch } from 'vue'
import { Network } from 'vis-network'
import { DataSet } from 'vis-data'
import api from '../api/index'

const graphContainer = ref<HTMLElement | null>(null)
const graph = ref<{ nodes: any[]; edges: any[] }>({ nodes: [], edges: [] })
const warnings = ref<string[]>([])
const stats = reactive({ nodes: 0, edges: 0 })
const selectedNode = ref<any>(null)
const editableProps = reactive<Record<string, string>>({})
const generating = ref(false)
const syncing = ref(false)
const nlText = ref('')
const searchQuery = ref('')
const showManualAdd = ref(false)
const newNodeUri = ref('')
const newNodeType = ref('')
const newNodeProps = ref('')
const newRelFrom = ref('')
const newRelPredicate = ref('')
const newRelTo = ref('')

let network: Network | null = null
let nodesData: DataSet<any> | null = null
let edgesData: DataSet<any> | null = null

const COLORS: Record<string, string> = {
  Person: '#f97316', Department: '#6366f1', Company: '#a855f7',
  Report: '#10b981', DraftReport: '#94a3b8', PendingReport: '#f59e0b',
  ApprovedReport: '#10b981', ExpenseItem: '#3b82f6', Invoice: '#ef4444',
  ApprovalRule: '#ec4899', Approver: '#14b8a6', Unknown: '#6b7280',
}

const SHAPES: Record<string, string> = {
  Person: 'dot', Department: 'diamond', Company: 'hexagon',
  ExpenseItem: 'triangle', Invoice: 'star', ApprovalRule: 'square',
  Approver: 'dot', Unknown: 'dot',
}

watch(selectedNode, (node) => {
  if (!node) return
  editableProps[''] = ''
  for (const k of Object.keys(editableProps)) delete editableProps[k]
  for (const [k, v] of Object.entries(node.properties || {})) editableProps[k] = v as string
})

function buildVisData() {
  const nodes = graph.value.nodes.map((n: any) => ({
    id: n.id,
    label: n.label || n.id.split('/').pop(),
    color: { background: COLORS[n.type] || COLORS.Unknown, border: '#1e1e2e', highlight: { background: COLORS[n.type] || COLORS.Unknown, border: '#fff' } },
    shape: SHAPES[n.type] || 'dot',
    size: 30,
    font: { color: '#e2e8f0', size: 12, face: 'Inter, sans-serif' },
    title: `${n.type}: ${n.label}\n${JSON.stringify(n.properties || {}, null, 2)}`,
  }))
  const edges = graph.value.edges.map((e: any) => ({
    id: e.id, from: e.from, to: e.to, label: e.label,
    arrows: 'to',
    color: { color: '#64748b', highlight: '#f59e0b' },
    font: { color: '#94a3b8', size: 10, align: 'middle' },
    smooth: { type: 'curvedCW', roundness: 0.2 },
  }))
  return { nodes: new DataSet(nodes), edges: new DataSet(edges) }
}

function initNetwork() {
  if (!graphContainer.value) return
  if (network) { network.destroy(); network = null }
  const { nodes, edges } = buildVisData()
  nodesData = nodes; edgesData = edges
  network = new Network(graphContainer.value, { nodes, edges }, {
    physics: { solver: 'forceAtlas2Based', forceAtlas2Based: { gravitationalConstant: -50, centralGravity: 0.01, springLength: 150, springConstant: 0.08 } },
    interaction: { hover: true, tooltipDelay: 200, navigationButtons: true, keyboard: true },
    edges: { smooth: { type: 'curvedCW', roundness: 0.2 } },
    layout: { improvedLayout: true },
  })
  network.on('click', (params: any) => {
    if (params.nodes.length > 0) {
      const nodeId = params.nodes[0]
      const n = graph.value.nodes.find((n: any) => n.id === nodeId)
      if (n) selectedNode.value = { id: n.id, label: n.label || n.type, type: n.type, properties: { ...n.properties } }
    } else {
      selectedNode.value = null
    }
  })
  network.on('doubleClick', (params: any) => {
    if (params.nodes.length > 0 && network) {
      const connectedNodes = network.getConnectedNodes(params.nodes[0])
      const allNodes = nodesData!.getIds() as string[]
      const grayIds = allNodes.filter(id => !connectedNodes.includes(id) && id !== params.nodes[0])
      const updates = grayIds.map(id => ({ id, opacity: 0.1 }))
      updates.push(...connectedNodes.map(id => ({ id, opacity: 1 })))
      updates.push({ id: params.nodes[0], opacity: 1 })
      nodesData!.update(updates)
      network.fit({ nodes: [params.nodes[0], ...connectedNodes], animation: true })
    }
  })

  setTimeout(() => { if (network) network.fit({ animation: { duration: 500, easingFunction: 'easeInOutQuad' } }) }, 300)
}

async function fetchGraph() {
  try {
    const res = await api.get('/ontology/graph')
    graph.value = res.data
    stats.nodes = res.data.nodes.length
    stats.edges = res.data.edges.length
    warnings.value = []
    await nextTick()
    initNetwork()
  } catch (err: any) { console.error('加载图谱失败', err) }
}

async function generateFromText() {
  if (!nlText.value.trim()) return
  generating.value = true
  try {
    const res = await api.post('/ontology/from-text', { text: nlText.value })
    graph.value = res.data.graph
    warnings.value = res.data.warnings || []
    stats.nodes = res.data.graph.nodes.length
    stats.edges = res.data.graph.edges.length
    nlText.value = ''
    await nextTick()
    initNetwork()
  } catch (err: any) { alert('生成失败: ' + (err.response?.data?.message || err.message)) }
  finally { generating.value = false }
}

async function syncFromDB() {
  syncing.value = true
  try {
    const res = await api.get('/ontology/sync')
    graph.value = res.data.graph
    warnings.value = res.data.warnings || []
    stats.nodes = res.data.graph.nodes.length
    stats.edges = res.data.graph.edges.length
    await nextTick()
    initNetwork()
  } catch (err: any) { alert('同步失败: ' + (err.response?.data?.message || err.message)) }
  finally { syncing.value = false }
}

function filterGraph() {
  if (!network || !nodesData) return
  const q = searchQuery.value.toLowerCase()
  const allIds = nodesData.getIds() as string[]
  const updates = allIds.map(id => ({ id, hidden: q ? !String(id).toLowerCase().includes(q) && !String(nodesData!.get(id)?.label).toLowerCase().includes(q) : false, opacity: 1 }))
  nodesData.update(updates)
}

function resetGraph() {
  if (!nodesData) return
  const allIds = nodesData.getIds() as string[]
  nodesData.update(allIds.map(id => ({ id, hidden: false, opacity: 1 })))
  if (network) network.fit({ animation: true })
  searchQuery.value = ''
}

async function saveNode() {
  if (!selectedNode.value) return
  try {
    const props: Record<string, string> = {}
    for (const [k, v] of Object.entries(editableProps)) { if (v) props[k] = v as string }
    await api.put('/ontology/entity', { uri: selectedNode.value.id, type: selectedNode.value.type, properties: props })
    if (selectedNode.value) selectedNode.value.properties = { ...props }
    await fetchGraph()
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

onMounted(async () => {
  await fetchGraph()
})

onUnmounted(() => { if (network) network.destroy() })
</script>

<style scoped>
.ontology-page { max-width: 100%; }
.header-spacer { flex: 1; }
.nl-input-section { margin-bottom: 12px; padding: 14px 18px; }
.nl-input-section label { font-weight: 600; font-size: 0.88rem; display: block; margin-bottom: 8px; color: var(--text-primary); }
.nl-input-row { display: flex; gap: 8px; align-items: center; }
.nl-input-row input { flex: 1; }
.manual-add-section { margin-bottom: 12px; padding: 12px 18px; }
.manual-row { display: flex; gap: 8px; align-items: center; }
.manual-row input { flex: 1; }
.input-sm { height: 32px; font-size: 0.82rem; padding: 0 8px; border: 1px solid var(--border-color); border-radius: var(--radius-sm); background: var(--bg-card); color: var(--text-primary); }
.warnings-panel {
  margin-bottom: 12px; padding: 10px 16px; border-radius: var(--radius-sm);
  background: rgba(245, 158, 11, 0.12); border: 1px solid rgba(245, 158, 11, 0.3);
  color: var(--text-primary); font-size: 0.85rem;
}
.warnings-panel ul { margin: 4px 0 0 16px; padding: 0; }
.warnings-panel li { margin-bottom: 2px; }
.graph-container { height: 540px; padding: 0; overflow: hidden; border-radius: var(--radius-md); background: #1a1a2e; }
.properties-panel { margin-top: 12px; padding: 16px 20px; }
.properties-panel h4 { margin: 0 0 10px; font-size: 0.95rem; color: var(--accent-coral); }
.prop-item { margin-bottom: 6px; font-size: 0.85rem; display: flex; align-items: center; }
.prop-label { font-weight: 600; color: var(--text-secondary); min-width: 70px; }
.prop-editable input { flex: 1; }
.prop-actions { margin-top: 12px; display: flex; gap: 8px; }
.legend-panel { margin-top: 12px; padding: 14px 18px; }
.legend-panel h4 { margin: 0 0 8px; font-size: 0.88rem; color: var(--text-secondary); }
.legend-grid { display: flex; flex-wrap: wrap; gap: 12px 20px; }
.legend-item { display: flex; align-items: center; gap: 6px; font-size: 0.82rem; color: var(--text-secondary); }
.legend-dot { width: 12px; height: 12px; border-radius: 2px; flex-shrink: 0; }
</style>
```

- [ ] **Step 3: 编译验证**

```bash
pnpm --filter @sse/web build
```

Expected: PASS (Ontology chunk 约 200KB 而非 450KB)

- [ ] **Step 4: 提交**

```bash
git add packages/web/src/pages/Ontology.vue packages/web/package.json pnpm-lock.yaml
git commit -m "feat: replace cytoscape with vis-network, add legend, warnings display, search filter"
```

---

### Task 3: API 集成校验 + 持久化

**Files:**
- Modify: `packages/api/src/routes/ontology.ts`

- [ ] **Step 1: 更新 /sync 和 /from-text 返回 warnings + 自动持久化**

在 `packages/api/src/routes/ontology.ts` 中修改三个端点：

**GET /sync:**
```typescript
router.get('/sync', asyncWrap(async (_req, res) => {
  const store = getEngine().store;
  await getEngine().mapper.syncAll();
  const warnings = store.validateGraph();
  const graph = store.getGraph();
  try { await store.saveToDb(); } catch { /* best effort */ }
  try { await store.saveToTurtle(join(process.cwd(), 'data', 'ontology', 'sse.owl')); } catch { /* best effort */ }
  res.json({ message: '本体同步完成', warnings, graph });
}));
```

**POST /from-text:**
```typescript
router.post('/from-text', asyncWrap(async (req, res) => {
  const { text } = req.body;
  if (!text) throw new AppError(400, 'INVALID_PARAMS', '请提供 text 描述');

  let extraction;
  try {
    extraction = await getEngine().extractor.extractGraph(text);
  } catch (err: any) {
    res.status(503).json({ error: { code: 'AI_SERVICE_UNAVAILABLE', message: err.message || 'AI 模型调用失败' } });
    return;
  }

  const store = getEngine().store;
  const baseUri = 'https://sse.local/';

  for (const entity of extraction.entities) {
    const uri = entity.uri.includes('://') ? entity.uri : `${baseUri}${entity.uri}`;
    store.addEntity(uri, entity.type, entity.properties);
  }

  for (const rel of extraction.relations) {
    const fromUri = rel.from.includes('://') ? rel.from : `${baseUri}${rel.from}`;
    const toUri = rel.to.includes('://') ? rel.to : `${baseUri}${rel.to}`;
    store.addRelation(fromUri, rel.predicate, toUri);
  }

  const warnings = store.validateGraph();
  const graph = store.getGraph();
  try { await store.saveToDb(); } catch { /* best effort */ }
  try {
    const dir = join(process.cwd(), 'data', 'ontology');
    const fs = await import('fs');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    await store.saveToTurtle(join(dir, 'sse.owl'));
  } catch { /* best effort */ }

  res.json({ entities_added: extraction.entities.length, relations_added: extraction.relations.length, warnings, graph });
}));
```

**PUT /entity, DELETE /entity, POST /relation, DELETE /relation** 在每个写操作后追加持久化：

```typescript
// 在 res.json(...) 之前追加：
try { await store.saveToDb(); } catch { /* best effort */ }
try {
  const dir = join(process.cwd(), 'data', 'ontology');
  const fs = await import('fs');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  await store.saveToTurtle(join(dir, 'sse.owl'));
} catch { /* best effort */ }
```

- [ ] **Step 2: 编译验证**

```bash
pnpm --filter @sse/api build
```

- [ ] **Step 3: 提交**

```bash
git add packages/api/src/routes/ontology.ts
git commit -m "feat: add warnings and persistence (Turtle + DB) to ontology write endpoints"
```

---

### Task 4: 启动时从 DB 恢复本体

**Files:**
- Modify: `packages/api/src/index.ts`

- [ ] **Step 1: 启动时加载**

在 `packages/api/src/index.ts` 中，找到 `app.listen(...)` 附近，在服务器启动后添加：

```typescript
import { OntologyEngine } from '@sse/ontology';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

// 在 listen 回调前：
async function initOntology() {
  const CONFIG_PATH = join(process.cwd(), 'ai-config.json');
  const defaults = {
    fillEngine: {
      endpoint: process.env.AI_ENDPOINT || 'http://localhost:11434/v1/chat/completions',
      model: process.env.AI_MODEL || 'llama3.2-vision',
    },
  };
  let cfg = defaults;
  try { if (existsSync(CONFIG_PATH)) { const saved = JSON.parse(readFileSync(CONFIG_PATH, 'utf-8')); cfg = { ...defaults, fillEngine: { ...defaults.fillEngine, ...(saved.fillEngine || {}) } }; } } catch { /* use defaults */ }
  const engine = new OntologyEngine(cfg.fillEngine.endpoint, cfg.fillEngine.model);
  try { await engine.store.loadFromDb(); console.log('[Ontology] 已从数据库恢复本体'); } catch { /* first run */ }
  try {
    const turtlePath = join(process.cwd(), 'data', 'ontology', 'sse.owl');
    if (existsSync(turtlePath)) { await engine.store.loadFromTurtle(turtlePath); console.log('[Ontology] 已从 Turtle 文件恢复本体'); }
  } catch { /* file may not exist yet */ }
}
```

- [ ] **Step 2: 编译验证**

```bash
pnpm --filter @sse/api build
```

- [ ] **Step 3: 提交**

```bash
git add packages/api/src/index.ts
git commit -m "feat: restore ontology from DB/Turtle on API startup"
```

---

### Task 5: 全量编译 + 文档更新

- [ ] **Step 1: 全量编译**

```bash
pnpm build
```

Expected: ALL 11 packages PASS

- [ ] **Step 2: 更新设计文档和进度文档**

更新 `docs/2026-07-26-ontology-design.md`：版本 v1.2，vis-network 替换 + 持久化 + 校验
更新 `docs/2026-07-26-sse-process.md`：新增阶段九记录

- [ ] **Step 3: 提交**

```bash
git add docs/
git commit -m "docs: update ontology design v1.2, process record for stage 9"
```

---

> **全部完成后**：API 重启时自动恢复本体，所有写操作自动持久化到 Turtle + DB，前端用 vis-network 渲染并显示图例、搜索筛选、校验警告。
