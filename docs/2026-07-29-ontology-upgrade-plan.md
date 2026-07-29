# 本体层升级 — 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为本体层新增可配置推理引擎、多系统数据融合、SPARQL 跨域查询三大能力。

**Architecture:** 新增 `reasoner.ts`（前向链推理）和 `sparql.ts`（查询封装）；`reasoning_rules` 表存储管理员可编辑的规则；identity-bridge 同步时写入本体 Person 实体；MCP 新增 `query_sparql` 工具。

**Spec:** `docs/2026-07-29-ontology-upgrade-design.md`

---

## 文件结构

| 文件 | 变更 | 职责 |
|------|------|------|
| `packages/db/src/migrations/007_reasoning_rules.sql` | 新建 | reasoning_rules 表 |
| `packages/ontology/src/reasoner.ts` | 新建 | 前向链推理引擎 |
| `packages/ontology/src/sparql.ts` | 新建 | SPARQL 查询封装 |
| `packages/ontology/src/types.ts` | 修改 | ReasoningRule, SparqlResult 类型 |
| `packages/db/src/repositories/pg-reasoning-rule-repo.ts` | 新建 | 规则 CRUD |
| `packages/api/src/routes/ontology.ts` | 修改 | /reason, /sparql 端点 |
| `packages/mcp/src/tools/query-sparql.ts` | 新建 | MCP 工具 |
| `packages/mcp/src/server.ts` | 修改 | 注册 query_sparql |
| `packages/api/src/services/identity-bridge.ts` | 修改 | 同步时写本体 |
| `packages/web/src/pages/AdminReasoningRules.vue` | 新建 | 规则管理页面 |
| `packages/web/src/router/index.ts` | 修改 | 路由 |
| `packages/web/src/layouts/DefaultLayout.vue` | 修改 | 菜单 |

---

### Task 1: 推理引擎 + 数据层

**Files:** Create `packages/db/src/migrations/007_reasoning_rules.sql`, `packages/ontology/src/reasoner.ts`, modify `packages/ontology/src/types.ts`, create `packages/db/src/repositories/pg-reasoning-rule-repo.ts`

- [ ] **Step 1: Create migration**

```sql
CREATE TABLE IF NOT EXISTS reasoning_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,
  conditions JSONB NOT NULL,
  conclusion JSONB NOT NULL,
  priority INT NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_reasoning_rules_active ON reasoning_rules(is_active);
```

- [ ] **Step 2: Add types to `packages/ontology/src/types.ts`**

```typescript
export interface ReasoningRule {
  id: string;
  name: string;
  description?: string;
  conditions: Array<{ subject: string; predicate: string; object: string }>;
  conclusion: { subject: string; predicate: string; object: string };
  priority: number;
  isActive: boolean;
}

export interface SparqlResult {
  results: Array<Record<string, string>>;
  count: number;
}
```

- [ ] **Step 3: Create `packages/ontology/src/reasoner.ts`**

```typescript
import type { ReasoningRule } from './types';
import { OwlStore } from './owl-store';

export class Reasoner {
  constructor(private store: OwlStore) {}

  apply(rules: ReasoningRule[]): number {
    const activeRules = rules.filter(r => r.isActive).sort((a, b) => a.priority - b.priority);
    let newTriples = 0;
    let changed = true;

    while (changed) {
      changed = false;
      for (const rule of activeRules) {
        try {
          const bindings = this.matchConditions(rule.conditions);
          for (const binding of bindings) {
            const s = this.substitute(rule.conclusion.subject, binding);
            const p = this.substitute(rule.conclusion.predicate, binding);
            const o = this.substitute(rule.conclusion.object, binding);
            if (this.store.addRelation(s, p, o)) {
              newTriples++;
              changed = true;
            }
          }
        } catch { /* skip failing rules */ }
      }
    }
    return newTriples;
  }

  private matchConditions(conditions: ReasoningRule['conditions']): Array<Map<string, string>> {
    // Simple forward-chaining: match each condition against store, join bindings
    let bindings: Array<Map<string, string>> = [new Map()];
    for (const cond of conditions) {
      const matches = this.store.query(cond.subject, cond.predicate, cond.object);
      const newBindings: Array<Map<string, string>> = [];
      for (const b of bindings) {
        for (const m of matches) {
          const merged = new Map(b);
          let ok = true;
          for (const [k, v] of Object.entries(m)) {
            if (merged.has(k) && merged.get(k) !== v) { ok = false; break; }
            merged.set(k, v);
          }
          if (ok) newBindings.push(merged);
        }
      }
      bindings = newBindings.length > 0 ? newBindings : bindings;
    }
    return bindings;
  }

  private substitute(template: string, binding: Map<string, string>): string {
    return template.replace(/\?(\w+)/g, (_, name) => binding.get(`?${name}`) || `?${name}`);
  }
}
```

> Note: `OwlStore` needs a new `query(subject, predicate, object)` method that matches patterns with `?var` variables. Add this method:
> ```typescript
> query(subject: string, predicate: string, object: string): Array<Record<string, string>> {
>   const results: Array<Record<string, string>> = [];
>   for (const quad of this.store) {
>     const binding: Record<string, string> = {};
>     if (!this.matchTerm(quad.subject.value, subject, binding)) continue;
>     if (!this.matchTerm(quad.predicate.value, predicate, binding)) continue;
>     if (!this.matchTerm(quad.object.value, object, binding)) continue;
>     results.push(binding);
>   }
>   return results;
> }
> private matchTerm(value: string, pattern: string, binding: Record<string, string>): boolean {
>   if (pattern.startsWith('?')) { binding[pattern] = value; return true; }
>   return value === pattern || value.endsWith(pattern);
> }
> ```

- [ ] **Step 4: Create `packages/db/src/repositories/pg-reasoning-rule-repo.ts`**

```typescript
import type { ReasoningRule } from '@sse/ontology';
import { pool } from '../connection';

function mapRule(row: any): ReasoningRule {
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? undefined,
    conditions: row.conditions,
    conclusion: row.conclusion,
    priority: row.priority,
    isActive: row.is_active,
  };
}

export class PgReasoningRuleRepo {
  async findAll(): Promise<ReasoningRule[]> {
    const { rows } = await pool.query('SELECT * FROM reasoning_rules ORDER BY priority');
    return rows.map(mapRule);
  }

  async findActive(): Promise<ReasoningRule[]> {
    const { rows } = await pool.query("SELECT * FROM reasoning_rules WHERE is_active = true ORDER BY priority");
    return rows.map(mapRule);
  }

  async findById(id: string): Promise<ReasoningRule | null> {
    const { rows } = await pool.query('SELECT * FROM reasoning_rules WHERE id = $1', [id]);
    return rows.length === 0 ? null : mapRule(rows[0]);
  }

  async create(rule: Omit<ReasoningRule, 'id'>): Promise<ReasoningRule> {
    const { rows } = await pool.query(
      `INSERT INTO reasoning_rules (name, description, conditions, conclusion, priority, is_active)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [rule.name, rule.description || null, JSON.stringify(rule.conditions), JSON.stringify(rule.conclusion), rule.priority, rule.isActive]
    );
    return mapRule(rows[0]);
  }

  async update(id: string, patch: Partial<ReasoningRule>): Promise<void> {
    const fields: string[] = [];
    const values: any[] = [];
    let idx = 1;
    if (patch.name !== undefined) { fields.push(`name = $${idx++}`); values.push(patch.name); }
    if (patch.description !== undefined) { fields.push(`description = $${idx++}`); values.push(patch.description); }
    if (patch.conditions !== undefined) { fields.push(`conditions = $${idx++}`); values.push(JSON.stringify(patch.conditions)); }
    if (patch.conclusion !== undefined) { fields.push(`conclusion = $${idx++}`); values.push(JSON.stringify(patch.conclusion)); }
    if (patch.priority !== undefined) { fields.push(`priority = $${idx++}`); values.push(patch.priority); }
    if (patch.isActive !== undefined) { fields.push(`is_active = $${idx++}`); values.push(patch.isActive); }
    if (fields.length === 0) return;
    fields.push('updated_at = NOW()');
    values.push(id);
    await pool.query(`UPDATE reasoning_rules SET ${fields.join(', ')} WHERE id = $${idx}`, values);
  }

  async delete(id: string): Promise<void> {
    await pool.query('DELETE FROM reasoning_rules WHERE id = $1', [id]);
  }
}
```

- [ ] **Step 5: Build and commit**

```bash
pnpm --filter @sse/db build
pnpm --filter @sse/ontology build
git add -A
git commit -m "feat: add reasoning engine, rules table, and repository for ontology upgrade"
```

---

### Task 2: SPARQL 查询 + API 端点

**Files:** Create `packages/ontology/src/sparql.ts`, modify `packages/api/src/routes/ontology.ts`

- [ ] **Step 1: Create `packages/ontology/src/sparql.ts`**

```typescript
import { Store, Parser } from 'n3';

export function executeSparql(store: Store, sparql: string): Array<Record<string, string>> {
  const results: Array<Record<string, string>> = [];
  // Minimal SPARQL SELECT implementation using N3 store match
  const selectMatch = sparql.match(/SELECT\s+(.+?)\s+WHERE\s*\{(.+?)\}/is);
  if (!selectMatch) throw new Error('仅支持 SELECT ?var WHERE { ?s ?p ?o } 格式');
  
  const vars = selectMatch[1].trim().split(/\s+/).filter(v => v.startsWith('?'));
  const patterns = selectMatch[2].trim().split('.').map(p => p.trim()).filter(Boolean).map(p => {
    const parts = p.split(/\s+/);
    return { subject: parts[0], predicate: parts[1], object: parts.slice(2).join(' ') };
  });

  for (const quad of store) {
    const binding: Record<string, string> = {};
    let match = true;
    for (const pat of patterns) {
      const s = pat.subject.startsWith('?') ? quad.subject.value : pat.subject;
      const p = pat.predicate.startsWith('?') ? quad.predicate.value : pat.predicate;
      const o = pat.object.startsWith('?') ? quad.object.value : pat.object;
      if (pat.subject.startsWith('?')) binding[pat.subject] = s;
      if (pat.predicate.startsWith('?')) binding[pat.predicate] = p;
      if (pat.object.startsWith('?')) binding[pat.object] = o;
      if (s !== quad.subject.value || p !== quad.predicate.value || o !== quad.object.value) {
        match = false;
        break;
      }
    }
    if (match) {
      const row: Record<string, string> = {};
      for (const v of vars) { row[v] = binding[v] || ''; }
      results.push(row);
    }
  }
  return results;
}
```

- [ ] **Step 2: Update `packages/ontology/src/index.ts`** to export Reasoner and executeSparql

```typescript
export { Reasoner } from './reasoner';
export { executeSparql } from './sparql';
```

- [ ] **Step 3: Add /reason and /sparql endpoints to `packages/api/src/routes/ontology.ts`**

After the existing relation delete endpoint, add:

```typescript
router.post('/reason', asyncWrap(async (_req, res) => {
  const store = getEngine().store;
  const { Reasoner } = await import('@sse/ontology');
  const { PgReasoningRuleRepo } = await import('@sse/db');
  const reasoner = new Reasoner(store);
  const repo = new PgReasoningRuleRepo();
  const rules = await repo.findActive();
  const newTriples = reasoner.apply(rules);
  try { await store.saveToDb(); } catch { /* best effort */ }
  try {
    const dir = join(process.cwd(), 'data', 'ontology');
    const fs = await import('fs');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    await store.saveToTurtle(join(dir, 'sse.owl'));
  } catch { /* best effort */ }
  res.json({ message: `推理完成，新增 ${newTriples} 条三元组`, newTriples });
}));

router.post('/sparql', asyncWrap(async (req, res) => {
  const { role } = req.user!;
  if (role !== 'admin' && role !== 'finance') {
    throw new AppError(403, 'UNAUTHORIZED', '仅管理员和财务可执行 SPARQL 查询');
  }
  const { query } = req.body;
  if (!query) throw new AppError(400, 'INVALID_PARAMS', '请提供 query');
  const store = getEngine().store;
  const { executeSparql } = await import('@sse/ontology');
  const results = executeSparql(store.getStore(), query);
  res.json({ results, count: results.length });
}));
```

- [ ] **Step 4: Update routing rules API** — add CRUD endpoints for reasoning_rules in `packages/api/src/routes/admin.ts`

```typescript
// ========== 推理规则管理 ==========
router.get('/reasoning-rules', asyncWrap(async (_req, res) => {
  const { PgReasoningRuleRepo } = await import('@sse/db');
  const rules = await new PgReasoningRuleRepo().findAll();
  res.json(rules);
}));

router.post('/reasoning-rules', asyncWrap(async (req, res) => {
  const { name, description, conditions, conclusion, priority, isActive } = req.body;
  const { PgReasoningRuleRepo } = await import('@sse/db');
  const rule = await new PgReasoningRuleRepo().create({ name, description, conditions, conclusion, priority, isActive });
  res.status(201).json(rule);
}));

router.put('/reasoning-rules/:id', asyncWrap(async (req, res) => {
  const { PgReasoningRuleRepo } = await import('@sse/db');
  await new PgReasoningRuleRepo().update(req.params.id, req.body);
  res.json({ message: '更新成功' });
}));

router.delete('/reasoning-rules/:id', asyncWrap(async (req, res) => {
  const { PgReasoningRuleRepo } = await import('@sse/db');
  await new PgReasoningRuleRepo().delete(req.params.id);
  res.json({ message: '已删除' });
}));
```

- [ ] **Step 5: Build and commit**

```bash
pnpm --filter @sse/ontology build
pnpm --filter @sse/api build
git add -A
git commit -m "feat: add SPARQL query, reasoning API endpoints, and admin rule CRUD"
```

---

### Task 3: Identity Bridge 写入本体 + MCP 工具

**Files:** Modify `packages/api/src/services/identity-bridge.ts`, create `packages/mcp/src/tools/query-sparql.ts`, modify `packages/mcp/src/server.ts`

- [ ] **Step 1: Update identity-bridge to sync to ontology**

In `identity-bridge.ts`, after successful user create/update, add ontology person entity:

```typescript
async function syncToOntology(user: any, source: string) {
  try {
    const { OntologyEngine } = await import('@sse/ontology');
    const cfg = loadAiConfig();
    const engine = new OntologyEngine(cfg.fillEngine.endpoint, cfg.fillEngine.model);
    engine.store.addEntity(
      `https://sse.local/person/${user.id}`,
      'Person',
      { name: user.name, phone: user.phone, department: user.department, source, externalId: user.externalId || '' }
    );
    await engine.store.saveToDb().catch(() => {});
  } catch { /* ontology sync is best-effort */ }
}
```

Call `syncToOntology` after user insert/update in both `syncFromScim` and `syncFromMdmEvent`.

- [ ] **Step 2: Create MCP tool `packages/mcp/src/tools/query-sparql.ts`**

```typescript
import type { ToolDefinition } from '../types';

export const querySparqlTool: ToolDefinition = {
  name: 'query_sparql',
  description: 'Execute a SPARQL query against the SSE ontology knowledge graph. Returns structured results.',
  inputSchema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'SPARQL SELECT query string' },
    },
    required: ['query'],
  },
  handler: async (args, context) => {
    const res = await fetch(`${process.env.API_BASE || 'http://localhost:3000'}/ontology/sparql`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${context.apiKey}` },
      body: JSON.stringify({ query: args.query }),
    });
    return res.json();
  },
};
```

- [ ] **Step 3: Register in `packages/mcp/src/server.ts`**

Add import and register:
```typescript
import { querySparqlTool } from './tools/query-sparql';
// in tools array:
querySparqlTool,
```

- [ ] **Step 4: Build and commit**

```bash
pnpm --filter @sse/api build
pnpm --filter @sse/mcp build
git add -A
git commit -m "feat: sync identity bridge to ontology, add query_sparql MCP tool"
```

---

### Task 4: 前端 — 推理规则管理页面

**Files:** Create `packages/web/src/pages/AdminReasoningRules.vue`, modify router, modify layout

- [ ] **Step 1: Create AdminReasoningRules.vue**

A page similar to admin rule management with: list of rules, create/edit modal with JSON textareas for conditions and conclusion.

```vue
<template>
  <div class="admin-reasoning-page">
    <div class="page-header"><h2>推理规则管理</h2></div>
    <div class="toolbar">
      <div class="toolbar-spacer"></div>
      <button class="btn-primary" @click="openCreate"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>新建规则</button>
    </div>
    <div class="table-wrap">
      <table class="data-table">
        <thead><tr><th>名称</th><th>说明</th><th>优先级</th><th>启用</th><th>操作</th></tr></thead>
        <tbody>
          <tr v-for="r in rules" :key="r.id">
            <td>{{ r.name }}</td><td class="text-secondary">{{ r.description || '-' }}</td>
            <td>{{ r.priority }}</td>
            <td>{{ r.isActive ? '✅' : '—' }}</td>
            <td class="col-action"><span class="table-link" @click="openEdit(r)">编辑</span><span class="table-link" style="color:var(--danger);margin-left:8px" @click="handleDelete(r)">删除</span></td>
          </tr>
        </tbody>
      </table>
    </div>
    <Teleport to="body"><div v-if="showModal" class="modal-overlay" @click.self="closeModal">
      <div class="modal"><div class="modal-header"><h3>{{ isEdit ? '编辑' : '新建' }}推理规则</h3><button class="modal-close" @click="closeModal">✕</button></div>
        <form class="modal-body" @submit.prevent="save">
          <div class="field"><label>名称</label><input v-model="form.name" required maxlength="100"/></div>
          <div class="field"><label>说明</label><input v-model="form.description"/></div>
          <div class="field"><label>条件 (JSON)</label><textarea v-model="conditionsStr" rows="6" placeholder='[{"subject":"?p","predicate":"sse:belongsTo","object":"?d"}]'></textarea></div>
          <div class="field"><label>结论 (JSON)</label><textarea v-model="conclusionStr" rows="3" placeholder='{"subject":"?p","predicate":"sse:worksFor","object":"?c"}'></textarea></div>
          <div class="field"><label>优先级</label><input v-model.number="form.priority" type="number"/></div>
          <div class="field"><label class="toggle-wrap" style="width:auto"><input type="checkbox" v-model="form.isActive"/><span class="toggle-slider"></span> 启用</label></div>
          <div class="modal-actions"><button type="button" class="btn-secondary" @click="closeModal">取消</button><button type="submit" class="btn-primary">保存</button></div>
        </form>
      </div>
    </div></Teleport>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue'
import api from '../api/index'

const rules = ref<any[]>([])
const showModal = ref(false)
const isEdit = ref(false)
const editId = ref('')
const form = reactive({ name: '', description: '', priority: 0, isActive: true })
const conditionsStr = ref('[{"subject":"?p","predicate":"sse:belongsTo","object":"?d"}]')
const conclusionStr = ref('{"subject":"?p","predicate":"sse:worksFor","object":"?c"}')

onMounted(async () => {
  try { const r = await api.get('/admin/reasoning-rules'); rules.value = r.data || [] } catch {}
})

function openCreate() { isEdit.value = false; editId.value = ''; form.name = ''; form.description = ''; form.priority = 0; form.isActive = true; conditionsStr.value = '[]'; conclusionStr.value = '{}'; showModal.value = true }
function openEdit(r: any) { isEdit.value = true; editId.value = r.id; form.name = r.name; form.description = r.description || ''; form.priority = r.priority; form.isActive = r.isActive; conditionsStr.value = JSON.stringify(r.conditions); conclusionStr.value = JSON.stringify(r.conclusion); showModal.value = true }
function closeModal() { showModal.value = false }

async function save() {
  let conditions, conclusion;
  try { conditions = JSON.parse(conditionsStr.value) } catch { alert('条件 JSON 格式错误'); return }
  try { conclusion = JSON.parse(conclusionStr.value) } catch { alert('结论 JSON 格式错误'); return }
  try {
    const payload = { ...form, conditions, conclusion }
    if (isEdit.value) await api.put(`/admin/reasoning-rules/${editId.value}`, payload)
    else await api.post('/admin/reasoning-rules', payload)
    closeModal()
    const r = await api.get('/admin/reasoning-rules'); rules.value = r.data || []
  } catch (e: any) { alert(e?.response?.data?.error?.message || '保存失败') }
}

async function handleDelete(r: any) {
  if (!confirm('确认删除？')) return
  await api.delete(`/admin/reasoning-rules/${r.id}`)
  rules.value = rules.value.filter(x => x.id !== r.id)
}
</script>

<style scoped>
.admin-reasoning-page { max-width: 900px; }
.modal-overlay { position: fixed; inset: 0; background: rgba(45,36,32,0.4); backdrop-filter: blur(4px); display: flex; align-items: center; justify-content: center; z-index: 200; }
.modal { background: var(--bg-card); border-radius: var(--radius-lg); width: 90%; max-width: 600px; max-height: 90vh; overflow-y: auto; }
.modal-header { display: flex; align-items: center; justify-content: space-between; padding: 20px 24px; border-bottom: 1px solid var(--border-light); }
.modal-body { padding: 20px 24px; display: flex; flex-direction: column; gap: 14px; }
.modal-actions { display: flex; gap: 8px; justify-content: flex-end; margin-top: 8px; }
.modal-close { background: none; border: none; font-size: 1.2rem; cursor: pointer; }
textarea { width: 100%; padding: 10px; border: 1px solid var(--border); border-radius: var(--radius-sm); font-family: monospace; font-size: 0.85rem; resize: vertical; }
</style>
```

- [ ] **Step 2: Add route and menu**

In `router/index.ts`:
```typescript
      { path: 'admin/reasoning-rules', name: 'AdminReasoningRules', component: () => import('@/pages/AdminReasoningRules.vue'), meta: { title: '推理规则', requiresAdmin: true } },
```

In `DefaultLayout.vue` admin items:
```typescript
      { path: '/admin/reasoning-rules', label: '推理规则', icon: '...' },
```

- [ ] **Step 3: Build and commit**

```bash
pnpm --filter @sse/web build
git add -A
git commit -m "feat: add reasoning rules management page with JSON editor"
```

---

### Task 5: 全量编译 + 验证

- [ ] **Step 1: Full build**

```bash
pnpm build
```

- [ ] **Step 2: Run migration on server**

```bash
sudo docker exec -i sse-postgres-1 psql -U sse -d sse < packages/db/src/migrations/007_reasoning_rules.sql
```

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "chore: full build verification for ontology upgrade"
```
