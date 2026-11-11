# SSE Ontology Platform Overhaul Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the current demo ontology (partial DB mirror + toy SPARQL) into a record-equivalent semantic platform: every business record is projected into a real SPARQL 1.1 graph within seconds, rules and constraints are first-class, answers are explainable, and MCP/Web are first-class consumers.

**Architecture:** PostgreSQL remains the system of record. Row triggers write every relevant change to `ontology_outbox`. A single `GraphProjector` in the API process drains the outbox into an embedded Oxigraph store (real SPARQL 1.1), persisted as versioned N-Quads snapshots in Postgres. The API owns the graph; MCP becomes a thin client over the API; the Web UI becomes an ontology workbench. Named graphs separate TBox, data, history, manual, and inferred triples.

**Tech Stack:** TypeScript, Node 24, pnpm 9, PostgreSQL 16, Oxigraph 0.5 (`oxigraph` npm, WASM), `sparqljs` 3.7, `rdf-validate-shacl` 0.6, `@rdfjs/dataset` 2.0, Express, Vue 3, Jest/Vitest, MCP SDK 1.x.

**Status:** DRAFT v1. Awaiting user approval. Do not execute any task before approval.

---

## 1. Decisions requiring approval

These are the load-bearing choices. If any is rejected, update the plan before execution.

| # | Decision | Recommendation | Why |
|---|---|---|---|
| D1 | Graph engine | **Embedded Oxigraph in the API process**, behind a `GraphStore` port | Real SPARQL 1.1, no new ops service, cross-platform WASM. External Fuseki/Neo4j remains possible via the port. |
| D2 | Record equivalence mechanism | **DB triggers + transactional outbox + projector** | Guarantees coverage even for admin/direct SQL writes; application-level hooks miss paths. |
| D3 | Canonical status model | **`sse:status` literal is canonical**; legacy `DraftReport/PendingReport/ApprovedReport/PaidReport` classes are inferred | Fixes stale `rdf:type` accumulation and the current `rejected -> ApprovedReport` bug while keeping old queries working. Add `sse:RejectedReport`. |
| D4 | Graph ownership | **API owns the only live graph**; MCP calls API endpoints for ontology reads | Eliminates the current MCP `loaded=true` forever cache and multi-process drift. |
| D5 | Raw SPARQL access | **admin/finance only**, read-only, hard timeout + result cap | Consistent with current RBAC; prevents graph exfiltration and runaway queries. |
| D6 | PII policy | Graph stores identity references (`userId`, name, department, role, status), **not** phone/email/password/storage keys | The graph mirrors records semantically; secrets and contact data stay in Postgres and are resolved by ID when authorized. |
| D7 | UI scope | **Workbench** (explorer, entity detail/evidence, validate, impact, anomalies, sync health), not a free-form graph editor | Delivers operator value. Manual graph editing moves to an admin-only `urn:sse:manual` graph. |
| D8 | Compatibility | Existing MCP tool names and `/ontology/sync`, `/ontology/query`, `/ontology/graph` remain working during migration | Avoid breaking current agents while the new surface lands. |

---

## 2. Current state and target invariants

### Current gaps (evidence)

| Gap | Evidence |
|---|---|
| Partial mirror only | `packages/ontology/src/semantic-mapper.ts:61-66` syncs at most 500 reports; no invoices/rules/categories/approvals/payments |
| Status not equivalent | Normal submit/approve/reject/pay paths never call the mapper; `owl-store.ts:50-56` only appends; `semantic-mapper.ts:19-22` maps `rejected` to `ApprovedReport` |
| Cross-process drift | `packages/mcp/src/tools/get-engine.ts:42-58` loads a snapshot once and never refreshes |
| Toy query engine | `packages/ontology/src/sparql.ts:34-79` matches every pattern against one quad; joins return `[]`, `FILTER` is ignored |
| Rules not in graph | `packages/mcp/src/tools/validate-expense.ts:31` reads `approval_rules` directly from Postgres |
| No evidence chain | No endpoint can answer “why is this report stuck / why does it need this approver” |

### Target invariants

- **I1 Record equivalence:** every row in mapped tables has exactly one graph node, reflecting the latest committed state within `ONTOLOGY_PROJECT_INTERVAL_MS`.
- **I2 Deletion equivalence:** deleted rows remove their node and incident edges; a tombstone remains in `urn:sse:history`.
- **I3 Provenance:** every entity has `sse:sourceTable`, `sse:sourceId`, `sse:recordVersion`, `prov:generatedAtTime`.
- **I4 Scope:** all typed queries and MCP tools enforce `resolveDataScope`; raw SPARQL is admin/finance only.
- **I5 Determinism:** a full rebuild from Postgres produces the same checksum as the incremental projection.
- **I6 Security:** no `password_hash`, phone, email, storage keys, or file contents in the graph or logs.
- **I7 Compatibility:** existing MCP tool names and legacy ontology endpoints keep working; new tools are additive.
- **I8 Explainability:** every validation/anomaly/impact result names the entities and rule/constraint that produced it.

---

## 3. Target architecture

```
PostgreSQL (system of record)
  |-- row triggers (INSERT/UPDATE/DELETE) --> ontology_outbox
  |-- ontology_graph_snapshots (nquads, version, checksum)
  |-- ontology_projector_state (last_outbox_id, last_version)
  |-- ontology_rules (construct_query, severity, message)
        |
        v
API process
  |-- GraphProjector (advisory lock) --> GraphWorker (worker_threads)
  |                                        |-- Oxigraph store
  |                                        |-- SPARQL 1.1 query/update
  |-- RuleEngine (CONSTRUCT) ------------> urn:sse:inferred
  |-- ShaclValidator (rdf-validate-shacl) -> /ontology/validate, /ontology/anomalies
  |-- OntologyQueryService ---------------> REST:
  |     /ontology/status, /schema, /entities, /query,
  |     /sparql, /validate, /explain, /impact, /anomalies, /reconcile
  |
MCP process  -- signed JWT --> REST (thin client)
Web process  -- JWT --------> REST (workbench)
```

Named graphs:

| Graph | Contents |
|---|---|
| `urn:sse:tbox` | Classes, properties, SHACL shapes |
| `urn:sse:data` | Projected records |
| `urn:sse:inferred` | Materialized rule conclusions |
| `urn:sse:history` | Tombstones and prior versions |
| `urn:sse:manual` | Admin-created entities, merged at query time |

Query dataset for typed queries and raw SPARQL:

```sparql
FROM <urn:sse:tbox>
FROM <urn:sse:data>
FROM <urn:sse:inferred>
FROM <urn:sse:manual>
```

History is queryable only through the admin audit endpoint.

### Outbox/projector sequence

0. On boot, load the latest `ontology_graph_snapshots` row into the graph worker and restore `last_outbox_id`; if none exists, run a full reconcile first.
1. Business write commits a row and its outbox event in the same transaction.
2. `GraphProjector` acquires `pg_try_advisory_lock(728001)`.
3. Select a batch of unprocessed outbox rows `FOR UPDATE SKIP LOCKED`.
4. Map each row to deterministic entity URI + quads; send `replaceEntity`/`addRelation`/`removeRelation`/`delete` to the graph worker.
5. Re-run active CONSTRUCT rules into `urn:sse:inferred` (debounced to at most once per 2s).
6. Mark outbox rows processed and advance `ontology_projector_state`.
7. Every `ONTOLOGY_SNAPSHOT_INTERVAL_MS`, dump graphs and insert a new snapshot row.
8. On failure: increment `attempts`, store `last_error`, stop the batch (preserve ordering); after 10 attempts mark `dead_letter = true`, surface it at `/ontology/status`, and continue. Dead letters require an admin reconcile.

### Rebuild sequence

`POST /ontology/reconcile`:

1. Acquire projector lock (pause incremental projection).
2. Build a fresh Oxigraph store in a temporary worker.
3. Stream all mapped tables in FK order; project every row.
4. Run rules and validate.
5. Dump `urn:sse:data`, `urn:sse:inferred`, `urn:sse:history`.
6. Atomically replace the live worker/store and write a new snapshot with `version = last+1`.
7. Release lock. Incremental projection resumes from the current max outbox id.

---

## 4. File map

### New files

| Path | Responsibility |
|---|---|
| `docs/adr/2026-11-10-ontology-graph-projection.md` | Architecture decision record for D1-D8 |
| `packages/ontology/src/graph/namespaces.ts` | Namespace constants, URI builders |
| `packages/ontology/src/graph/types.ts` | `GraphStore`, `ProjectedQuad`, `GraphQueryResult` |
| `packages/ontology/src/graph/oxigraph-worker.ts` | Worker thread owning the Oxigraph store |
| `packages/ontology/src/graph/oxigraph-store.ts` | Main-thread `GraphStore` adapter with queue/timeout/respawn |
| `packages/ontology/src/graph/memory-store.ts` | In-process test adapter |
| `packages/ontology/src/graph/sparql-term.ts` | Safe literal/IRI serialization |
| `packages/ontology/src/graph/ontology/sse.ttl` | TBox |
| `packages/ontology/src/graph/ontology/shapes.ttl` | SHACL shapes |
| `packages/ontology/src/graph/ontology-loader.ts` | Load TBox/shapes into the store from copied dist assets |
| `packages/ontology/scripts/copy-assets.js` | Copy `.ttl` assets into `dist/` during build |
| `packages/ontology/src/graph/graph-context.ts` | Module singleton for the live `GraphStore`/query service |
| `packages/ontology/src/projection/entity-mapper.ts` | Table row -> entity URI + quads |
| `packages/ontology/src/projection/projector.ts` | Outbox drain, retry, lock, snapshot |
| `packages/ontology/src/projection/reconcile.ts` | Full deterministic rebuild |
| `packages/ontology/src/query/query-service.ts` | Typed cross-domain queries with scope |
| `packages/ontology/src/query/sparql-guard.ts` | Read-only validation via `sparqljs` |
| `packages/ontology/src/reasoning/rule-engine.ts` | CONSTRUCT rule materialization |
| `packages/ontology/src/reasoning/shacl.ts` | SHACL validation wrapper |
| `packages/ontology/src/reasoning/explain.ts` | Evidence chain builder |
| `packages/ontology/src/reasoning/impact.ts` | What-if / affected-entity analysis |
| `packages/ontology/src/reasoning/anomalies.ts` | Anomaly check library |
| `packages/api/src/routes/ontology-v2.ts` | New REST surface |
| `packages/api/src/services/ontology-projector.ts` | Projector lifecycle in API |
| `packages/mcp/src/tools/ontology-client.ts` | Thin API client for ontology tools |
| `packages/mcp/src/tools/explain-expense.ts` | New MCP tool |
| `packages/mcp/src/tools/impact-analysis.ts` | New MCP tool |
| `packages/mcp/src/tools/find-anomalies.ts` | New MCP tool |
| `packages/mcp/src/tools/get-ontology-schema.ts` | New MCP tool |
| `packages/web/src/api/ontology.ts` | Typed Web API client |
| `packages/web/src/components/ontology/GraphExplorer.vue` | Graph explorer |
| `packages/web/src/components/ontology/EntityDetail.vue` | Entity + evidence detail |
| `packages/web/src/components/ontology/QueryWorkbench.vue` | Typed query / SPARQL workbench |
| `packages/web/src/components/ontology/ValidationPanel.vue` | Validation results |
| `packages/web/src/components/ontology/ImpactPanel.vue` | Impact analysis |
| `packages/web/src/components/ontology/AnomalyPanel.vue` | Anomaly list |
| `packages/web/src/components/ontology/SyncStatus.vue` | Projector health |
| `packages/db/src/migrations/015_ontology_graph_snapshots.sql` | Snapshot/state schema |
| `packages/db/src/migrations/016_ontology_outbox.sql` | Outbox + triggers |
| `packages/db/src/migrations/017_ontology_rules_v2.sql` | CONSTRUCT rules + constraints |
| `docs/2026-11-10-ontology-v2-runbook.md` | Backfill, cutover, rollback runbook |

### Modified files

| Path | Change |
|---|---|
| `packages/ontology/package.json` | Add `oxigraph`, `sparqljs`, `rdf-validate-shacl`, `@rdfjs/dataset`; add `test` scripts |
| `packages/ontology/src/index.ts` | Export new modules; keep legacy exports until Phase 7 |
| `packages/api/src/index.ts` | Start projector after ontology init; load snapshot |
| `packages/api/src/routes/ontology.ts` | Mount v2 routes; legacy endpoints become aliases |
| `packages/api/src/openapi.ts` | Document new endpoints |
| `packages/mcp/src/server.ts` | Register new tools; per-tool timeout |
| `packages/mcp/src/tools/query-ontology.ts` | Delegate to `ontology-client.ts` |
| `packages/mcp/src/tools/get-entity-network.ts` | Delegate to `ontology-client.ts` |
| `packages/mcp/src/tools/query-sparql.ts` | Delegate to `ontology-client.ts` |
| `packages/mcp/src/tools/validate-expense.ts` | Prefer graph-backed API, DB fallback |
| `packages/mcp/package.json` | Add Jest test harness |
| `packages/web/src/pages/Ontology.vue` | Compose workbench components |
| `packages/web/src/router/index.ts` | Keep `/ontology`; optional deep-link query params |
| `.env.example` | Add `ONTOLOGY_*` variables |
| `README.md`, `docs/2026-11-10-sse-process.md` | Document new capabilities |

---

## 5. Phase graph and parallelism

```
Phase 0 (approval, ADR, deps)
   |
Phase 1 (graph foundation: Oxigraph, TBox, snapshots)
   |
Phase 2 (equivalence: outbox, mapper, projector, reconcile)
   |\
   | +--> Phase 3 (query API: typed + SPARQL worker)
   |
   +----> Phase 4 (rules, SHACL, explain, impact, anomalies)
             |
             +--> Phase 5 (MCP thin client + tools)
             |
             +--> Phase 6 (Web workbench)
                       |
                       +--> Phase 7 (shadow, cutover, decommission)
```

- Phases 3 and 4 can run in parallel after Phase 2 Task 2.3.
- Phase 5 and Phase 6 can run in parallel after Phase 3 and 4 endpoints are stable.
- Phase 1 and 4 are the highest-risk steps; assign the strongest available model/agent to them.
- No phase ships without green `pnpm -r build`, `pnpm -r test`, and the phase's integration test.

---

## 6. Global conventions

- **Language:** TypeScript strict, ES2022, CommonJS for packages; MCP stays ESM (`"type": "module"`).
- **Naming:** `sse:` = `https://sse.local/ontology#`; instance IRIs = `https://sse.local/<type>/<id>`.
- **Errors:** API returns `{ error: { code, message, details? } }`; MCP uses `errorResult(code, message)`.
- **Commits:** conventional commits matching repo style: `feat(ontology): ...`, `fix(ontology): ...`, `feat(mcp): ...`, `docs(ontology): ...`.
- **Tests:** colocate unit tests under `src/__tests__`; integration tests under `test/`; do not weaken existing assertions.
- **Feature flag:** `ONTOLOGY_V2=0|shadow|on`; default `0` until Phase 7.
- **No direct stdout in libraries:** MCP stdio uses stdout for JSON-RPC; log to stderr.
- **No secrets in graph/logs:** whitelist mapped fields; the outbox trigger strips `password_hash`.
- **Definition of Done for every task:** failing test written and seen failing, implementation passes, `pnpm --filter <pkg> test` green, `pnpm --filter <pkg> build` green, commit created.

Environment variables (add to `.env.example` in Task 7.3):

```dotenv
ONTOLOGY_V2=0                 # 0 | shadow | on
ONTOLOGY_PROJECT_INTERVAL_MS=1000
ONTOLOGY_SNAPSHOT_INTERVAL_MS=5000
ONTOLOGY_SPARQL_TIMEOUT_MS=1500
ONTOLOGY_SPARQL_MAX_RESULTS=1000
ONTOLOGY_OUTBOX_RETENTION_DAYS=7
ONTOLOGY_ANOMALY_INTERVAL_MS=86400000
ONTOLOGY_MAX_OUTBOX_BATCH=200
```

---

## Phase 0: Approval and guardrails

### Task 0.1: Record the architecture decisions

**Files:**
- Create: `docs/adr/2026-11-10-ontology-graph-projection.md`

**Context:** Future agents need to know why the graph is a projection, why triggers are used, and how to swap the engine. No code changes.

- [ ] **Step 1: Write the ADR**

```markdown
# ADR: Ontology graph projection

Status: Accepted (pending user approval)
Date: 2026-11-10

## Context
The current ontology mirrors at most 500 reports, misses invoices/rules/categories,
never updates on approval/payment, and uses a non-SPARQL parser.

## Decisions
1. PostgreSQL is the system of record.
2. Row triggers write to ontology_outbox; a projector applies idempotent updates
   to an embedded Oxigraph store owned by the API process.
3. Named graphs: urn:sse:tbox, urn:sse:data, urn:sse:inferred,
   urn:sse:history, urn:sse:manual.
4. sse:status is canonical; legacy report classes are inferred.
5. MCP reads ontology data through the API (thin client).
6. Raw SPARQL is admin/finance only, read-only, timed out, capped.
7. Graph stores identity references, not phone/email/password/storage keys.

## Consequences
- A full rebuild from Postgres is deterministic and checksummed.
- The graph can be swapped for Fuseki/Neo4j behind the GraphStore port.
- A projector outage delays graph freshness but never blocks business writes.
```

- [ ] **Step 2: Commit**

```bash
git add docs/adr/2026-11-10-ontology-graph-projection.md
git commit -m "docs(ontology): record graph projection architecture decisions"
```

### Task 0.2: Establish the baseline

**Files:**
- No code changes.

- [ ] **Step 1: Verify the baseline is green**

Run:

```bash
pnpm install
pnpm -r build
pnpm -r test
```

Expected: all packages build; existing suites pass (core 41, auth 19, db 13, ai 100, notifications 29, ontology 14, api 32 as of 2026-11-10).

- [ ] **Step 2: Record the baseline counts**

```bash
git rev-parse --short HEAD
```

Expected: `6d039f1` or the current approved commit. Write the value at the top of this plan under “Baseline”.

### Task 0.3: Add dependencies and test harnesses

**Files:**
- Modify: `packages/ontology/package.json`
- Modify: `packages/mcp/package.json`
- Modify: `packages/web/package.json`
- Create: `packages/mcp/jest.config.cjs`

- [ ] **Step 1: Add ontology dependencies**

Add to `packages/ontology/package.json` dependencies:

```json
"oxigraph": "^0.5.13",
"sparqljs": "^3.7.4",
"rdf-validate-shacl": "^0.6.5",
"@rdfjs/dataset": "^2.0.3"
```

Add dev dependency:

```json
"@types/sparqljs": "^3.1.12"
```

Change the build script so Turtle assets land in `dist/`:

```json
"scripts": {
  "build": "tsc && node scripts/copy-assets.js",
  "test": "jest"
}
```

Create `packages/ontology/scripts/copy-assets.js`:

```js
const { cpSync, mkdirSync } = require('fs');
const { join } = require('path');

const src = join(__dirname, '..', 'src', 'graph', 'ontology');
const dest = join(__dirname, '..', 'dist', 'graph', 'ontology');
mkdirSync(dest, { recursive: true });
cpSync(src, dest, { recursive: true });
```

- [ ] **Step 2: Add MCP test harness**

Add to `packages/mcp/package.json`:

```json
"scripts": {
  "build": "tsc",
  "test": "jest --passWithNoTests",
  "start:http": "node dist/http.js"
},
"devDependencies": {
  "@types/jest": "^29",
  "jest": "^29",
  "ts-jest": "^29",
  "typescript": "^5.3"
}
```

Create `packages/mcp/jest.config.cjs` (MCP is `"type": "module"`, so a `.js` config would be parsed as ESM):

```js
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: ['**/__tests__/**/*.test.ts'],
  moduleNameMapper: {
    '^@sse/(.*)$': '<rootDir>/../$1/src',
  },
  // MCP sources are ESM; transpile to CJS for Jest.
  transform: { '^.+\\.ts$': ['ts-jest', { tsconfig: { module: 'commonjs' } }] },
  testTimeout: 30000,
};
```

- [ ] **Step 3: Add Web test harness**

Add to `packages/web/package.json`:

```json
"scripts": {
  "dev": "vite",
  "build": "vite build",
  "test": "vitest run --passWithNoTests"
},
"devDependencies": {
  "@vue/test-utils": "^2.4.6",
  "jsdom": "^25.0.1",
  "vitest": "^2.1.9"
}
```

- [ ] **Step 4: Install and verify**

Run:

```bash
pnpm install
pnpm --filter @sse/ontology build
pnpm --filter @sse/ontology test
pnpm --filter @sse/mcp build
pnpm --filter @sse/web build
```

Expected: install succeeds; existing ontology tests pass; MCP and Web build.

- [ ] **Step 5: Commit**

```bash
git add packages/ontology/package.json packages/mcp/package.json packages/web/package.json packages/mcp/jest.config.js pnpm-lock.yaml
git commit -m "chore(ontology): add graph engine and test dependencies"
```

---

## Phase 1: Graph foundation

**Goal:** A real SPARQL 1.1 store behind a port, with TBox and snapshot persistence, without changing user-visible behavior yet.

**Exit criteria:** Unit tests prove joins, FILTER, ORDER BY, LIMIT, CONSTRUCT, and update semantics; TBox loads; snapshots round-trip with checksums; API boots with `ONTOLOGY_V2=0` unchanged.

### Task 1.1: Graph types and in-memory test adapter

**Files:**
- Create: `packages/ontology/src/graph/types.ts`
- Create: `packages/ontology/src/graph/namespaces.ts`
- Create: `packages/ontology/src/graph/memory-store.ts`
- Test: `packages/ontology/src/__tests__/graph-store.test.ts`

**Context:** The rest of the system depends on this port. Keep it small and free of Express/DB imports so it is trivially testable.

- [ ] **Step 1: Write the failing test**

```ts
import { MemoryGraphStore } from '../graph/memory-store';

const NQ = `
<https://sse.local/report/r1> <https://sse.local/ontology#submittedBy> <https://sse.local/person/p1> <urn:sse:data> .
<https://sse.local/person/p1> <https://sse.local/ontology#belongsTo> <https://sse.local/dept/d1> <urn:sse:data> .
<https://sse.local/report/r1> <https://sse.local/ontology#status> "pending" <urn:sse:data> .
<https://sse.local/approval/a1> <https://sse.local/ontology#hasApproval> <https://sse.local/report/r1> <urn:sse:data> .
`;

describe('GraphStore', () => {
  it('supports joins and FILTER', async () => {
    const store = new MemoryGraphStore();
    await store.load(NQ);
    const res = await store.query(`
      SELECT ?report ?dept WHERE {
        ?report <https://sse.local/ontology#submittedBy> ?person .
        ?person <https://sse.local/ontology#belongsTo> ?dept .
        ?report <https://sse.local/ontology#status> "pending" .
      }
    `);
    expect(res.kind).toBe('select');
    expect(res.rows).toEqual([
      { report: 'https://sse.local/report/r1', dept: 'https://sse.local/dept/d1' },
    ]);
  });

  it('replaces only owned predicates and keeps incoming edges', async () => {
    const store = new MemoryGraphStore();
    await store.load(NQ);
    await store.replaceEntity('https://sse.local/person/p1', [
      { subject: 'https://sse.local/person/p1', predicate: 'https://sse.local/ontology#name', object: 'Alice', objectType: 'literal', graph: 'urn:sse:data' },
      { subject: 'https://sse.local/person/p1', predicate: 'https://sse.local/ontology#belongsTo', object: 'https://sse.local/dept/d1', objectType: 'iri', graph: 'urn:sse:data' },
    ], [
      'https://sse.local/ontology#name',
      'https://sse.local/ontology#belongsTo',
    ]);
    const reportEdge = await store.query('SELECT ?r WHERE { GRAPH <urn:sse:data> { ?r <https://sse.local/ontology#submittedBy> <https://sse.local/person/p1> } }');
    expect(reportEdge.rows).toHaveLength(1);
  });

  it('deletes a subject and its incoming edges', async () => {
    const store = new MemoryGraphStore();
    await store.load(NQ);
    await store.deleteSubject('https://sse.local/report/r1');
    const res = await store.query('SELECT ?s ?p ?o WHERE { GRAPH <urn:sse:data> { ?s ?p ?o } }');
    expect(res.rows).toEqual([
      { s: 'https://sse.local/person/p1', p: 'https://sse.local/ontology#belongsTo', o: 'https://sse.local/dept/d1' },
    ]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
pnpm --filter @sse/ontology test -- graph-store
```

Expected: FAIL, cannot find module `../graph/memory-store`.

- [ ] **Step 3: Implement the port and memory adapter**

`packages/ontology/src/graph/types.ts`:

```ts
export type ObjectType = 'iri' | 'literal';

export interface ProjectedQuad {
  subject: string;
  predicate: string;
  object: string;
  objectType: ObjectType;
  datatype?: string;
  language?: string;
  graph: string;
}

export interface SelectResult {
  kind: 'select';
  rows: Array<Record<string, string>>;
}

export interface AskResult {
  kind: 'ask';
  value: boolean;
}

export interface ConstructResult {
  kind: 'construct';
  quads: ProjectedQuad[];
}

export type GraphQueryResult = SelectResult | AskResult | ConstructResult;

export interface GraphCounts {
  quads: number;
  subjects: number;
}

export interface GraphStore {
  query(sparql: string, opts?: { timeoutMs?: number }): Promise<GraphQueryResult>;
  update(sparql: string): Promise<void>;
  load(nquads: string): Promise<void>;
  /** Atomically replace the entire graph (used by reconcile). */
  replaceAll(nquads: string): Promise<void>;
  dump(graphs: string[]): Promise<string>;
  /**
   * Replace only the outgoing triples whose predicates are listed in
   * ownedPredicates. Never touches incoming edges or predicates owned by
   * another projection. This is the ONLY safe way to update an entity whose
   * relations are also emitted from child rows.
   */
  replaceEntity(subject: string, quads: ProjectedQuad[], ownedPredicates: string[]): Promise<void>;
  addRelation(from: string, predicate: string, to: string): Promise<void>;
  removeRelation(from: string, predicate: string, to: string): Promise<void>;
  /** Full delete: outgoing + incoming edges, plus a tombstone. */
  deleteSubject(subject: string): Promise<void>;
  /** Keep an in-memory snapshot so a respawned worker can restore itself. */
  checkpoint(nquads: string): void;
  /** True when a worker timeout/respawn may have lost mutations; run reconcile. */
  needsRebuild(): boolean;
  counts(): Promise<GraphCounts>;
  close(): Promise<void>;
}
```

`packages/ontology/src/graph/namespaces.ts`:

```ts
export const SSE = 'https://sse.local/ontology#';
export const INST = 'https://sse.local/';
export const RDF_TYPE = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type';
export const XSD = 'http://www.w3.org/2001/XMLSchema#';
export const PROV = 'http://www.w3.org/ns/prov#';
export const provGeneratedAtTime = `${PROV}generatedAtTime`;

export const GRAPH = {
  tbox: 'urn:sse:tbox',
  data: 'urn:sse:data',
  inferred: 'urn:sse:inferred',
  history: 'urn:sse:history',
  manual: 'urn:sse:manual',
} as const;

export const uri = {
  person: (id: string) => `${INST}person/${id}`,
  department: (name: string) => `${INST}dept/${encodeURIComponent(name)}`,
  category: (id: string) => `${INST}category/${id}`,
  report: (id: string) => `${INST}report/${id}`,
  item: (id: string) => `${INST}item/${id}`,
  invoice: (id: string) => `${INST}invoice/${id}`,
  rule: (id: string) => `${INST}rule/${id}`,
  approval: (id: string) => `${INST}approval/${id}`,
  payment: (id: string) => `${INST}payment/${id}`,
};

export const sse = (name: string) => `${SSE}${name}`;
```

`packages/ontology/src/graph/memory-store.ts`: implement the interface using `n3` (already a dependency). Use `Store` for quads, `Parser` for N-Quads, `Writer` for dump. For `query`, use `oxigraph` to avoid reimplementing SPARQL:

```ts
import { Parser, Writer } from 'n3';
import oxigraph from 'oxigraph';
import type { GraphCounts, GraphQueryResult, GraphStore, ProjectedQuad } from './types';

function toQuad(q: ProjectedQuad) {
  const subject = oxigraph.namedNode(q.subject);
  const predicate = oxigraph.namedNode(q.predicate);
  const object = q.objectType === 'iri'
    ? oxigraph.namedNode(q.object)
    : oxigraph.literal(q.object, q.language ? { language: q.language } : q.datatype ? { datatype: oxigraph.namedNode(q.datatype) } : undefined);
  return oxigraph.quad(subject, predicate, object, oxigraph.namedNode(q.graph));
}

function fromQuad(q: any): ProjectedQuad {
  return {
    subject: q.subject.value,
    predicate: q.predicate.value,
    object: q.object.value,
    objectType: q.object.termType === 'NamedNode' ? 'iri' : 'literal',
    datatype: q.object.datatype?.value,
    language: q.object.language || undefined,
    graph: q.graph.value,
  };
}

export class MemoryGraphStore implements GraphStore {
  private store = new oxigraph.Store();
  private snapshot = '';

  async load(nquads: string): Promise<void> {
    this.store.load(nquads, { format: 'application/n-quads' });
    this.snapshot = nquads;
  }

  async replaceAll(nquads: string): Promise<void> {
    this.store = new oxigraph.Store();
    await this.load(nquads);
  }

  async dump(graphs: string[]): Promise<string> {
    const quads = this.store.match(null, null, null, null).filter((q: any) => graphs.includes(q.graph.value));
    return quads.map((q: any) => q.toString()).join('\n') + (quads.length ? '\n' : '');
  }

  async query(sparql: string): Promise<GraphQueryResult> {
    const raw = this.store.query(sparql);
    if (typeof raw === 'boolean') return { kind: 'ask', value: raw };
    if (Array.isArray(raw)) {
      return {
        kind: 'select',
        rows: raw.map((binding: Map<string, any>) => {
          const row: Record<string, string> = {};
          for (const [k, v] of binding) row[k] = v.value;
          return row;
        }),
      };
    }
    return { kind: 'construct', quads: Array.from(raw).map(fromQuad) };
  }

  async update(sparql: string): Promise<void> {
    this.store.update(sparql);
  }

  async replaceEntity(subject: string, quads: ProjectedQuad[], ownedPredicates: string[]): Promise<void> {
    for (const predicate of ownedPredicates) {
      this.store.update(`DELETE WHERE { GRAPH <urn:sse:data> { <${subject}> <${predicate}> ?o } }`);
    }
    for (const q of quads) this.store.add(toQuad(q));
  }

  async addRelation(from: string, predicate: string, to: string): Promise<void> {
    this.store.add(toQuad({ subject: from, predicate, object: to, objectType: 'iri', graph: 'urn:sse:data' }));
  }

  async removeRelation(from: string, predicate: string, to: string): Promise<void> {
    this.store.update(`DELETE DATA { GRAPH <urn:sse:data> { <${from}> <${predicate}> <${to}> } }`);
  }

  async deleteSubject(subject: string): Promise<void> {
    this.store.update(`DELETE WHERE { GRAPH <urn:sse:data> { <${subject}> ?p ?o } }`);
    this.store.update(`DELETE WHERE { GRAPH <urn:sse:data> { ?s ?p <${subject}> } }`);
    this.store.update(`INSERT DATA { GRAPH <urn:sse:history> { <${subject}> <https://sse.local/ontology#deletedAt> "${new Date().toISOString()}" } }`);
  }

  checkpoint(nquads: string): void {
    this.snapshot = nquads;
  }

  needsRebuild(): boolean {
    return false;
  }

  async counts(): Promise<GraphCounts> {
    const quads = this.store.match(null, null, null, null);
    return { quads: quads.length, subjects: new Set(quads.map((q: any) => q.subject.value)).size };
  }

  async close(): Promise<void> {}
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
pnpm --filter @sse/ontology test -- graph-store
```

Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/ontology/src/graph packages/ontology/src/__tests__/graph-store.test.ts
git commit -m "feat(ontology): add GraphStore port and in-memory adapter"
```

### Task 1.2: Oxigraph worker adapter

**Files:**
- Create: `packages/ontology/src/graph/oxigraph-worker.ts`
- Create: `packages/ontology/src/graph/oxigraph-store.ts`
- Test: `packages/ontology/src/__tests__/oxigraph-store.test.ts`

**Context:** Oxigraph JS is synchronous WASM. Run it in a worker so a bad query cannot block the API event loop. The main thread serializes updates through a queue and enforces timeouts by terminating and respawning the worker.

- [ ] **Step 1: Write the failing test**

```ts
import { OxigraphStore } from '../graph/oxigraph-store';

describe('OxigraphStore', () => {
  it('runs a join and returns typed select rows', async () => {
    const store = new OxigraphStore();
    await store.load(`
<https://sse.local/report/r1> <https://sse.local/ontology#submittedBy> <https://sse.local/person/p1> <urn:sse:data> .
<https://sse.local/person/p1> <https://sse.local/ontology#belongsTo> <https://sse.local/dept/d1> <urn:sse:data> .
`);
    const res = await store.query(`
      SELECT ?report ?dept WHERE {
        ?report <https://sse.local/ontology#submittedBy> ?person .
        ?person <https://sse.local/ontology#belongsTo> ?dept .
      }
    `);
    expect(res).toEqual({
      kind: 'select',
      rows: [{ report: 'https://sse.local/report/r1', dept: 'https://sse.local/dept/d1' }],
    });
    await store.close();
  });

  it('times out a runaway query without killing the store', async () => {
    const store = new OxigraphStore();
    await expect(store.query('SELECT * WHERE { ?s ?p ?o }', { timeoutMs: 1 })).rejects.toThrow(/timeout/i);
    const counts = await store.counts();
    expect(counts.quads).toBe(0);
    await store.close();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
pnpm --filter @sse/ontology test -- oxigraph-store
```

Expected: FAIL, module missing.

- [ ] **Step 3: Implement the worker**

`oxigraph-worker.ts`:

```ts
import { parentPort } from 'node:worker_threads';
import oxigraph from 'oxigraph';
import type { ProjectedQuad } from './types';

const store = new oxigraph.Store();

function toQuad(q: ProjectedQuad) {
  return oxigraph.quad(
    oxigraph.namedNode(q.subject),
    oxigraph.namedNode(q.predicate),
    q.objectType === 'iri'
      ? oxigraph.namedNode(q.object)
      : oxigraph.literal(q.object, q.language ? { language: q.language } : q.datatype ? { datatype: oxigraph.namedNode(q.datatype) } : undefined),
    oxigraph.namedNode(q.graph),
  );
}

function fromQuad(q: any): ProjectedQuad {
  return {
    subject: q.subject.value,
    predicate: q.predicate.value,
    object: q.object.value,
    objectType: q.object.termType === 'NamedNode' ? 'iri' : 'literal',
    datatype: q.object.datatype?.value,
    language: q.object.language || undefined,
    graph: q.graph.value,
  };
}

parentPort!.on('message', (msg: any) => {
  try {
    switch (msg.type) {
      case 'load':
        store.load(msg.nquads, { format: 'application/n-quads' });
        parentPort!.postMessage({ id: msg.id, ok: true });
        break;
      case 'replaceAll':
        store.update('CLEAR ALL');
        store.load(msg.nquads, { format: 'application/n-quads' });
        parentPort!.postMessage({ id: msg.id, ok: true });
        break;
      case 'dump': {
        const quads = store.match(null, null, null, null).filter((q: any) => msg.graphs.includes(q.graph.value));
        parentPort!.postMessage({ id: msg.id, ok: true, result: quads.map((q: any) => q.toString()).join('\n') + (quads.length ? '\n' : '') });
        break;
      }
      case 'update':
        store.update(msg.sparql);
        parentPort!.postMessage({ id: msg.id, ok: true });
        break;
      case 'query': {
        const raw = store.query(msg.sparql);
        if (typeof raw === 'boolean') {
          parentPort!.postMessage({ id: msg.id, ok: true, result: { kind: 'ask', value: raw } });
        } else if (Array.isArray(raw)) {
          parentPort!.postMessage({
            id: msg.id,
            ok: true,
            result: {
              kind: 'select',
              rows: raw.map((binding: Map<string, any>) => {
                const row: Record<string, string> = {};
                for (const [k, v] of binding) row[k] = v.value;
                return row;
              }),
            },
          });
        } else {
          parentPort!.postMessage({ id: msg.id, ok: true, result: { kind: 'construct', quads: Array.from(raw).map(fromQuad) } });
        }
        break;
      }
      case 'replaceEntity':
        for (const predicate of msg.ownedPredicates) {
          store.update(`DELETE WHERE { GRAPH <urn:sse:data> { <${msg.subject}> <${predicate}> ?o } }`);
        }
        for (const q of msg.quads) store.add(toQuad(q));
        parentPort!.postMessage({ id: msg.id, ok: true });
        break;
      case 'addRelation':
        store.add(toQuad({ subject: msg.from, predicate: msg.predicate, object: msg.to, objectType: 'iri', graph: 'urn:sse:data' }));
        parentPort!.postMessage({ id: msg.id, ok: true });
        break;
      case 'removeRelation':
        store.update(`DELETE DATA { GRAPH <urn:sse:data> { <${msg.from}> <${msg.predicate}> <${msg.to}> } }`);
        parentPort!.postMessage({ id: msg.id, ok: true });
        break;
      case 'delete':
        store.update(`DELETE WHERE { GRAPH <urn:sse:data> { <${msg.subject}> ?p ?o } }`);
        store.update(`DELETE WHERE { GRAPH <urn:sse:data> { ?s ?p <${msg.subject}> } }`);
        store.update(`INSERT DATA { GRAPH <urn:sse:history> { <${msg.subject}> <https://sse.local/ontology#deletedAt> "${new Date().toISOString()}" } }`);
        parentPort!.postMessage({ id: msg.id, ok: true });
        break;
      case 'counts': {
        const quads = store.match(null, null, null, null);
        parentPort!.postMessage({ id: msg.id, ok: true, result: { quads: quads.length, subjects: new Set(quads.map((q: any) => q.subject.value)).size } });
        break;
      }
      default:
        parentPort!.postMessage({ id: msg.id, ok: false, error: `unknown message ${msg.type}` });
    }
  } catch (err: any) {
    parentPort!.postMessage({ id: msg.id, ok: false, error: err.message || String(err) });
  }
});
```

`oxigraph-store.ts`: spawn the worker with `new Worker(require.resolve('./oxigraph-worker.js'))` after build, or `__dirname + '/oxigraph-worker.js'` in CJS. Keep a FIFO queue and a `Map<id, {resolve,reject,timer}>`.

```ts
import { Worker } from 'node:worker_threads';
import { join } from 'node:path';
import type { GraphCounts, GraphQueryResult, GraphStore, ProjectedQuad } from './types';

type Pending = { resolve: (v: any) => void; reject: (e: Error) => void; timer: NodeJS.Timeout };

export class OxigraphStore implements GraphStore {
  private worker: Worker;
  private seq = 0;
  private pending = new Map<number, Pending>();
  private checkpointNquads = '';
  private dirty = false;
  private ready: Promise<void> = Promise.resolve();

  constructor(private workerPath = process.env.ONTOLOGY_WORKER_PATH || join(__dirname, 'oxigraph-worker.js')) {
    this.worker = this.spawn();
  }

  private spawn(): Worker {
    const w = new Worker(this.workerPath);
    w.on('message', (msg: any) => {
      const p = this.pending.get(msg.id);
      if (!p) return;
      clearTimeout(p.timer);
      this.pending.delete(msg.id);
      if (msg.ok) p.resolve(msg.result);
      else p.reject(new Error(msg.error));
    });
    w.on('error', (err) => this.failAll(err));
    w.on('exit', (code) => { if (code !== 0) this.failAll(new Error(`graph worker exited ${code}`)); });
    if (this.checkpointNquads) {
      const id = ++this.seq;
      this.ready = new Promise((resolve, reject) => {
        this.pending.set(id, {
          resolve: () => resolve(),
          reject,
          timer: setTimeout(() => reject(new Error('worker restore timeout')), 10_000),
        });
        w.postMessage({ id, type: 'load', nquads: this.checkpointNquads });
      });
    }
    return w;
  }

  private failAll(err: Error) {
    for (const [, p] of this.pending) { clearTimeout(p.timer); p.reject(err); }
    this.pending.clear();
  }

  private async call(type: string, payload: Record<string, unknown>, timeoutMs?: number): Promise<any> {
    await this.ready;
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      const timer = timeoutMs
        ? setTimeout(() => {
            this.pending.delete(id);
            reject(new Error('SPARQL timeout'));
            this.dirty = true;
            void this.worker.terminate();
            this.worker = this.spawn();
          }, timeoutMs)
        : setTimeout(() => {}, 0);
      this.pending.set(id, { resolve, reject, timer });
      this.worker.postMessage({ id, type, ...payload });
    });
  }

  query(sparql: string, opts?: { timeoutMs?: number }): Promise<GraphQueryResult> {
    return this.call('query', { sparql }, opts?.timeoutMs ?? 1500);
  }
  update(sparql: string): Promise<void> { return this.call('update', { sparql }); }
  load(nquads: string): Promise<void> {
    this.checkpointNquads = nquads;
    this.dirty = false;
    return this.call('load', { nquads });
  }
  replaceAll(nquads: string): Promise<void> {
    this.checkpointNquads = nquads;
    this.dirty = false;
    return this.call('replaceAll', { nquads });
  }
  dump(graphs: string[]): Promise<string> { return this.call('dump', { graphs }); }
  replaceEntity(subject: string, quads: ProjectedQuad[], ownedPredicates: string[]): Promise<void> {
    return this.call('replaceEntity', { subject, quads, ownedPredicates });
  }
  addRelation(from: string, predicate: string, to: string): Promise<void> {
    return this.call('addRelation', { from, predicate, to });
  }
  removeRelation(from: string, predicate: string, to: string): Promise<void> {
    return this.call('removeRelation', { from, predicate, to });
  }
  deleteSubject(subject: string): Promise<void> { return this.call('delete', { subject }); }
  checkpoint(nquads: string): void { this.checkpointNquads = nquads; }
  needsRebuild(): boolean { return this.dirty; }
  counts(): Promise<GraphCounts> { return this.call('counts', {}); }
  async close(): Promise<void> { await this.worker.terminate(); }
}
```

**Test note (M4):** unit tests that exercise the real worker must run after `pnpm --filter @sse/ontology build` and pass `workerPath` explicitly:

```ts
new OxigraphStore(join(__dirname, '../../dist/graph/oxigraph-worker.js'))
```

`MemoryGraphStore` is used for non-worker logic tests so ts-jest does not need a compiled worker.

Add a third test: load a complete snapshot, call `loadTBox`, force a timeout to respawn the worker, then assert `counts().quads` still includes the data graph (not just the TBox). This is the regression test for B2/N2.

- [ ] **Step 4: Run the test to verify it passes**

```bash
pnpm --filter @sse/ontology build
pnpm --filter @sse/ontology test -- oxigraph-store
```

Expected: PASS. If the timeout test is flaky on CI, set `timeoutMs: 5` and use a query over 100k quads; do not remove the test.

- [ ] **Step 5: Commit**

```bash
git add packages/ontology/src/graph packages/ontology/src/__tests__/oxigraph-store.test.ts
git commit -m "feat(ontology): run Oxigraph in a worker with timeout and respawn"
```

### Task 1.3: TBox and namespace contract tests

**Files:**
- Create: `packages/ontology/src/graph/ontology/sse.ttl`
- Test: `packages/ontology/src/__tests__/tbox.test.ts`

**Context:** The TBox is the semantic contract. Every mapped table must have a class; every relation must have domain/range. This test fails when the model drifts.

- [ ] **Step 1: Write the failing test**

```ts
import { readFileSync } from 'fs';
import { join } from 'path';
import { Parser } from 'n3';
import { sse } from '../graph/namespaces';

const ttl = readFileSync(join(__dirname, '../graph/ontology/sse.ttl'), 'utf-8');
const quads = new Parser().parse(ttl);

function hasType(uri: string, type: string) {
  return quads.some(q => q.subject.value === sse(uri) && q.predicate.value.endsWith('#type') && q.object.value.endsWith(type));
}

describe('SSE TBox', () => {
  it.each([
    'Person', 'Department', 'ExpenseCategory', 'ExpenseReport', 'ExpenseItem',
    'Invoice', 'ApprovalRule', 'ApprovalRecord', 'PaymentReceipt',
  ])('declares %s as an owl:Class', (cls) => {
    expect(hasType(cls, 'Class')).toBe(true);
  });

  it('declares core object properties with domain and range', () => {
    for (const p of ['submittedBy', 'containsItem', 'hasCategory', 'hasInvoice', 'approvedBy', 'governedBy', 'belongsTo', 'paidBy', 'hasPaymentReceipt']) {
      const subject = sse(p);
      expect(quads.some(q => q.subject.value === subject && q.predicate.value.endsWith('#type'))).toBe(true);
      expect(quads.some(q => q.subject.value === subject && q.predicate.value.endsWith('#domain'))).toBe(true);
      expect(quads.some(q => q.subject.value === subject && q.predicate.value.endsWith('#range'))).toBe(true);
    }
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
pnpm --filter @sse/ontology test -- tbox
```

Expected: FAIL, file missing.

- [ ] **Step 3: Write the TBox**

Create `packages/ontology/src/graph/ontology/sse.ttl`:

```turtle
@prefix sse: <https://sse.local/ontology#> .
@prefix owl: <http://www.w3.org/2002/07/owl#> .
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .

sse:Person a owl:Class .
sse:Department a owl:Class .
sse:ExpenseCategory a owl:Class .
sse:ExpenseReport a owl:Class .
sse:ExpenseItem a owl:Class .
sse:Invoice a owl:Class .
sse:ApprovalRule a owl:Class .
sse:ApprovalRecord a owl:Class .
sse:PaymentReceipt a owl:Class .

sse:DraftReport a owl:Class ; rdfs:subClassOf sse:ExpenseReport .
sse:PendingReport a owl:Class ; rdfs:subClassOf sse:ExpenseReport .
sse:ApprovedReport a owl:Class ; rdfs:subClassOf sse:ExpenseReport .
sse:RejectedReport a owl:Class ; rdfs:subClassOf sse:ExpenseReport .
sse:PaidReport a owl:Class ; rdfs:subClassOf sse:ExpenseReport .

sse:belongsTo a owl:ObjectProperty ;
  rdfs:domain sse:Person ; rdfs:range sse:Department .
sse:submittedBy a owl:ObjectProperty ;
  rdfs:domain sse:ExpenseReport ; rdfs:range sse:Person .
sse:containsItem a owl:ObjectProperty ;
  rdfs:domain sse:ExpenseReport ; rdfs:range sse:ExpenseItem .
sse:hasCategory a owl:ObjectProperty ;
  rdfs:domain sse:ExpenseItem ; rdfs:range sse:ExpenseCategory .
sse:hasInvoice a owl:ObjectProperty ;
  rdfs:domain sse:ExpenseItem ; rdfs:range sse:Invoice .
sse:hasApproval a owl:ObjectProperty ;
  rdfs:domain sse:ExpenseReport ; rdfs:range sse:ApprovalRecord .
sse:approvedBy a owl:ObjectProperty ;
  rdfs:domain sse:ApprovalRecord ; rdfs:range sse:Person .
sse:governedBy a owl:ObjectProperty ;
  rdfs:domain sse:ExpenseReport ; rdfs:range sse:ApprovalRule .
sse:paidBy a owl:ObjectProperty ;
  rdfs:domain sse:ExpenseReport ; rdfs:range sse:Person .
sse:hasPaymentReceipt a owl:ObjectProperty ;
  rdfs:domain sse:ExpenseReport ; rdfs:range sse:PaymentReceipt .
sse:hasCategoryRule a owl:ObjectProperty ;
  rdfs:domain sse:ApprovalRule ; rdfs:range sse:ExpenseCategory .

sse:name a owl:DatatypeProperty ; rdfs:domain sse:Person ; rdfs:range xsd:string .
sse:department a owl:DatatypeProperty ; rdfs:domain sse:Person ; rdfs:range xsd:string .
sse:role a owl:DatatypeProperty ; rdfs:domain sse:Person ; rdfs:range xsd:string .
sse:status a owl:DatatypeProperty ; rdfs:domain sse:ExpenseReport ; rdfs:range xsd:string .
sse:amount a owl:DatatypeProperty ; rdfs:range xsd:decimal .
sse:serialNo a owl:DatatypeProperty ; rdfs:domain sse:ExpenseReport ; rdfs:range xsd:string .
sse:paidAt a owl:DatatypeProperty ; rdfs:domain sse:ExpenseReport ; rdfs:range xsd:dateTime .
sse:paymentRef a owl:DatatypeProperty ; rdfs:domain sse:ExpenseReport ; rdfs:range xsd:string .
sse:invoiceNo a owl:DatatypeProperty ; rdfs:domain sse:Invoice ; rdfs:range xsd:string .
sse:verificationStatus a owl:DatatypeProperty ; rdfs:domain sse:Invoice ; rdfs:range xsd:string .
sse:fileName a owl:DatatypeProperty ; rdfs:domain sse:Invoice ; rdfs:range xsd:string .
sse:checksum a owl:DatatypeProperty ; rdfs:domain sse:Invoice ; rdfs:range xsd:string .
sse:uploadedAt a owl:DatatypeProperty ; rdfs:domain sse:Invoice ; rdfs:range xsd:dateTime .
sse:step a owl:DatatypeProperty ; rdfs:domain sse:ApprovalRecord ; rdfs:range xsd:integer .
sse:result a owl:DatatypeProperty ; rdfs:domain sse:ApprovalRecord ; rdfs:range xsd:string .
sse:sourceTable a owl:DatatypeProperty ; rdfs:range xsd:string .
sse:sourceId a owl:DatatypeProperty ; rdfs:range xsd:string .
sse:recordVersion a owl:DatatypeProperty ; rdfs:range xsd:string .
sse:deletedAt a owl:DatatypeProperty ; rdfs:range xsd:dateTime .
```

`PaymentReceipt` represents the uploaded receipt artifact: `verificationStatus`, `fileName`, `checksum`, `uploadedAt`. The monetary payment facts (`amount`, `status = paid`, `paidAt`, `paidBy`, `paymentRef`) live on `ExpenseReport` because that is where the columns actually are in `006_payment.sql` and `001_initial.sql`.

**N5 completeness:** the TBox above must declare **every** predicate the mapper can emit, not just the subset. Add declarations for `title`, `currentStep`, `submittedAt`, `completedAt`, `comment`, `stepStartedAt`, `approvedAt`, `isActive`, `sortOrder`, `minAmount`, `maxAmount`, `priority`, `approvalChain`, `expenseDate`, `description`. In `entity-mapper.ts`, export `const PREDICATES: string[]` containing every predicate it can emit, and make `tbox.test.ts` assert `PREDICATES.every(p => declared(sse(p)))`. This turns model drift into a test failure.

Create `packages/ontology/src/graph/ontology-loader.ts` so the TBox is actually loaded into `urn:sse:tbox` (H3 fix):

```ts
import { readFileSync } from 'fs';
import { join } from 'path';
import { Parser, Writer, DataFactory } from 'n3';
import { GRAPH } from './namespaces';
import type { GraphStore } from './types';

const { namedNode } = DataFactory;

export function turtleToNQuads(ttl: string, graph: string): string {
  const quads = new Parser().parse(ttl).map(q => DataFactory.quad(q.subject, q.predicate, q.object, namedNode(graph)));
  const writer = new Writer({ format: 'N-Quads' });
  writer.addQuads(quads);
  let output = '';
  writer.end((err, result) => { if (err) throw err; output = result; });
  return output;
}

export async function loadTBox(store: GraphStore): Promise<void> {
  const ttl = readFileSync(join(__dirname, 'ontology', 'sse.ttl'), 'utf-8');
  await store.load(turtleToNQuads(ttl, GRAPH.tbox));
}

export function loadShapes(): string {
  return readFileSync(join(__dirname, 'ontology', 'shapes.ttl'), 'utf-8');
}
```
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
pnpm --filter @sse/ontology test -- tbox
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/ontology/src/graph/ontology/sse.ttl packages/ontology/src/__tests__/tbox.test.ts
git commit -m "feat(ontology): add SSE TBox and contract tests"
```

### Task 1.4: Snapshot persistence and API wiring

**Files:**
- Create: `packages/db/src/migrations/015_ontology_graph_snapshots.sql`
- Create: `packages/ontology/src/graph/snapshot-repo.ts`
- Modify: `packages/api/src/index.ts`
- Test: `packages/ontology/src/__tests__/snapshot-repo.test.ts`

**Context:** The graph is in memory; snapshots make restarts fast and make drift detectable. Use N-Quads + SHA-256 checksum.

- [ ] **Step 1: Write the migration**

```sql
-- Dedicated table: the legacy `ontology_snapshots` JSONB rows must keep working
-- until Phase 7. Do not share one table between the two formats.
CREATE TABLE IF NOT EXISTS ontology_graph_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  version BIGINT NOT NULL,
  checksum TEXT NOT NULL,
  nquads TEXT NOT NULL,
  graph_names TEXT[] NOT NULL,
  last_outbox_id BIGINT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_ontology_graph_snapshots_version
  ON ontology_graph_snapshots(version);
CREATE INDEX IF NOT EXISTS idx_ontology_graph_snapshots_created
  ON ontology_graph_snapshots(created_at DESC);

CREATE TABLE IF NOT EXISTS ontology_projector_state (
  id TEXT PRIMARY KEY DEFAULT 'default',
  last_outbox_id BIGINT NOT NULL DEFAULT 0,
  last_snapshot_version BIGINT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO ontology_projector_state (id) VALUES ('default')
  ON CONFLICT (id) DO NOTHING;
```

- [ ] **Step 2: Write the failing test with a fake pool**

```ts
import { SnapshotRepo } from '../graph/snapshot-repo';

class FakePool {
  rows: any[] = [];
  async query(sql: string, params?: any[]) {
    if (sql.startsWith('INSERT INTO ontology_graph_snapshots')) {
      const row = { id: String(this.rows.length + 1), version: params![0], checksum: params![1], nquads: params![2], graph_names: params![3], last_outbox_id: params![4], created_at: new Date() };
      this.rows.push(row);
      return { rows: [row] };
    }
    if (sql.startsWith('SELECT') && sql.includes('ontology_graph_snapshots')) {
      return { rows: [this.rows[this.rows.length - 1]] };
    }
    if (sql.includes('MAX(version)')) {
      const max = this.rows.reduce((m, r) => Math.max(m, r.version), 0);
      return { rows: [{ version: max + 1 }] };
    }
    return { rows: [] };
  }
}

describe('SnapshotRepo', () => {
  it('round-trips nquads, checksum, graph list and outbox watermark', async () => {
    const repo = new SnapshotRepo(new FakePool() as any);
    const saved = await repo.save(
      ['urn:sse:data', 'urn:sse:inferred', 'urn:sse:history'],
      '<a> <b> <c> <urn:sse:data> .\n',
      42,
    );
    expect(saved.version).toBe(1);
    expect(saved.graphNames).toEqual(['urn:sse:data', 'urn:sse:inferred', 'urn:sse:history']);
    expect(saved.lastOutboxId).toBe(42);
    const loaded = await repo.latest();
    expect(loaded?.checksum).toBe(saved.checksum);
    expect(loaded?.nquads).toContain('<a> <b> <c>');
    expect(loaded?.lastOutboxId).toBe(42);
  });
});
```

- [ ] **Step 3: Implement `SnapshotRepo`**

```ts
import { createHash } from 'crypto';

export interface GraphSnapshot {
  version: number;
  checksum: string;
  nquads: string;
  graphNames: string[];
  lastOutboxId: number;
  createdAt: Date;
}

export class SnapshotRepo {
  constructor(private pool: { query: (sql: string, params?: any[]) => Promise<{ rows: any[] }> }) {}

  async save(graphNames: string[], nquads: string, lastOutboxId: number): Promise<GraphSnapshot> {
    const checksum = createHash('sha256').update(nquads).digest('hex');
    const version = await this.nextVersion();
    await this.pool.query(
      `INSERT INTO ontology_graph_snapshots (version, checksum, nquads, graph_names, last_outbox_id)
       VALUES ($1, $2, $3, $4, $5)`,
      [version, checksum, nquads, graphNames, lastOutboxId],
    );
    await this.pool.query(
      `UPDATE ontology_projector_state
          SET last_snapshot_version = $1, last_outbox_id = GREATEST(last_outbox_id, $2), updated_at = NOW()
        WHERE id = 'default'`,
      [version, lastOutboxId],
    );
    await this.prune(5);
    return { version, checksum, nquads, graphNames, lastOutboxId, createdAt: new Date() };
  }

  async latest(): Promise<GraphSnapshot | null> {
    const { rows } = await this.pool.query(
      `SELECT version, checksum, nquads, graph_names, last_outbox_id, created_at
         FROM ontology_graph_snapshots
        ORDER BY version DESC LIMIT 1`,
    );
    if (rows.length === 0) return null;
    const row = rows[0];
    return {
      version: Number(row.version),
      checksum: row.checksum,
      nquads: row.nquads,
      graphNames: row.graph_names,
      lastOutboxId: Number(row.last_outbox_id),
      createdAt: row.created_at,
    };
  }

  async prune(keep = 5): Promise<void> {
    await this.pool.query(
      `DELETE FROM ontology_graph_snapshots
        WHERE version NOT IN (SELECT version FROM ontology_graph_snapshots ORDER BY version DESC LIMIT $1)`,
      [keep],
    );
  }

  private async nextVersion(): Promise<number> {
    const { rows } = await this.pool.query(
      `SELECT COALESCE(MAX(version), 0) + 1 AS version FROM ontology_graph_snapshots`,
    );
    return Number(rows[0].version);
  }
}
```

- [ ] **Step 4: Wire API startup behind the flag**

In `packages/api/src/index.ts`, after `initOntology()`:

```ts
if (process.env.ONTOLOGY_V2 === 'on' || process.env.ONTOLOGY_V2 === 'shadow') {
  const { startOntologyProjector } = await import('./services/ontology-projector');
  await startOntologyProjector();
}
```

Create `packages/api/src/services/ontology-projector.ts` with a no-op placeholder for now:

```ts
export async function startOntologyProjector(): Promise<void> {
  // Implemented in Phase 2.
}
```

- [ ] **Step 5: Verify**

```bash
pnpm --filter @sse/db build
pnpm --filter @sse/ontology test -- snapshot-repo
pnpm --filter @sse/api build
```

Expected: PASS and builds. Migration is applied in Task 2.6 before enabling the flag.

- [ ] **Step 6: Commit**

```bash
git add packages/db/src/migrations/015_ontology_graph_snapshots.sql packages/ontology/src/graph/snapshot-repo.ts packages/ontology/src/__tests__/snapshot-repo.test.ts packages/api/src/index.ts packages/api/src/services/ontology-projector.ts
git commit -m "feat(ontology): persist versioned graph snapshots"
```

---

## Phase 2: Record equivalence

**Goal:** Every mapped row is projected within seconds; deletes remove nodes; a full rebuild is deterministic.

**Exit criteria:** Outbox triggers capture all writes; projector handles INSERT/UPDATE/DELETE; all nine entity types are mapped; reconcile reproduces checksums; no secret columns in the graph.

### Task 2.1: Outbox migration and triggers

**Files:**
- Create: `packages/db/src/migrations/016_ontology_outbox.sql`
- Test: `test/ontology-outbox.test.ts` (integration; skipped when `TEST_DATABASE_URL` is absent)

**Context:** Triggers guarantee coverage. The trigger strips secrets and PII **before** the row reaches the outbox, so phone/email/OCR text never sit in a new Postgres table. Trigger creation is gated by `ontology_settings.outbox_enabled` so enabling the migration does not add write cost before the projector runs.

- [ ] **Step 1: Write the migration**

```sql
CREATE TABLE IF NOT EXISTS ontology_outbox (
  id BIGSERIAL PRIMARY KEY,
  table_name TEXT NOT NULL,
  op TEXT NOT NULL CHECK (op IN ('INSERT', 'UPDATE', 'DELETE')),
  row_id UUID,
  old_row JSONB,
  new_row JSONB,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at TIMESTAMPTZ,
  attempts INT NOT NULL DEFAULT 0,
  last_error TEXT,
  dead_letter BOOLEAN NOT NULL DEFAULT false
);

CREATE INDEX IF NOT EXISTS idx_ontology_outbox_pending
  ON ontology_outbox(id) WHERE processed_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_ontology_outbox_processed_at
  ON ontology_outbox(processed_at);
CREATE INDEX IF NOT EXISTS idx_ontology_outbox_dead_letter
  ON ontology_outbox(dead_letter) WHERE dead_letter = true;

CREATE TABLE IF NOT EXISTS ontology_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
INSERT INTO ontology_settings (key, value) VALUES ('outbox_enabled', 'false')
  ON CONFLICT (key) DO NOTHING;

CREATE OR REPLACE FUNCTION sse_ontology_outbox_trigger() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  enabled TEXT;
  forbidden TEXT[] := ARRAY[
    'password_hash', 'phone', 'email',
    'storage_key', 'storage_bucket', 'ocr_result', 'verification_result'
  ];
BEGIN
  SELECT value INTO enabled FROM ontology_settings WHERE key = 'outbox_enabled';
  IF COALESCE(enabled, 'false') <> 'true' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  INSERT INTO ontology_outbox(table_name, op, row_id, old_row, new_row)
  VALUES (
    TG_TABLE_NAME,
    TG_OP,
    COALESCE(NEW.id, OLD.id),
    CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE to_jsonb(OLD) - forbidden END,
    CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE to_jsonb(NEW) - forbidden END
  );
  RETURN COALESCE(NEW, OLD);
END;
$$;

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['users','expense_categories','expense_reports','expense_items','invoices','approval_rules','approval_records','payment_receipts']
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_%s_ontology_outbox ON %I', t, t);
    EXECUTE format('CREATE TRIGGER trg_%s_ontology_outbox AFTER INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION sse_ontology_outbox_trigger()', t, t);
  END LOOP;
END $$;

-- Trigger function is SECURITY DEFINER, so the application role does not need
-- INSERT on ontology_outbox. Keep the explicit grant for tools/tests anyway.
GRANT INSERT ON ontology_outbox TO CURRENT_USER;
```

**Enablement:** the API sets `ontology_settings.outbox_enabled = 'true'` only when `ONTOLOGY_V2=on|shadow` (Task 2.4). Before that, the trigger returns immediately and the migration is behavior-neutral.

- [ ] **Step 2: Write the integration test**

```ts
const dbUrl = process.env.TEST_DATABASE_URL;

(dbUrl ? describe : describe.skip)('ontology outbox', () => {
  const { Client } = require('pg');

  test('captures insert/update/delete and strips secrets and PII', async () => {
    const client = new Client({ connectionString: dbUrl });
    await client.connect();
    try {
      await client.query(`UPDATE ontology_settings SET value = 'true' WHERE key = 'outbox_enabled'`);
      await client.query(`INSERT INTO users (id, name, phone, email, department, role, status, password_hash)
        VALUES ('00000000-0000-0000-0000-000000000001','Outbox Test','13800000099','a@b.com','QA','employee','active','secret')
        ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name`);
      await client.query(`UPDATE users SET department = 'QA2' WHERE id = '00000000-0000-0000-0000-000000000001'`);
      await client.query(`DELETE FROM users WHERE id = '00000000-0000-0000-0000-000000000001'`);
      const { rows } = await client.query(`SELECT op, new_row, old_row FROM ontology_outbox ORDER BY id DESC LIMIT 3`);
      expect(rows.map(r => r.op).sort()).toEqual(['DELETE', 'INSERT', 'UPDATE']);
      const serialized = rows.map(r => JSON.stringify({ n: r.new_row, o: r.old_row })).join('\n');
      for (const forbidden of ['password_hash', '13800000099', 'a@b.com', 'storage_key', 'storage_bucket', 'ocr_result']) {
        expect(serialized).not.toContain(forbidden);
      }
    } finally {
      await client.query(`UPDATE ontology_settings SET value = 'false' WHERE key = 'outbox_enabled'`).catch(() => {});
      await client.end();
    }
  });
});
```

- [ ] **Step 3: Apply and verify**

```bash
$env:TEST_DATABASE_URL="postgres://sse:sse_dev@localhost:5433/sse"
$env:DATABASE_URL=$env:TEST_DATABASE_URL
pnpm --filter @sse/db migrate
cd test; npx jest ontology-outbox --runInBand
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/db/src/migrations/016_ontology_outbox.sql test/ontology-outbox.test.ts
git commit -m "feat(ontology): capture record changes in an outbox via triggers"
```

### Task 2.2: Entity mapper for all business tables

**Files:**
- Create: `packages/ontology/src/projection/entity-mapper.ts`
- Test: `packages/ontology/src/__tests__/entity-mapper.test.ts`

**Context:** Pure functions only. The mapper is the single place that decides which columns become graph properties. Never spread raw rows.

- [ ] **Step 1: Write the failing test**

```ts
import { projectRow } from '../projection/entity-mapper';

describe('projectRow', () => {
  it('maps a pending report without leaking secrets', () => {
    const p = projectRow('expense_reports', 'UPDATE', {
      id: 'r1', serial_no: 'RE-1', user_id: 'p1', title: '差旅', total_amount: '120.50',
      status: 'pending', current_step: 1, submitted_at: '2026-11-10T00:00:00Z',
      updated_at: '2026-11-10T00:01:00Z', paid_by: null,
    });
    expect(p.writes[0].uri).toBe('https://sse.local/report/r1');
    const quads = p.writes[0].quads;
    expect(quads).toContainEqual(expect.objectContaining({ predicate: 'https://sse.local/ontology#status', object: 'pending' }));
    expect(quads).toContainEqual(expect.objectContaining({ predicate: 'https://sse.local/ontology#submittedBy', object: 'https://sse.local/person/p1', objectType: 'iri' }));
    expect(p.writes[0].ownedPredicates).toContain('https://sse.local/ontology#submittedBy');
    expect(p.add).toEqual([]);
    expect(JSON.stringify(quads)).not.toContain('password');
  });

  it('maps rejected as rejected, not approved', () => {
    const p = projectRow('expense_reports', 'UPDATE', {
      id: 'r2', serial_no: 'RE-2', user_id: 'p1', title: 'x', total_amount: '1',
      status: 'rejected', current_step: 1, updated_at: '2026-11-10T00:01:00Z',
    });
    const quads = p.writes[0].quads;
    expect(quads.find(q => q.predicate.endsWith('#status'))!.object).toBe('rejected');
    expect(quads.some(q => q.objectType === 'iri' && q.object.endsWith('ApprovedReport'))).toBe(false);
  });

  it('maps a user without phone or email and writes the department node', () => {
    const p = projectRow('users', 'INSERT', {
      id: 'p1', name: '张三', phone: '13800000000', email: 'a@b.com',
      department: '研发', role: 'employee', status: 'active', password_hash: 'x',
    });
    expect(p.writes.map(w => w.uri)).toContain('https://sse.local/person/p1');
    expect(p.writes.map(w => w.uri)).toContain('https://sse.local/dept/%E7%A0%94%E5%8F%91');
    const serialized = JSON.stringify(p);
    expect(serialized).not.toContain('13800000000');
    expect(serialized).not.toContain('a@b.com');
    expect(serialized).not.toContain('password_hash');
  });

  it('retracts the old parent when a child moves', () => {
    const p = projectRow('expense_items', 'UPDATE', {
      id: 'i1', report_id: 'r2', category_id: 'c1', amount: '10', expense_date: '2026-11-10', description: 'x',
    }, { id: 'i1', report_id: 'r1', category_id: 'c2' });
    expect(p.remove).toContainEqual({ from: 'https://sse.local/report/r1', predicate: 'https://sse.local/ontology#containsItem', to: 'https://sse.local/item/i1' });
    expect(p.add).toContainEqual({ from: 'https://sse.local/report/r2', predicate: 'https://sse.local/ontology#containsItem', to: 'https://sse.local/item/i1' });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
pnpm --filter @sse/ontology test -- entity-mapper
```

Expected: FAIL, module missing.

- [ ] **Step 3: Implement the mapper**

Create `entity-mapper.ts` with this **write-set** shape. Parent/child relations are explicit adds/removals, never a partial parent rewrite. This is the fix for the full-subject-delete corruption (B1).

```ts
import { GRAPH, RDF_TYPE, SSE, XSD, PROV, uri, sse } from '../graph/namespaces';
import type { ProjectedQuad } from '../graph/types';

export type MappedTable =
  | 'users' | 'expense_categories' | 'expense_reports' | 'expense_items'
  | 'invoices' | 'approval_rules' | 'approval_records' | 'payment_receipts';

export interface EntityWrite {
  uri: string;
  quads: ProjectedQuad[];
  /** Only these outgoing predicates may be deleted+replaced. */
  ownedPredicates: string[];
}

export interface RelationWrite {
  from: string;
  predicate: string;
  to: string;
}

export interface EntityProjection {
  writes: EntityWrite[];
  add: RelationWrite[];
  remove: RelationWrite[];
}

const q = (subject: string, predicate: string, object: string, objectType: 'iri' | 'literal', datatype?: string): ProjectedQuad => ({
  subject, predicate: sse(predicate), object, objectType, datatype, graph: GRAPH.data,
});

function provenance(uriValue: string, table: string, row: Record<string, any>): ProjectedQuad[] {
  return [
    q(uriValue, 'sourceTable', table, 'literal'),
    q(uriValue, 'sourceId', String(row.id), 'literal'),
    q(uriValue, 'recordVersion', String(row.updated_at ?? row.uploaded_at ?? row.created_at ?? ''), 'literal', `${XSD}dateTime`),
  ];
}

export function projectRow(
  table: MappedTable,
  op: 'INSERT' | 'UPDATE',
  row: Record<string, any>,
  oldRow: Record<string, any> | null = null,
): EntityProjection {
  // 1. choose URI by table
  // 2. whitelist fields per table (never spread the row)
  // 3. emit rdf:type + provenance + properties
  // 4. emit adds/removes for parent-child and cross-entity relations
}
```

Field whitelists (implement exactly):

**One mechanism per object property.** Entity-owned outgoing edges go into `quads` + `ownedPredicates` and are auto-retracted by `replaceEntity`. Only parent-side edges (emitted by the child row) use `add`/`remove`. This eliminates the N1 ambiguity.

| Table | Entity URI | Owned quads (literals + entity-owned object edges) | Add/remove only (parent-side edges) |
|---|---|---|---|
| `users` | `uri.person(id)` + `uri.department(department)` | Person: `name`, `department`, `role`, `status`, `belongsTo` -> dept; Department: `name` (`RDF_TYPE` in both) | none |
| `expense_categories` | `uri.category(id)` | `name`, `isActive` (`xsd:boolean`), `sortOrder` (`xsd:integer`) | none |
| `expense_reports` | `uri.report(id)` | `serialNo`, `title`, `amount` (`xsd:decimal`), `status`, `currentStep` (`xsd:integer`), `submittedAt`, `completedAt`, `paidAt`, `paymentRef`, `submittedBy` -> person, `paidBy` -> person | none |
| `expense_items` | `uri.item(id)` | `amount` (`xsd:decimal`), `expenseDate` (`xsd:date`), `description`, `hasCategory` -> category | report `containsItem` item |
| `invoices` | `uri.invoice(id)` | `invoiceNo`, `verificationStatus`, `fileName`, `checksum`, `uploadedAt` | item `hasInvoice` invoice |
| `approval_rules` | `uri.rule(id)` | `name`, `minAmount`, `maxAmount`, `priority`, `isActive`, `approvalChain`, `hasCategoryRule` -> category | none |
| `approval_records` | `uri.approval(id)` | `step` (`xsd:integer`), `result`, `comment`, `stepStartedAt`, `approvedAt`, `approvedBy` -> person | report `hasApproval` approval |
| `payment_receipts` | `uri.payment(id)` | `verificationStatus`, `fileName`, `checksum`, `uploadedAt` | report `hasPaymentReceipt` payment |

**Source columns:** `approval_records` uses `approver_id` (not `approved_by`) for `sse:approvedBy`; `expense_reports` uses `total_amount` for `sse:amount`; `expense_items` uses `expense_date` for `sse:expenseDate`; `approval_rules` uses `category_ids` for `sse:hasCategoryRule`; `expense_categories` uses `is_active`/`sort_order` for `sse:isActive`/`sse:sortOrder`; `approval_records` uses `step_started_at`/`approved_at` for `sse:stepStartedAt`/`sse:approvedAt`. See the explicit column map below.

**Explicit column -> predicate map (do not guess):**

| Table | Column | Predicate |
|---|---|---|
| `users` | `name` / `department` / `role` / `status` / `deleted_at` | `sse:name` / `sse:department` / `sse:role` / `sse:status` / `sse:deletedAt` |
| `expense_categories` | `name` / `is_active` / `sort_order` | `sse:name` / `sse:isActive` / `sse:sortOrder` |
| `expense_reports` | `serial_no` / `title` / `total_amount` / `status` / `current_step` / `submitted_at` / `completed_at` / `paid_at` / `payment_ref` / `user_id` / `paid_by` | `sse:serialNo` / `sse:title` / `sse:amount` / `sse:status` / `sse:currentStep` / `sse:submittedAt` / `sse:completedAt` / `sse:paidAt` / `sse:paymentRef` / `sse:submittedBy` / `sse:paidBy` |
| `expense_items` | `report_id` / `category_id` / `amount` / `expense_date` / `description` | parent `containsItem` / `sse:hasCategory` / `sse:amount` / `sse:expenseDate` / `sse:description` |
| `invoices` | `item_id` / `invoice_no` / `verification_status` / `file_name` / `checksum` / `uploaded_at` | parent `hasInvoice` / `sse:invoiceNo` / `sse:verificationStatus` / `sse:fileName` / `sse:checksum` / `sse:uploadedAt` |
| `approval_rules` | `name` / `min_amount` / `max_amount` / `priority` / `is_active` / `approval_chain` / `category_ids` | `sse:name` / `sse:minAmount` / `sse:maxAmount` / `sse:priority` / `sse:isActive` / `sse:approvalChain` / `sse:hasCategoryRule` |
| `approval_records` | `report_id` / `approver_id` / `step` / `result` / `comment` / `step_started_at` / `approved_at` | parent `hasApproval` / `sse:approvedBy` / `sse:step` / `sse:result` / `sse:comment` / `sse:stepStartedAt` / `sse:approvedAt` |
| `payment_receipts` | `report_id` / `verification_status` / `file_name` / `checksum` / `uploaded_at` | parent `hasPaymentReceipt` / `sse:verificationStatus` / `sse:fileName` / `sse:checksum` / `sse:uploadedAt` |

**Payment facts:** `payment_receipts` has no `amount`, `status`, `paidAt`, or `receiptNo` columns. The monetary facts come from `expense_reports` (`paid_at`, `paid_by`, `payment_ref`) and are emitted on the report entity. `PaymentReceipt` is the uploaded artifact only (verification status, file name, checksum, upload time). This is the fix for B3.

**Soft-deleted users (N8):** if `users.deleted_at` is non-null, emit `sse:deletedAt` and set `sse:status` to `deleted`; do not emit `belongsTo`. Typed queries that need active approvers filter `status = "active"`.

**Department entity:** the `users` projection writes a second subject `uri.department(department)` with `rdf:type Department` and `sse:name`, so department-scoped queries work. This is the fix for H2. Handle `department = null` as `未分配`.

**Retraction:** on `UPDATE`, if `oldRow` points to a different parent (`report_id`, `item_id`, `uploaded_by`), emit `remove` for the old parent relation before the `add`. Example: an item moving from report R1 to R2 emits `remove(R1, containsItem, item)` and `add(R2, containsItem, item)`. A user changing department is handled by `ownedPredicates` including `belongsTo` (only the person's outgoing edge is replaced).

**Never** include a parent-owned predicate (`containsItem`, `hasApproval`, `hasPaymentReceipt`, `hasInvoice`) in a child's `ownedPredicates`. The parent edge is owned by the child row's `add`/`remove`, and `deleteSubject(child)` removes it when the child is deleted.

`ownedPredicates` values are **full predicate IRIs** (`sse('status')`, `sse('belongsTo')`), not short names. Build them with the `sse()` helper so the graph adapter can emit exact `DELETE WHERE { <s> <p> ?o }` updates. Include `RDF_TYPE` in every entity's owned list so a changed class cannot leave a stale type triple.

- [ ] **Step 4: Add mapping tests for every table**

Add one test per table asserting the URI, the `rdf:type` class, and at least one relation. Include `approval_rules.category_ids`, `invoices.invoice_no`, and a `payment_receipts` test that asserts the mapper emits **no** `sse:amount`, `sse:status`, or `sse:paidAt` for the receipt (B3 regression).

- [ ] **Step 5: Run the tests**

```bash
pnpm --filter @sse/ontology test -- entity-mapper
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/ontology/src/projection/entity-mapper.ts packages/ontology/src/__tests__/entity-mapper.test.ts
git commit -m "feat(ontology): map all business tables to RDF with field whitelists"
```

### Task 2.3: Graph projector with idempotency and retries

**Files:**
- Create: `packages/ontology/src/projection/projector.ts`
- Test: `packages/ontology/src/__tests__/projector.test.ts`

**Context:** The projector is the heart of equivalence. It must be safe to run twice and must never lose an event.

- [ ] **Step 1: Write the failing test with a fake pool and memory store**

```ts
import { GraphProjector } from '../projection/projector';
import { MemoryGraphStore } from '../graph/memory-store';

function fakePool(rows: any[]) {
  return {
    query: jest.fn(async (sql: string, params?: any[]) => {
      if (sql.includes('FROM ontology_outbox') && sql.includes('FOR UPDATE SKIP LOCKED')) return { rows };
      return { rows: [] };
    }),
  };
}

describe('GraphProjector', () => {
  it('projects insert/update/delete and marks rows processed', async () => {
    const store = new MemoryGraphStore();
    const pool = fakePool([
      { id: 1, table_name: 'expense_reports', op: 'INSERT', row_id: 'r1', old_row: null, new_row: { id: 'r1', serial_no: 'RE-1', user_id: 'p1', title: 't', total_amount: '10', status: 'pending', current_step: 1, updated_at: '2026-11-10T00:00:00Z' } },
      { id: 2, table_name: 'expense_reports', op: 'UPDATE', row_id: 'r1', old_row: {}, new_row: { id: 'r1', serial_no: 'RE-1', user_id: 'p1', title: 't', total_amount: '10', status: 'approved', current_step: 1, updated_at: '2026-11-10T00:01:00Z' } },
      { id: 3, table_name: 'expense_reports', op: 'DELETE', row_id: 'r1', old_row: { id: 'r1' }, new_row: null },
    ]);
    const projector = new GraphProjector(store, pool as any);
    const result = await projector.drain(10);
    expect(result.processed).toBe(3);
    const res = await store.query('SELECT ?s WHERE { GRAPH <urn:sse:data> { ?s a <https://sse.local/ontology#ExpenseReport> } }');
    expect(res.rows).toEqual([]);
  });

  it('is idempotent when replayed', async () => {
    const store = new MemoryGraphStore();
    const row = { id: 1, table_name: 'users', op: 'INSERT', row_id: 'p1', old_row: null, new_row: { id: 'p1', name: 'A', department: 'D', role: 'employee', status: 'active' } };
    const projector = new GraphProjector(store, fakePool([row, row]) as any);
    await projector.drain(10);
    const res = await store.query('SELECT ?s ?o WHERE { GRAPH <urn:sse:data> { ?s <https://sse.local/ontology#name> ?o } }');
    expect(res.rows).toHaveLength(1);
  });

  it('keeps report submittedBy when the person row is updated', async () => {
    const store = new MemoryGraphStore();
    await store.load(`
<https://sse.local/report/r1> <https://sse.local/ontology#submittedBy> <https://sse.local/person/p1> <urn:sse:data> .
<https://sse.local/person/p1> <https://sse.local/ontology#name> "Old" <urn:sse:data> .
`);
    const row = { id: 2, table_name: 'users', op: 'UPDATE', row_id: 'p1', old_row: { id: 'p1' }, new_row: { id: 'p1', name: 'New', department: 'D', role: 'employee', status: 'active' } };
    const projector = new GraphProjector(store, fakePool([row]) as any);
    await projector.drain(10);
    const res = await store.query('SELECT ?r WHERE { GRAPH <urn:sse:data> { ?r <https://sse.local/ontology#submittedBy> <https://sse.local/person/p1> } }');
    expect(res.rows).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
pnpm --filter @sse/ontology test -- projector
```

Expected: FAIL, module missing.

- [ ] **Step 3: Implement the projector**

Use this algorithm. It stops at the first non-dead-lettered failure so the watermark stays contiguous (fix for M3), and applies relation writes separately (fix for B1).

```ts
export class GraphProjector {
  constructor(private store: GraphStore, private pool: PoolLike, private opts = { batchSize: 200, maxAttempts: 10 }) {}

  async drain(limit = this.opts.batchSize): Promise<{ processed: number; failed: number; deadLettered: number }> {
    const client = await this.pool.connect();
    let processed = 0;
    let failed = 0;
    let deadLettered = 0;
    let lastProcessedId = 0;
    try {
      await client.query('BEGIN');
      const lock = await client.query(`SELECT pg_try_advisory_xact_lock(728001) AS ok`);
      if (!lock.rows[0].ok) { await client.query('ROLLBACK'); return { processed: 0, failed: 0, deadLettered: 0 }; }
      const { rows } = await client.query(
        `SELECT id, table_name, op, row_id, old_row, new_row, attempts
           FROM ontology_outbox
          WHERE processed_at IS NULL AND dead_letter = false
          ORDER BY id
          LIMIT $1
          FOR UPDATE SKIP LOCKED`,
        [limit],
      );

      for (const row of rows) {
        try {
          if (row.op === 'DELETE') {
            await this.store.deleteSubject(entityUri(row.table_name, row.row_id));
          } else {
            const projection = projectRow(row.table_name, row.op, row.new_row, row.old_row);
            for (const write of projection.writes) {
              await this.store.replaceEntity(write.uri, write.quads, write.ownedPredicates);
            }
            for (const rel of projection.remove) {
              await this.store.removeRelation(rel.from, rel.predicate, rel.to);
            }
            for (const rel of projection.add) {
              await this.store.addRelation(rel.from, rel.predicate, rel.to);
            }
          }
          await client.query(`UPDATE ontology_outbox SET processed_at = NOW() WHERE id = $1`, [row.id]);
          processed++;
          lastProcessedId = row.id;
        } catch (err: any) {
          failed++;
          const attempts = row.attempts + 1;
          const dead = attempts >= this.opts.maxAttempts;
          await client.query(
            `UPDATE ontology_outbox
                SET attempts = $2, last_error = $3, dead_letter = $4,
                    processed_at = CASE WHEN $4 THEN NOW() ELSE processed_at END
              WHERE id = $1`,
            [row.id, attempts, String(err.message || err).slice(0, 1000), dead],
          );
          if (dead) {
            deadLettered++;
            lastProcessedId = row.id;
            continue;
          }
          // Preserve ordering: do not advance past a retryable failure.
          break;
        }
      }

      if (lastProcessedId > 0) {
        await client.query(
          `UPDATE ontology_projector_state
              SET last_outbox_id = $1, updated_at = NOW()
            WHERE id = 'default' AND last_outbox_id < $1`,
          [lastProcessedId],
        );
      }
      await client.query('COMMIT');
      return { processed, failed, deadLettered };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async purgeOldEvents(days = 7): Promise<number> {
    const { rowCount } = await this.pool.query(
      `DELETE FROM ontology_outbox
        WHERE processed_at IS NOT NULL
          AND processed_at < NOW() - ($1 || ' days')::interval`,
      [days],
    );
    return rowCount ?? 0;
  }
}
```

`entityUri(table, id)` is exported from `entity-mapper.ts`:

```ts
export function entityUri(table: string, id: string): string {
  switch (table) {
    case 'users': return uri.person(id);
    case 'expense_categories': return uri.category(id);
    case 'expense_reports': return uri.report(id);
    case 'expense_items': return uri.item(id);
    case 'invoices': return uri.invoice(id);
    case 'approval_rules': return uri.rule(id);
    case 'approval_records': return uri.approval(id);
    case 'payment_receipts': return uri.payment(id);
    default: throw new Error(`unmapped table ${table}`);
  }
}
```

Dead-lettered rows are surfaced at `/ontology/status` and require an admin reconcile.

- [ ] **Step 4: Run the tests**

```bash
pnpm --filter @sse/ontology test -- projector
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/ontology/src/projection packages/ontology/src/__tests__/projector.test.ts
git commit -m "feat(ontology): add idempotent outbox projector with retries"
```

### Task 2.4: Projector lifecycle in the API

**Files:**
- Modify: `packages/api/src/services/ontology-projector.ts`
- Test: `packages/api/src/__tests__/ontology-projector.test.ts`

**Context:** Start the projector after the API boots, stop it gracefully, and expose health.

- [ ] **Step 1: Write the failing test**

```ts
import { ProjectorRunner } from '../services/ontology-projector';

describe('ProjectorRunner', () => {
  it('drains and sleeps until stopped', async () => {
    const calls: string[] = [];
    const runner = new ProjectorRunner({
      drain: async () => { calls.push('drain'); return { processed: 1, failed: 0, deadLettered: 0 }; },
      purgeOldEvents: async () => 0,
      snapshot: async () => {},
      runRules: async () => {},
      needsRebuild: () => false,
      reconcile: async () => { calls.push('reconcile'); },
    } as any, { intervalMs: 5, snapshotEvery: 2 });
    runner.start();
    await new Promise(r => setTimeout(r, 30));
    await runner.stop();
    expect(calls.filter(c => c === 'drain').length).toBeGreaterThan(1);
  });
});
```

- [ ] **Step 2: Implement `ProjectorRunner` and `startOntologyProjector`**

`packages/api/src/services/ontology-projector.ts`:

```ts
import { pool } from '@sse/db';
import {
  OxigraphStore,
  GraphProjector,
  RuleEngine,
  SnapshotRepo,
  loadTBox,
  setGraphContext,
  reconcile,
} from '@sse/ontology';

export interface ProjectorDeps {
  drain: (n?: number) => Promise<{ processed: number; failed: number; deadLettered: number }>;
  purgeOldEvents: (days?: number) => Promise<number>;
  snapshot: () => Promise<void>;
  runRules: () => Promise<void>;
  /** True after a worker timeout/respawn; the runner must reconcile from DB. */
  needsRebuild: () => boolean;
  reconcile: () => Promise<void>;
}

export class ProjectorRunner {
  private timer?: NodeJS.Timeout;
  private ticks = 0;
  private stopped = false;

  constructor(private deps: ProjectorDeps, private opts = { intervalMs: 1000, snapshotEvery: 5 }) {}

  start(): void {
    this.timer = setInterval(() => { void this.tick(); }, this.opts.intervalMs);
    this.timer.unref?.();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    await this.deps.snapshot();
  }

  private async tick(): Promise<void> {
    if (this.stopped) return;
    try {
      if (this.deps.needsRebuild()) {
        console.error('[ontology] graph worker respawned; running full reconcile');
        await this.deps.reconcile();
      }
      const { processed, failed, deadLettered } = await this.deps.drain();
      if (processed > 0) await this.deps.runRules();
      this.ticks++;
      if (processed > 0 && this.ticks % this.opts.snapshotEvery === 0) await this.deps.snapshot();
      if (failed > 0) console.error(`[ontology] projector failures: ${failed}`);
      if (deadLettered > 0) console.error(`[ontology] dead-lettered rows: ${deadLettered}`);
    } catch (err: any) {
      console.error(`[ontology] projector tick failed: ${err.message}`);
    }
  }
}

let runner: ProjectorRunner | undefined;

export async function startOntologyProjector(): Promise<void> {
  if (runner) return;

  // Enable the outbox triggers only now that a projector is running.
  await pool.query(`UPDATE ontology_settings SET value = 'true', updated_at = NOW() WHERE key = 'outbox_enabled'`);

  const store = new OxigraphStore();
  const snapshots = new SnapshotRepo(pool);
  const latest = await snapshots.latest();

  // Load the TBox first. `load()` also updates the respawn checkpoint, so the
  // snapshot load must come last to leave the checkpoint in a complete state
  // (N2 fix).
  await loadTBox(store);

  // B2 fix: restore the graph and the resume watermark before draining.
  if (latest) {
    await store.load(latest.nquads);
    await pool.query(
      `UPDATE ontology_projector_state
          SET last_outbox_id = GREATEST(last_outbox_id, $1), updated_at = NOW()
        WHERE id = 'default'`,
      [latest.lastOutboxId],
    );
  } else {
    await reconcile(store, pool);
  }

  setGraphContext(store, pool);

  const projector = new GraphProjector(store, pool);
  const rules = new RuleEngine(store, pool);
  let lastRuleRun = 0;
  const runRules = async () => {
    if (Date.now() - lastRuleRun < 2000) return;
    lastRuleRun = Date.now();
    await rules.materialize();
  };

  runner = new ProjectorRunner({
    drain: (n) => projector.drain(n),
    purgeOldEvents: (d) => projector.purgeOldEvents(d),
    snapshot: async () => {
      const graphNames = ['urn:sse:tbox', 'urn:sse:data', 'urn:sse:inferred', 'urn:sse:history', 'urn:sse:manual'];
      const nquads = await store.dump(graphNames);
      const state = await pool.query(`SELECT last_outbox_id FROM ontology_projector_state WHERE id = 'default'`);
      const lastOutboxId = Number(state.rows[0]?.last_outbox_id ?? 0);
      store.checkpoint(nquads);
      await snapshots.save(graphNames, nquads, lastOutboxId);
    },
    runRules,
    needsRebuild: () => store.needsRebuild(),
    reconcile: () => reconcile(store, pool),
  }, {
    intervalMs: Number(process.env.ONTOLOGY_PROJECT_INTERVAL_MS) || 1000,
    snapshotEvery: Math.max(1, Math.floor((Number(process.env.ONTOLOGY_SNAPSHOT_INTERVAL_MS) || 5000) / (Number(process.env.ONTOLOGY_PROJECT_INTERVAL_MS) || 1000))),
  });
  runner.start();
}

export async function stopOntologyProjector(): Promise<void> {
  await runner?.stop();
  runner = undefined;
}
```

Add the shared context singleton (H5 fix) as `packages/ontology/src/graph/graph-context.ts`:

```ts
import type { GraphStore } from './types';
import type { OntologyQueryService } from '../query/query-service';

interface PoolLike { query: (sql: string, params?: any[]) => Promise<{ rows: any[] }>; }

let store: GraphStore | null = null;
let queryService: OntologyQueryService | null = null;
let poolRef: PoolLike | null = null;

export function setGraphContext(nextStore: GraphStore, pool: PoolLike): void {
  store = nextStore;
  poolRef = pool;
  queryService = new OntologyQueryService(nextStore, pool);
}

export function getGraphStore(): GraphStore {
  if (!store) throw new Error('ontology graph is not initialized');
  return store;
}

export function getQueryService(): OntologyQueryService {
  if (!queryService) throw new Error('ontology query service is not initialized');
  return queryService;
}

export function getPool(): PoolLike {
  if (!poolRef) throw new Error('ontology pool is not initialized');
  return poolRef;
}
```

Update `packages/ontology/src/index.ts` to export the new surface:

```ts
export * from './graph/types';
export * from './graph/namespaces';
export * from './graph/memory-store';
export * from './graph/oxigraph-store';
export * from './graph/snapshot-repo';
export * from './graph/ontology-loader';
export * from './graph/graph-context';
export * from './projection/entity-mapper';
export * from './projection/projector';
export * from './projection/reconcile';
export * from './query/query-service';
export * from './query/sparql-guard';
export * from './reasoning/rule-engine';
export * from './reasoning/shacl';
export * from './reasoning/explain';
export * from './reasoning/impact';
export * from './reasoning/anomalies';
```

Keep legacy exports (`OwlStore`, `SemanticMapper`, `executeSparql`) until Task 7.4. API routes import `getGraphStore`/`getQueryService` from `@sse/ontology`, not from `ontology-v2.ts`.

Add `stopOntologyProjector` to the graceful shutdown in `packages/api/src/index.ts`.

- [ ] **Step 3: Run the test**

```bash
pnpm --filter @sse/api test -- ontology-projector
pnpm --filter @sse/api build
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/api/src/services/ontology-projector.ts packages/api/src/__tests__/ontology-projector.test.ts packages/api/src/index.ts
git commit -m "feat(api): run the ontology projector with graceful shutdown"
```

### Task 2.5: Full reconcile and backfill

**Files:**
- Create: `packages/ontology/src/projection/reconcile.ts`
- Create: `packages/api/src/routes/ontology-v2.ts`
- Test: `packages/ontology/src/__tests__/reconcile.test.ts`

**Context:** The rebuild must be deterministic. It is also the recovery path when the graph is corrupted or outbox history is lost.

- [ ] **Step 1: Write the failing test**

Use a fake pool that returns one row per table and assert the resulting graph has 8 entity subjects and the expected relations.

```ts
import { rebuildGraph } from '../projection/reconcile';
import { MemoryGraphStore } from '../graph/memory-store';

test('rebuild projects all tables deterministically', async () => {
  const pool = { query: async (sql: string) => {
    if (sql.includes('FROM users')) return { rows: [{ id: 'p1', name: 'A', department: 'D', role: 'employee', status: 'active' }] };
    if (sql.includes('FROM expense_categories')) return { rows: [{ id: 'c1', name: '差旅', is_active: true, sort_order: 1 }] };
    if (sql.includes('FROM expense_reports')) return { rows: [{ id: 'r1', serial_no: 'RE-1', user_id: 'p1', title: 't', total_amount: '10', status: 'pending', current_step: 1 }] };
    if (sql.includes('FROM expense_items')) return { rows: [{ id: 'i1', report_id: 'r1', category_id: 'c1', amount: '10', expense_date: '2026-11-10', description: 'x' }] };
    if (sql.includes('FROM invoices')) return { rows: [] };
    if (sql.includes('FROM approval_rules')) return { rows: [] };
    if (sql.includes('FROM approval_records')) return { rows: [] };
    if (sql.includes('FROM payment_receipts')) return { rows: [] };
    return { rows: [] };
  }};
  const store = new MemoryGraphStore();
  const result = await rebuildGraph(store, pool as any);
  expect(result.counts.subjects).toBeGreaterThanOrEqual(6);
  const res = await store.query('SELECT ?r WHERE { GRAPH <urn:sse:data> { ?r <https://sse.local/ontology#containsItem> ?i } }');
  expect(res.rows).toHaveLength(1);
});
```

- [ ] **Step 2: Implement `rebuildGraph`**

Algorithm:

1. Create a fresh `MemoryGraphStore` (or a second `OxigraphStore`) and load the TBox.
2. Query each table in FK order with keyset pagination (`WHERE id > $lastId ORDER BY id LIMIT 500`): users, expense_categories, expense_reports, expense_items, invoices, approval_rules, approval_records, payment_receipts.
3. For each batch, apply `projectRow(table, 'INSERT', row)` using `replaceEntity` + `addRelation` exactly like the projector. `remove` is empty for a fresh build.
4. After all tables, run `RuleEngine.materialize()`. Preserve existing tombstones: dump `urn:sse:history` from the live store and append it to the new graph. Then `store.dump([...])` and compute SHA-256.
5. `reconcile(liveStore, pool)` builds into a fresh store, then calls `liveStore.replaceAll(nquads)` so queries see either the old or the new graph, not a partially built one. Write a snapshot with `last_outbox_id = max(id)` from `ontology_outbox`, **and** `UPDATE ontology_projector_state SET last_outbox_id = GREATEST(last_outbox_id, max(id))` so the projector does not re-drain the whole outbox. Call `store.checkpoint(nquads)` and clear `needsRebuild()`.
6. Run reconcile as a background job: `POST /ontology/reconcile` returns `202 { job_id }`; `GET /ontology/reconcile/:job_id` returns `{ state: 'running'|'done'|'failed', counts, checksum, error }`. Keep job state in memory and log it; the rebuild is idempotent, so a restart can simply re-run it.

- [ ] **Step 3: Add the admin endpoint**

In `ontology-v2.ts`:

```ts
router.post('/reconcile', requireRole('admin'), asyncWrap(async (_req, res) => {
  const { startReconcileJob } = await import('@sse/ontology');
  const job = startReconcileJob();
  res.status(202).json({ job_id: job.id, state: job.state });
}));

router.get('/reconcile/:jobId', requireRole('admin'), asyncWrap(async (req, res) => {
  const { getReconcileJob } = await import('@sse/ontology');
  const job = getReconcileJob(req.params.jobId);
  if (!job) throw new AppError(404, 'NOT_FOUND', '任务不存在');
  res.json(job);
}));
```

- [ ] **Step 4: Run the test and verify**

```bash
pnpm --filter @sse/ontology test -- reconcile
pnpm --filter @sse/ontology build
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/ontology/src/projection/reconcile.ts packages/ontology/src/__tests__/reconcile.test.ts packages/api/src/routes/ontology-v2.ts
git commit -m "feat(ontology): add deterministic full reconcile and backfill"
```

### Task 2.6: Enable and verify equivalence

**Files:**
- No new code; run migration and smoke checks.

- [ ] **Step 1: Apply migrations and start the API with the flag**

```bash
$env:DATABASE_URL="postgres://sse:sse_dev@localhost:5433/sse"
pnpm --filter @sse/db migrate
$env:ONTOLOGY_V2="on"
pnpm --filter @sse/api dev
```

- [ ] **Step 2: Reconcile and check counts**

```bash
curl -s -X POST http://localhost:3000/ontology/reconcile -H "Authorization: Bearer $TOKEN"
# Poll until state is done
curl -s http://localhost:3000/ontology/reconcile/$JOB_ID -H "Authorization: Bearer $TOKEN"
curl -s http://localhost:3000/ontology/status -H "Authorization: Bearer $TOKEN"
```

Expected: `outbox_lag` near 0; `graph.subjects` matches the per-class SQL counts (including the extra Department subjects); `last_version` increases.

- [ ] **Step 3: Prove status equivalence**

Create a pending report, then approve it, then pay it. After each transition, query the graph:

```bash
curl -s -X POST http://localhost:3000/ontology/sparql -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"query":"SELECT ?status WHERE { <https://sse.local/report/RID> <https://sse.local/ontology#status> ?status }"}'
```

Expected: `pending`, then `approved`, then `paid` within `ONTOLOGY_PROJECT_INTERVAL_MS`.

- [ ] **Step 4: Commit any docs update**

```bash
git add docs/superpowers/plans/2026-11-10-ontology-platform-overhaul.md
git commit -m "docs(ontology): record equivalence verification steps"
```

---

## Phase 3: Semantic query API

**Goal:** Replace the toy SPARQL path with a real, safe query surface, and add typed cross-domain queries with data scope.

**Exit criteria:** Joins/FILTER/aggregation work; raw SPARQL is read-only with timeout/cap; typed queries enforce scope; OpenAPI is updated; legacy `/ontology/sparql` works via the new engine.

### Task 3.1: Typed query service

**Files:**
- Create: `packages/ontology/src/query/query-service.ts`
- Test: `packages/ontology/src/__tests__/query-service.test.ts`

**Context:** Most agents should not write SPARQL. Provide bounded, typed queries for the 80% cases.

- [ ] **Step 1: Write the failing test**

```ts
import { OntologyQueryService } from '../query/query-service';
import { MemoryGraphStore } from '../graph/memory-store';

const NQ = `
<https://sse.local/report/r1> a <https://sse.local/ontology#ExpenseReport> <urn:sse:data> .
<https://sse.local/report/r1> <https://sse.local/ontology#status> "pending" <urn:sse:data> .
<https://sse.local/report/r1> <https://sse.local/ontology#submittedBy> <https://sse.local/person/p1> <urn:sse:data> .
<https://sse.local/person/p1> <https://sse.local/ontology#belongsTo> <https://sse.local/dept/d1> <urn:sse:data> .
<https://sse.local/dept/d1> <https://sse.local/ontology#name> "研发" <urn:sse:data> .
`;

describe('OntologyQueryService', () => {
  it('filters reports by status and department', async () => {
    const store = new MemoryGraphStore();
    await store.load(NQ);
    const svc = new OntologyQueryService(store);
    const res = await svc.searchReports({ status: 'pending', department: '研发', scope: { kind: 'all' } });
    expect(res.results.map(r => r.id)).toEqual(['https://sse.local/report/r1']);
  });

  it('groups spend by category', async () => {
    const store = new MemoryGraphStore();
    await store.load(`
<https://sse.local/item/i1> a <https://sse.local/ontology#ExpenseItem> <urn:sse:data> .
<https://sse.local/item/i1> <https://sse.local/ontology#amount> "10.5"^^<http://www.w3.org/2001/XMLSchema#decimal> <urn:sse:data> .
<https://sse.local/item/i1> <https://sse.local/ontology#hasCategory> <https://sse.local/category/c1> <urn:sse:data> .
<https://sse.local/category/c1> <https://sse.local/ontology#name> "差旅" <urn:sse:data> .
`);
    const svc = new OntologyQueryService(store);
    const res = await svc.spendByCategory({ from: '2026-01-01', to: '2026-12-31', scope: { kind: 'all' } });
    expect(res).toEqual([{ category: '差旅', total: 10.5, count: 1 }]);
  });
});
```

- [ ] **Step 2: Implement the service**

```ts
export type Scope =
  | { kind: 'all' }
  | { kind: 'department'; department: string }
  | { kind: 'self'; userId: string }
  | { kind: 'deny' };

export interface OntologyQueryService {
  /** Generic typed listing used by query_ontology and /ontology/entities. */
  listEntities(input: { type?: string; status?: string; department?: string; q?: string; page?: number; pageSize?: number; scope: Scope }): Promise<{ results: Array<{ uri: string; type: string; properties: Record<string, string> }>; total: number }>;
  searchReports(input: { status?: string; department?: string; q?: string; page?: number; pageSize?: number; scope: Scope }): Promise<{ results: any[]; total: number }>;
  getEntity(uri: string, scope: Scope): Promise<any | null>;
  network(uri: string, opts: { depth: number; direction?: 'both' | 'out' | 'in'; scope: Scope }): Promise<{ nodes: any[]; edges: any[] }>;
  spendByCategory(input: { from: string; to: string; department?: string; scope: Scope }): Promise<Array<{ category: string; total: number; count: number }>>;
  schema(): Promise<{ classes: string[]; properties: string[] }>;
  status(): Promise<{ version: number; counts: GraphCounts; lagSeconds: number }>;
}

export class OntologyQueryService {
  constructor(private store: GraphStore, private pool?: { query: (sql: string, params?: any[]) => Promise<{ rows: any[] }> }) {}
  // implement the interface methods here
}
```

The `pool` is optional so unit tests can construct the service with only a store. `status()` uses the pool when present for `outboxPending`/`lastError`; otherwise returns graph-only counts.

Implement with SPARQL 1.1. Build the scope filter as SPARQL fragments:

```ts
function scopeFilter(scope: Scope): string {
  if (scope.kind === 'all') return '';
  if (scope.kind === 'deny') return 'FILTER(false)';
  if (scope.kind === 'self') return `?report <${sse('submittedBy')}> <${uri.person(scope.userId)}> .`;
  return `?report <${sse('submittedBy')}> ?person . ?person <${sse('belongsTo')}> ?dept . ?dept <${sse('name')}> ${sparqlString(scope.department)} .`;
}
```

Use `sparqlString` from `sparql-term.ts`:

```ts
export function sparqlString(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\t/g, '\\t')}"`;
}
export function sparqlIri(value: string): string {
  if (!/^https:\/\/sse\.local\/[A-Za-z0-9._~:/?#@!$&'()*+,;=%-]+$/.test(value)) throw new Error('invalid SSE IRI');
  return `<${value}>`;
}
```

Never interpolate raw user input without these helpers.

- [ ] **Step 3: Run the tests**

```bash
pnpm --filter @sse/ontology test -- query-service
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/ontology/src/query packages/ontology/src/__tests__/query-service.test.ts
git commit -m "feat(ontology): add typed cross-domain query service with scope"
```

### Task 3.2: SPARQL guard and worker-backed endpoint

**Files:**
- Create: `packages/ontology/src/query/sparql-guard.ts`
- Modify: `packages/api/src/routes/ontology.ts` (legacy `/sparql`)
- Test: `packages/ontology/src/__tests__/sparql-guard.test.ts`

**Context:** Raw SPARQL is powerful; it must be read-only and bounded.

- [ ] **Step 1: Write the failing test**

```ts
import { assertReadOnlySparql } from '../query/sparql-guard';

describe('assertReadOnlySparql', () => {
  it.each([
    'SELECT ?s WHERE { ?s ?p ?o }',
    'ASK { ?s ?p ?o }',
    'CONSTRUCT { ?s ?p ?o } WHERE { ?s ?p ?o }',
  ])('accepts read query: %s', (q) => expect(() => assertReadOnlySparql(q)).not.toThrow());

  it.each([
    'INSERT DATA { <a> <b> <c> }',
    'DELETE WHERE { ?s ?p ?o }',
    'LOAD <http://evil>',
    'SELECT * WHERE { SERVICE <http://evil> { ?s ?p ?o } }',
  ])('rejects write/remote query: %s', (q) => expect(() => assertReadOnlySparql(q)).toThrow());
});
```

- [ ] **Step 2: Implement with `sparqljs`**

```ts
import { Parser } from 'sparqljs';

const parser = new Parser();

function walk(node: unknown, visit: (n: any) => void): void {
  if (!node || typeof node !== 'object') return;
  visit(node as any);
  for (const value of Object.values(node as any)) {
    if (Array.isArray(value)) value.forEach(v => walk(v, visit));
    else walk(value, visit);
  }
}

export function assertReadOnlySparql(query: string): void {
  const ast: any = parser.parse(query);
  if (ast.type !== 'query') throw new Error('only read queries are allowed');
  if (!['SELECT', 'ASK', 'CONSTRUCT', 'DESCRIBE'].includes(ast.queryType)) throw new Error('unsupported query type');
  walk(ast, (node) => {
    if (node.type === 'service') throw new Error('SERVICE is not allowed');
    if (node.type === 'load') throw new Error('LOAD is not allowed');
  });
}
```

Also enforce, for SELECT only, and clamp an existing LIMIT:

```ts
export function capResults(query: string, max = 1000): string {
  const select = query.match(/\bLIMIT\s+(\d+)/i);
  if (select) {
    const current = parseInt(select[1], 10);
    if (current <= max) return query;
    return query.replace(/\bLIMIT\s+\d+/i, `LIMIT ${max}`);
  }
  if (/^\s*SELECT\b/i.test(query)) return `${query}\nLIMIT ${max}`;
  return query;
}
```

- [ ] **Step 3: Wire `/ontology/sparql` to the worker store**

In `packages/api/src/routes/ontology.ts`:

```ts
router.post('/sparql', asyncWrap(async (req, res) => {
  assertOntologyManager(req.user!.role);
  const { query } = req.body;
  if (!query) throw new AppError(400, 'INVALID_PARAMS', '请提供 query');

  // D8/H6: keep the legacy endpoint working when the v2 flag is off.
  if (process.env.ONTOLOGY_V2 !== 'on' && process.env.ONTOLOGY_V2 !== 'shadow') {
    const { executeSparql } = await import('@sse/ontology');
    const results = executeSparql(getEngine().store.getStore(), query);
    res.json({ results, count: results.length });
    return;
  }

  assertReadOnlySparql(query);
  const { getGraphStore } = await import('@sse/ontology');
  const store = getGraphStore();
  const result = await store.query(capResults(query, Number(process.env.ONTOLOGY_SPARQL_MAX_RESULTS) || 1000), {
    timeoutMs: Number(process.env.ONTOLOGY_SPARQL_TIMEOUT_MS) || 1500,
  });
  res.json({ results: result.kind === 'select' ? result.rows : result, count: result.kind === 'select' ? result.rows.length : undefined });
}));
```

- [ ] **Step 4: Run the tests and build**

```bash
pnpm --filter @sse/ontology test -- sparql-guard
pnpm --filter @sse/api build
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/ontology/src/query/sparql-guard.ts packages/ontology/src/__tests__/sparql-guard.test.ts packages/api/src/routes/ontology.ts
git commit -m "feat(ontology): guard and run real SPARQL with timeout"
```

### Task 3.3: New REST surface

**Files:**
- Modify: `packages/api/src/routes/ontology-v2.ts`
- Modify: `packages/api/src/openapi.ts`
- Test: `packages/api/src/__tests__/openapi.test.ts` (extend)

**Context:** Stable contracts for MCP and Web.

- [ ] **Step 1: Implement endpoints**

```ts
import { authMiddleware } from '@sse/auth';
import { requireRole } from '../middleware/rbac';
import { getQueryService } from '@sse/ontology';

router.use(authMiddleware);

router.get('/status', async (req, res) => {
  const svc = getQueryService();
  res.json(await svc.status());
});

router.get('/schema', async (_req, res) => {
  res.json(await getQueryService().schema());
});

router.get('/entities', async (req, res) => {
  const scope = toScope(req.user!);
  const type = req.query.type as string | undefined;
  const result = await getQueryService().listEntities({
    type,
    status: req.query.status as string | undefined,
    department: req.query.department as string | undefined,
    q: req.query.q as string | undefined,
    page: Number(req.query.page) || 1,
    pageSize: Math.min(100, Number(req.query.page_size) || 20),
    scope,
  });
  // Legacy /ontology/query?type= contract: [{ uri, properties }].
  if (type) {
    res.json(result.results.map(r => ({ uri: r.uri, properties: r.properties })));
    return;
  }
  res.json(result);
});

router.get('/entities/:uri(*)', async (req, res) => {
  const entity = await getQueryService().getEntity(req.params.uri, toScope(req.user!));
  if (!entity) throw new AppError(404, 'NOT_FOUND', '实体不存在或无权访问');
  res.json(entity);
});

router.get('/entities/:uri(*)/network', async (req, res) => {
  res.json(await getQueryService().network(req.params.uri, {
    depth: Math.min(5, Number(req.query.depth) || 2),
    direction: (req.query.direction as any) || 'both',
    scope: toScope(req.user!),
  }));
});

router.post('/query', async (req, res) => {
  const scope = toScope(req.user!);
  if (req.body.type) {
    res.json(await getQueryService().listEntities({ ...req.body, scope }));
    return;
  }
  res.json(await getQueryService().searchReports({ ...req.body, scope }));
});

router.post('/validate', async (req, res) => {
  res.json(await validateExpense(req.body, toScope(req.user!)));
});

router.post('/explain', async (req, res) => {
  res.json(await explainReport(req.body.report_id, toScope(req.user!)));
});

router.post('/impact', async (req, res) => {
  res.json(await impactAnalysis(req.body, toScope(req.user!)));
});

router.get('/anomalies', async (req, res) => {
  res.json(await findAnomalies({ codes: req.query.codes, limit: Number(req.query.limit) || 50 }, toScope(req.user!)));
});
```

`toScope` reuses `resolveDataScope` from `@sse/auth`.

- [ ] **Step 2: Extend OpenAPI**

Add every path above to `packages/api/src/openapi.ts` with bearer security, request/response schemas, and enums. Update `packages/api/src/__tests__/openapi.test.ts` to assert the new paths exist.

- [ ] **Step 3: Verify**

```bash
pnpm --filter @sse/api test -- openapi
pnpm --filter @sse/api build
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/api/src/routes/ontology-v2.ts packages/api/src/openapi.ts packages/api/src/__tests__/openapi.test.ts
git commit -m "feat(api): expose typed ontology query and analysis endpoints"
```

---

## Phase 4: Rules, constraints, explainability

**Goal:** Rules and constraints live in the graph; validation and explanations are deterministic and evidence-backed.

**Exit criteria:** CONSTRUCT rules materialize; SHACL catches the seeded invalid fixtures; explain returns a full evidence chain; anomalies find all seeded defects; `validate_expense` no longer depends on ad-hoc SQL only.

### Task 4.1: Rules v2 schema and CONSTRUCT engine

**Files:**
- Create: `packages/db/src/migrations/017_ontology_rules_v2.sql`
- Create: `packages/ontology/src/reasoning/rule-engine.ts`
- Test: `packages/ontology/src/__tests__/rule-engine.test.ts`

- [ ] **Step 1: Write the migration**

```sql
ALTER TABLE reasoning_rules ADD COLUMN IF NOT EXISTS construct_query TEXT;
ALTER TABLE reasoning_rules ADD COLUMN IF NOT EXISTS severity TEXT NOT NULL DEFAULT 'info';
ALTER TABLE reasoning_rules ADD COLUMN IF NOT EXISTS message TEXT;

INSERT INTO reasoning_rules (name, description, conditions, conclusion, priority, is_active, construct_query, severity, message)
VALUES
('legacy-status-draft',
 'Infer legacy DraftReport class from status',
 '{}'::jsonb, '{}'::jsonb, 10, true,
 'CONSTRUCT { ?r a <https://sse.local/ontology#DraftReport> } WHERE { GRAPH <urn:sse:data> { ?r a <https://sse.local/ontology#ExpenseReport> ; <https://sse.local/ontology#status> "draft" } }',
 'info', 'draft report'),
('legacy-status-pending',
 'Infer legacy PendingReport class from status',
 '{}'::jsonb, '{}'::jsonb, 20, true,
 'CONSTRUCT { ?r a <https://sse.local/ontology#PendingReport> } WHERE { GRAPH <urn:sse:data> { ?r a <https://sse.local/ontology#ExpenseReport> ; <https://sse.local/ontology#status> "pending" } }',
 'info', 'pending report'),
('legacy-status-approved',
 'Infer legacy ApprovedReport class from status',
 '{}'::jsonb, '{}'::jsonb, 30, true,
 'CONSTRUCT { ?r a <https://sse.local/ontology#ApprovedReport> } WHERE { GRAPH <urn:sse:data> { ?r a <https://sse.local/ontology#ExpenseReport> ; <https://sse.local/ontology#status> "approved" } }',
 'info', 'approved report'),
('legacy-status-rejected',
 'Infer legacy RejectedReport class from status',
 '{}'::jsonb, '{}'::jsonb, 40, true,
 'CONSTRUCT { ?r a <https://sse.local/ontology#RejectedReport> } WHERE { GRAPH <urn:sse:data> { ?r a <https://sse.local/ontology#ExpenseReport> ; <https://sse.local/ontology#status> "rejected" } }',
 'info', 'rejected report'),
('legacy-status-paid',
 'Infer legacy PaidReport class from status',
 '{}'::jsonb, '{}'::jsonb, 50, true,
 'CONSTRUCT { ?r a <https://sse.local/ontology#PaidReport> } WHERE { GRAPH <urn:sse:data> { ?r a <https://sse.local/ontology#ExpenseReport> ; <https://sse.local/ontology#status> "paid" } }',
 'info', 'paid report')
ON CONFLICT DO NOTHING;
```

Do **not** seed a `governedBy` CONSTRUCT rule yet: amount/category matching has precedence rules that are easy to get wrong in SPARQL. `validateExpense` and `explainReport` compute the matched rule with the shared TypeScript `matchRule` function; you may add a CONSTRUCT cross-check later once the fixture tests cover it.

- [ ] **Step 2: Write the failing test**

```ts
import { RuleEngine } from '../reasoning/rule-engine';
import { MemoryGraphStore } from '../graph/memory-store';

test('materializes legacy status classes idempotently', async () => {
  const store = new MemoryGraphStore();
  await store.load(`
<https://sse.local/report/r1> a <https://sse.local/ontology#ExpenseReport> <urn:sse:data> .
<https://sse.local/report/r1> <https://sse.local/ontology#status> "pending" <urn:sse:data> .
`);
  const pool = { query: async () => ({ rows: [{ id: 'rule1', construct_query: 'CONSTRUCT { ?r a <https://sse.local/ontology#PendingReport> } WHERE { GRAPH <urn:sse:data> { ?r a <https://sse.local/ontology#ExpenseReport> ; <https://sse.local/ontology#status> "pending" } }', is_active: true, priority: 1 }] }) };
  const engine = new RuleEngine(store, pool as any);
  await engine.materialize();
  await engine.materialize();
  const res = await store.query('SELECT ?r WHERE { GRAPH <urn:sse:inferred> { ?r a <https://sse.local/ontology#PendingReport> } }');
  expect(res.rows).toHaveLength(1);
});
```

- [ ] **Step 3: Implement `RuleEngine.materialize`**

```ts
export class RuleEngine {
  constructor(private store: GraphStore, private pool: PoolLike) {}

  async materialize(): Promise<number> {
    const { rows } = await this.pool.query(
      `SELECT id, construct_query FROM reasoning_rules WHERE is_active = true AND construct_query IS NOT NULL ORDER BY priority`,
    );
    await this.store.update('CLEAR GRAPH <urn:sse:inferred>');
    let total = 0;
    for (const rule of rows) {
      const res = await this.store.query(rule.construct_query);
      if (res.kind !== 'construct') continue;
      const triples = res.quads.map(q => `<${q.subject}> <${q.predicate}> ${q.objectType === 'iri' ? `<${q.object}>` : JSON.stringify(q.object)} .`).join('\n');
      if (triples) {
        await this.store.update(`INSERT DATA { GRAPH <urn:sse:inferred> { ${triples} } }`);
        total += res.quads.length;
      }
    }
    return total;
  }
}
```

Use a proper N-Triples serializer for datatypes/languages; do not lose `xsd:decimal` or escaped strings. Add a test for a decimal literal round-trip.

- [ ] **Step 4: Verify**

```bash
pnpm --filter @sse/ontology test -- rule-engine
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/db/src/migrations/017_ontology_rules_v2.sql packages/ontology/src/reasoning/rule-engine.ts packages/ontology/src/__tests__/rule-engine.test.ts
git commit -m "feat(ontology): materialize CONSTRUCT rules into the inferred graph"
```

### Task 4.2: SHACL constraints

**Files:**
- Create: `packages/ontology/src/graph/ontology/shapes.ttl`
- Create: `packages/ontology/src/reasoning/shacl.ts`
- Test: `packages/ontology/src/__tests__/shacl.test.ts`

- [ ] **Step 1: Write shapes**

```turtle
@prefix sh: <http://www.w3.org/ns/shacl#> .
@prefix sse: <https://sse.local/ontology#> .
@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .

sse:ExpenseReportShape a sh:NodeShape ;
  sh:targetClass sse:ExpenseReport ;
  sh:property [
    sh:path sse:submittedBy ; sh:minCount 1 ; sh:maxCount 1 ;
    sh:message "报销单必须有且仅有一个提交人" ;
  ] ;
  sh:property [
    sh:path sse:status ; sh:minCount 1 ;
    sh:in ( "draft" "pending" "approved" "rejected" "paid" ) ;
  ] .

sse:PaidReportShape a sh:NodeShape ;
  sh:targetClass sse:PaidReport ;
  sh:property [ sh:path sse:paidAt ; sh:minCount 1 ; sh:message "已打款单据必须有打款时间" ] ;
  sh:property [ sh:path sse:paidBy ; sh:minCount 1 ; sh:message "已打款单据必须有打款人" ] .

sse:InvoiceShape a sh:NodeShape ;
  sh:targetClass sse:Invoice ;
  sh:property [ sh:path sse:invoiceNo ; sh:minCount 1 ; sh:message "发票必须有发票号" ] .
```

- [ ] **Step 2: Implement the validator**

```ts
import { Parser } from 'n3';
import rdfDataset from '@rdfjs/dataset';
import { Validator } from 'rdf-validate-shacl';
import { DataFactory } from 'n3';
import type { GraphStore } from '../graph/types';

const SH = 'http://www.w3.org/ns/shacl#';
const { namedNode } = DataFactory;

/**
 * rdf-validate-shacl versions differ in whether `report.results` exposes
 * structured fields or RDF terms. Read the report graph explicitly so the
 * extractor is stable across versions (M1 fix).
 */
export async function validateGraph(store: GraphStore, shapesTtl: string) {
  const dataNq = await store.dump(['urn:sse:tbox', 'urn:sse:data', 'urn:sse:inferred', 'urn:sse:manual']);
  const data = rdfDataset.dataset();
  for (const q of new Parser({ format: 'application/n-quads' }).parse(dataNq)) data.add(q as any);
  const shapes = rdfDataset.dataset();
  for (const q of new Parser().parse(shapesTtl)) shapes.add(q as any);

  const report = await new Validator(shapes as any).validate(data as any);
  const reportDataset: any = (report as any).dataset;
  if (!reportDataset) throw new Error('SHACL report has no dataset; pin rdf-validate-shacl to 0.6.x');
  const resultNodes = reportDataset.match(null, namedNode(`${SH}focusNode`), null);
  return resultNodes.map((focusQuad: any) => {
    const resultNode = focusQuad.subject;
    const message = reportDataset.match(resultNode, namedNode(`${SH}resultMessage`), null).map((q: any) => q.object.value).join('; ');
    const path = reportDataset.match(resultNode, namedNode(`${SH}resultPath`), null)[0]?.object?.value;
    const severity = reportDataset.match(resultNode, namedNode(`${SH}resultSeverity`), null)[0]?.object?.value;
    return { focusNode: focusQuad.object.value, path, message, severity };
  });
}
```

- [ ] **Step 3: Write valid/invalid fixture tests**

Valid report: pending + submittedBy. Invalid: pending without submittedBy; paid without paidAt; duplicate invoiceNo (add a custom SPARQL constraint or check in `anomalies.ts`).

- [ ] **Step 4: Verify**

```bash
pnpm --filter @sse/ontology test -- shacl
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/ontology/src/graph/ontology/shapes.ttl packages/ontology/src/reasoning/shacl.ts packages/ontology/src/__tests__/shacl.test.ts
git commit -m "feat(ontology): add SHACL constraints and validator"
```

### Task 4.3: Explain, validate, impact, anomalies

**Files:**
- Create: `packages/ontology/src/reasoning/explain.ts`
- Create: `packages/ontology/src/reasoning/impact.ts`
- Create: `packages/ontology/src/reasoning/anomalies.ts`
- Test: `packages/ontology/src/__tests__/reasoning-services.test.ts`

**Context:** These are the user-facing payoff. Every output must include evidence URIs.

- [ ] **Step 1: Write failing tests for a seeded report chain**

Seed a graph with person, department, report, item, invoice, approval, payment, rule. Assert:

- `explainReport` returns ordered timeline entries and a `why` list containing the matched rule name and invoice verification status.
- `validateExpense` returns `valid: false` when no active approver exists for the matched rule role.
- `impactAnalysis` returns the affected report when the rule amount range changes.
- `findAnomalies` returns `duplicate_invoice_no` for two invoices with the same number.

- [ ] **Step 2: Implement explain**

Query template:

```sparql
SELECT ?p ?o WHERE { GRAPH <urn:sse:data> { <REPORT> ?p ?o } }
```

Then fetch each linked entity by following `submittedBy`, `containsItem`, `hasInvoice`, `hasApproval`, `approvedBy`, `hasPaymentReceipt`. For the matched rule, **do not rely on `governedBy` alone**: call the same `matchRule(reportAmount, categoryIds, rules)` function used by `validateExpense` and use `governedBy` only as a cross-check if a CONSTRUCT rule emitted it. This guarantees A4 explainability even before a `governedBy` rule exists (N3 fix). Build:

```ts
export interface Explanation {
  report: string;
  timeline: Array<{ at: string; event: string; actor?: string; evidence: string }>;
  why: Array<{ code: string; message: string; evidence: string[] }>;
  evidenceUris: string[];
}
```

- [ ] **Step 3: Implement validate**

Algorithm:

1. Resolve category by id or name.
2. Find matching active rules: `minAmount <= amount < maxAmount` and category in `category_ids` (or empty).
3. For each rule, parse `approval_chain` JSON and check that at least one active user exists for each required role (query `Person` with `role` and `status = active`).
4. Validate invoice status for all invoices on matching reports (optional input `report_id`).
5. Return `{ valid, matched_rule, issues: [{ code, message, evidence }], suggestions }`.

Keep the DB fallback: if the graph has no rules (empty), call the existing SQL implementation and mark `source: 'db-fallback'`.

- [ ] **Step 4: Implement impact**

Inputs: `{ rule_id?, category_id?, department?, min_amount?, max_amount?, amount_delta? }`.

Return:

```ts
{
  affected_reports: Array<{ uri: string; serialNo: string; amount: number; status: string; reason: string }>;
  affected_people: Array<{ uri: string; name: string; department: string }>;
  counts: { reports: number; people: number; pending: number };
  hypothetical: boolean;
}
```

For a hypothetical rule change, do not write; evaluate the new thresholds against current report/category data in SPARQL.

- [ ] **Step 5: Implement anomalies**

v1 ships the three highest-value checks (each returns `{ code, severity, message, entities, evidence }`):

| Code | SPARQL idea |
|---|---|
| `amount_mismatch` | report amount != SUM(item amount) |
| `duplicate_invoice_no` | invoiceNo shared by >1 invoice |
| `missing_approver` | pending report's rule role has no active Person |

Deferred to Phase 4b (do not block v1): `paid_without_receipt`, `paid_missing_fields`, `stuck_pending`, `rejected_without_comment`, `invoice_verification_failed`, `orphan_approval`. They are easy to add as more rows in the same check registry, but each needs its own fixture and operator decision. This is the L4 cut.

- [ ] **Step 6: Wire endpoints**

`POST /ontology/explain`, `POST /ontology/validate`, `POST /ontology/impact`, `GET /ontology/anomalies`. Return the evidence URIs.

- [ ] **Step 7: Verify**

```bash
pnpm --filter @sse/ontology test -- reasoning-services
pnpm --filter @sse/api build
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/ontology/src/reasoning packages/ontology/src/__tests__/reasoning-services.test.ts packages/api/src/routes/ontology-v2.ts
git commit -m "feat(ontology): add explain, validate, impact and anomaly services"
```

### Task 4.4: Scheduled anomaly scan

**Files:**
- Modify: `packages/api/src/index.ts` or the existing scheduler.
- Test: `packages/api/src/__tests__/anomaly-scheduler.test.ts`

- [ ] **Step 1: Implement a fixed interval**

Do not add a cron parser. Use one explicit interval (default 24h), which is enough for anomaly scanning:

```ts
const ANOMALY_INTERVAL_MS = Number(process.env.ONTOLOGY_ANOMALY_INTERVAL_MS) || 86_400_000;
if (ANOMALY_INTERVAL_MS > 0) {
  setInterval(() => {
    findAnomalies({ limit: 500 }, { kind: 'all' })
      .then(r => console.error(`[ontology] anomalies: ${r.summary.total}`))
      .catch(e => console.error(`[ontology] anomaly scan failed: ${e.message}`));
  }, ANOMALY_INTERVAL_MS).unref();
}
```

- [ ] **Step 2: Test and commit**

```bash
pnpm --filter @sse/api test -- anomaly-scheduler
git add packages/api/src packages/api/src/__tests__
git commit -m "feat(api): schedule ontology anomaly scans"
```

---

## Phase 5: MCP overhaul

**Goal:** MCP becomes a thin client for the graph API, gains analysis tools, and keeps its auth/rate-limit/audit guarantees.

**Exit criteria:** 22 tools registered (18 existing + 4 new); existing tool names unchanged; all ontology tools call the API; MCP tests cover success, auth failure, timeout, and scope; docs updated.

### Task 5.1: Ontology API client

**Files:**
- Create: `packages/mcp/src/tools/ontology-client.ts`
- Test: `packages/mcp/src/__tests__/ontology-client.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { ontologyClient } from '../tools/ontology-client';

test('sends signed auth and maps errors', async () => {
  const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue(new Response(JSON.stringify({ error: { code: 'FORBIDDEN', message: 'nope' } }), { status: 403 }));
  const auth = { userId: 'u1', role: 'employee', department: 'D', apiKey: 'k' } as any;
  const res = await ontologyClient(auth).getStatus();
  expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('/ontology/status'), expect.objectContaining({ headers: expect.objectContaining({ Authorization: expect.stringContaining('Bearer ') }) }));
  expect(res.ok).toBe(false);
  expect(res.status).toBe(403);
  fetchMock.mockRestore();
});
```

- [ ] **Step 2: Implement**

```ts
import { apiJson, API_BASE, authHeaders } from './api-client.js';
import type { AuthContext } from '../auth.js';

export function ontologyClient(auth: AuthContext) {
  const call = (method: string, path: string, body?: unknown) => apiJson(auth, method, path, body);
  return {
    getStatus: () => call('GET', '/ontology/status'),
    getSchema: () => call('GET', '/ontology/schema'),
    search: (input: Record<string, unknown>) => call('POST', '/ontology/query', input),
    getEntity: (uri: string) => call('GET', `/ontology/entities/${encodeURIComponent(uri)}`),
    network: (uri: string, depth: number, direction = 'both') =>
      call('GET', `/ontology/entities/${encodeURIComponent(uri)}/network?depth=${depth}&direction=${direction}`),
    sparql: (query: string) => call('POST', '/ontology/sparql', { query }),
    validate: (input: Record<string, unknown>) => call('POST', '/ontology/validate', input),
    explain: (reportId: string) => call('POST', '/ontology/explain', { report_id: reportId }),
    impact: (input: Record<string, unknown>) => call('POST', '/ontology/impact', input),
    anomalies: (input: Record<string, unknown>) => call('GET', `/ontology/anomalies?${new URLSearchParams(input as any)}`),
  };
}
```

- [ ] **Step 3: Run and commit**

```bash
pnpm --filter @sse/mcp test -- ontology-client
git add packages/mcp/src/tools/ontology-client.ts packages/mcp/src/__tests__/ontology-client.test.ts
git commit -m "feat(mcp): add ontology API client"
```

### Task 5.2: Rewrite existing ontology tools as thin clients

**Files:**
- Modify: `packages/mcp/src/tools/query-ontology.ts`
- Modify: `packages/mcp/src/tools/get-entity-network.ts`
- Modify: `packages/mcp/src/tools/query-sparql.ts`
- Modify: `packages/mcp/src/tools/validate-expense.ts`
- Test: `packages/mcp/src/__tests__/ontology-tools.test.ts`

- [ ] **Step 1: Keep tool names and input schemas backward compatible**

- `query_ontology`: keep `{ type? }`; add optional `{ status?, department?, q?, page?, page_size? }`. If only `type` is provided, call `GET /ontology/entities?type=...` semantics via `/ontology/query` with `type`.
- `get_entity_network`: keep `{ entity_id, depth? }`; add `direction?`.
- `query_sparql`: keep `{ query }`.
- `validate_expense`: keep `{ amount, category_id?, category_name? }`; call `/ontology/validate`; on `404/501`, fall back to the existing DB code.

- [ ] **Step 2: Remove direct `ensureOntologyLoaded` imports from these four tools**

Keep `get-engine.ts` for `submit-expense-from-text` and `submit-expense-from-invoice` only.

- [ ] **Step 3: Add tests**

Mock `global.fetch`; assert each tool returns the API payload and maps HTTP errors to `errorResult`.

- [ ] **Step 4: Verify and commit**

```bash
pnpm --filter @sse/mcp test
pnpm --filter @sse/mcp build
git add packages/mcp/src/tools packages/mcp/src/__tests__
git commit -m "refactor(mcp): delegate ontology reads to the API"
```

### Task 5.3: Add analysis tools

**Files:**
- Create: `packages/mcp/src/tools/explain-expense.ts`
- Create: `packages/mcp/src/tools/impact-analysis.ts`
- Create: `packages/mcp/src/tools/find-anomalies.ts`
- Create: `packages/mcp/src/tools/get-ontology-schema.ts`
- Test: `packages/mcp/src/__tests__/analysis-tools.test.ts`

- [ ] **Step 1: Define schemas**

```ts
// explain_expense
{ report_id: string } // required

// impact_analysis
{ rule_id?: string; category_id?: string; department?: string; min_amount?: number; max_amount?: number; amount_delta?: number }

// find_anomalies
{ codes?: string[]; limit?: number }

// get_ontology_schema
{}
```

- [ ] **Step 2: Implement handlers as one-line client calls + `successResult`**

Each handler must:
1. `resolveAuthContext(args)`; return `UNAUTHORIZED` if missing.
2. Call the client.
3. On `!ok`, return `errorResult(data.error.code, data.error.message)`.
4. Return `successResult(data)`.

- [ ] **Step 3: Register in `server.ts`**

Add imports and entries to `allTools`. Keep the existing order stable; append new tools at the end.

- [ ] **Step 4: Test and commit**

```bash
pnpm --filter @sse/mcp test
pnpm --filter @sse/mcp build
git add packages/mcp/src/tools packages/mcp/src/server.ts
git commit -m "feat(mcp): add explain, impact, anomaly and schema tools"
```

### Task 5.4: Server-level timeout and audit enrichment

**Files:**
- Modify: `packages/mcp/src/server.ts`
- Test: `packages/mcp/src/__tests__/server.test.ts`

- [ ] **Step 1: Add a per-tool timeout wrapper**

```ts
const TOOL_TIMEOUT_MS = Number(process.env.MCP_TOOL_TIMEOUT_MS) || 10_000;

function withTimeout<T>(p: Promise<T>, tool: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`tool ${tool} timed out`)), TOOL_TIMEOUT_MS)),
  ]);
}
```

Apply in the `CallToolRequestSchema` handler, and audit `timed_out: true` on failure.

- [ ] **Step 2: Enrich audit events**

Add `tool`, `user_id`, `role`, `duration_ms`, `ok`, `error_code`, `result_count`. Never log arguments that may contain secrets or invoice bytes.

- [ ] **Step 3: Test and commit**

```bash
pnpm --filter @sse/mcp test -- server
git add packages/mcp/src/server.ts packages/mcp/src/__tests__/server.test.ts
git commit -m "feat(mcp): add tool timeouts and richer audit events"
```

### Task 5.5: Docs and regression scripts

**Files:**
- Modify: `docs/2026-07-29-mcp-test-cases.md`
- Modify: `docs/2026-07-31-mcp-pi-test-cases.md`
- Modify: `test/mcp-regression.sh`
- Modify: `.pi/extensions/sse-mcp.ts` if it enumerates tools

- [ ] **Step 1: Update tool counts and examples**

18 -> 22 tools. Add examples for `explain_expense`, `impact_analysis`, `find_anomalies`, `get_ontology_schema`. Document that ontology tools require the API to be running and `ONTOLOGY_V2=on`.

- [ ] **Step 2: Add regression calls**

In `test/mcp-regression.sh`, add:

```bash
call_tool query_sparql '{"query":"SELECT ?s WHERE { GRAPH <urn:sse:data> { ?s ?p ?o } } LIMIT 1"}'
call_tool get_ontology_schema '{}'
call_tool find_anomalies '{"limit":5}'
```

- [ ] **Step 3: Verify and commit**

```bash
bash test/mcp-regression.sh
git add docs test/mcp-regression.sh .pi/extensions/sse-mcp.ts
git commit -m "docs(mcp): document ontology analysis tools and regressions"
```

---

## Phase 6: Web workbench

**Goal:** Operators can explore, validate, explain, and monitor the graph without writing SPARQL.

**Exit criteria:** `/ontology` shows explorer + detail + evidence; validation/impact/anomaly panels work; sync health is visible; `pnpm --filter @sse/web build` and `test` pass.

### Task 6.1: Typed Web API client

**Files:**
- Create: `packages/web/src/api/ontology.ts`
- Test: `packages/web/src/api/__tests__/ontology.test.ts` (Vitest)

- [ ] **Step 1: Implement the client**

Use the existing `packages/web/src/api` axios instance. Export:

```ts
export interface OntologyStatus { version: number; counts: { quads: number; subjects: number }; lagSeconds: number; outboxPending: number; }
export interface EntitySummary { uri: string; type: string; label: string; properties: Record<string, string>; }
export interface Evidence { code: string; message: string; evidence: string[]; }

export const ontologyApi = {
  status: () => http.get<OntologyStatus>('/ontology/status'),
  schema: () => http.get('/ontology/schema'),
  entities: (params: Record<string, unknown>) => http.get('/ontology/entities', { params }),
  entity: (uri: string) => http.get(`/ontology/entities/${encodeURIComponent(uri)}`),
  network: (uri: string, depth: number, direction: string) => http.get(`/ontology/entities/${encodeURIComponent(uri)}/network`, { params: { depth, direction } }),
  query: (body: unknown) => http.post('/ontology/query', body),
  validate: (body: unknown) => http.post('/ontology/validate', body),
  explain: (reportId: string) => http.post('/ontology/explain', { report_id: reportId }),
  impact: (body: unknown) => http.post('/ontology/impact', body),
  anomalies: (params: Record<string, unknown>) => http.get('/ontology/anomalies', { params }),
  sparql: (query: string) => http.post('/ontology/sparql', { query }),
};
```

- [ ] **Step 2: Test URL/params mapping with a mocked axios**

- [ ] **Step 3: Commit**

```bash
pnpm --filter @sse/web test -- ontology
git add packages/web/src/api packages/web/src/api/__tests__
git commit -m "feat(web): add typed ontology API client"
```

### Task 6.2: Explorer and entity detail

**Files:**
- Create: `packages/web/src/components/ontology/GraphExplorer.vue`
- Create: `packages/web/src/components/ontology/EntityDetail.vue`
- Modify: `packages/web/src/pages/Ontology.vue`

- [ ] **Step 1: GraphExplorer**

Props: `nodes`, `edges`, `selected`. Emits: `select(uri)`, `depth-change(n)`, `refresh()`. Use `vis-network` (already a dependency). Add filters for type/status/department and a search box. Keep the layout stable; do not rebuild the network on every keystroke (debounce 250ms).

- [ ] **Step 2: EntityDetail**

Props: `entity`, `explanation`. Sections: properties, relations, timeline, `why` list, evidence links. Every evidence link is clickable and selects the referenced entity.

- [ ] **Step 3: Compose in `Ontology.vue`**

Layout: left explorer, right detail; top toolbar with sync status and refresh; tabs for Validate / Impact / Anomalies.

- [ ] **Step 4: Verify build and commit**

```bash
pnpm --filter @sse/web build
git add packages/web/src/components/ontology packages/web/src/pages/Ontology.vue
git commit -m "feat(web): add ontology graph explorer and entity evidence detail"
```

### Task 6.3: Validation, impact, anomaly, sync panels

**Files:**
- Create: `packages/web/src/components/ontology/ValidationPanel.vue`
- Create: `packages/web/src/components/ontology/ImpactPanel.vue`
- Create: `packages/web/src/components/ontology/AnomalyPanel.vue`
- Create: `packages/web/src/components/ontology/SyncStatus.vue`

- [ ] **Step 1: ValidationPanel**

Form: amount, category. Result: valid/invalid badge, matched rule, issues with evidence links.

- [ ] **Step 2: ImpactPanel**

Form: rule id, category, department, amount delta. Result table: affected reports/people, counts, reasons.

- [ ] **Step 3: AnomalyPanel**

List with severity badges, code, message, entities. Filter by code. Link entities to the explorer.

- [ ] **Step 4: SyncStatus**

Show `version`, `quads`, `subjects`, `lagSeconds`, `outboxPending`, last error. Poll every 10s; stop on unmount.

- [ ] **Step 5: Verify and commit**

```bash
pnpm --filter @sse/web build
git add packages/web/src/components/ontology
git commit -m "feat(web): add validation, impact, anomaly and sync panels"
```

### Task 6.4: Web tests and UX checks

**Files:**
- Create: `packages/web/vitest.config.ts`
- Create: `packages/web/src/components/ontology/__tests__/EntityDetail.test.ts`

- [ ] **Step 1: Add Vitest config**

```ts
import { defineConfig } from 'vitest/config';
import vue from '@vitejs/plugin-vue';

export default defineConfig({
  plugins: [vue()],
  test: { environment: 'jsdom', globals: true },
});
```

- [ ] **Step 2: Test EntityDetail**

Assert that properties, timeline, and evidence links render; clicking an evidence link emits `select`.

- [ ] **Step 3: Verify build/tests**

```bash
pnpm --filter @sse/web test
pnpm --filter @sse/web build
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/web/vitest.config.ts packages/web/src/components/ontology/__tests__
git commit -m "test(web): cover ontology entity evidence detail"
```

---

## Phase 7: Shadow, cutover, decommission

**Goal:** Roll out safely, prove equivalence, and remove the old partial-mirror path.

**Exit criteria:** Shadow comparison is clean for 24h; `ONTOLOGY_V2=on` in production; legacy snapshot path removed; runbook and monitoring in place.

### Task 7.1: Shadow comparison

**Files:**
- Create: `packages/ontology/src/projection/shadow.ts`
- Test: `packages/ontology/src/__tests__/shadow.test.ts`

- [ ] **Step 1: Implement a SQL-truth comparator**

Do **not** compare against the legacy `SemanticMapper`: it is incomplete by design (LIMIT 500, no invoices/rules/categories/approvals/payments, rejected mapped to approved), so `equal` could never be true (H8 fix). Compare the v2 graph against direct Postgres truth instead:

- per table: `COUNT(*)` vs count of subjects of the corresponding class;
- sampled rows (keyset by id, 200 per table): every whitelisted column matches the graph property;
- status distribution: `GROUP BY status` in SQL vs `GROUP BY ?status` in SPARQL;
- relation counts: `submittedBy`, `containsItem`, `hasCategory`, `hasInvoice`, `hasApproval`, `hasPaymentReceipt`.

Return `{ equal, differences: Array<{ kind, table, id, sql, graph }> }`.

- [ ] **Step 2: Run in `ONTOLOGY_V2=shadow`**

The projector writes the v2 graph but queries still use the legacy path until `on`. Every 5 minutes, log the diff to stderr and expose it at `GET /ontology/status.shadow`.

- [ ] **Step 3: Verify and commit**

```bash
pnpm --filter @sse/ontology test -- shadow
git add packages/ontology/src/projection/shadow.ts packages/ontology/src/__tests__/shadow.test.ts
git commit -m "feat(ontology): compare the v2 graph against SQL truth in shadow mode"
```

### Task 7.2: Metrics and health

**Files:**
- Modify: `packages/api/src/routes/ontology-v2.ts`
- Modify: `packages/api/src/services/ontology-projector.ts`

- [ ] **Step 1: Extend `/ontology/status`**

Return:

```ts
{
  version: number;
  engine: 'oxigraph';
  counts: { quads: number; subjects: number };
  outboxPending: number;
  oldestPendingAgeSeconds: number;
  failuresLastHour: number;
  lastError: string | null;
  lagSeconds: number;
  shadow?: { equal: boolean; differences: number };
}
```

- [ ] **Step 2: Add structured logs**

On every projector tick with `processed > 0`, log `[ontology-projector] {"processed":n,"failed":n,"lag_ms":n,"duration_ms":n}` to stderr. Do not log row contents.

- [ ] **Step 3: Add a health check**

`/healthz` returns 503 when `oldestPendingAgeSeconds > 300` and `ONTOLOGY_V2=on`. Document that this is a soft dependency for business writes but a hard dependency for graph queries.

- [ ] **Step 4: Commit**

```bash
git add packages/api/src
git commit -m "feat(api): expose projector health and lag metrics"
```

### Task 7.3: Runbook and docs

**Files:**
- Create: `docs/2026-11-10-ontology-v2-runbook.md`
- Modify: `docs/2026-11-10-sse-process.md`
- Modify: `.env.example`
- Modify: `README.md`

- [ ] **Step 1: Write the runbook**

Sections:

1. Preconditions: migrations applied, backup taken.
2. Backfill: `POST /ontology/reconcile`, expected counts, checksum.
3. Verify: status endpoint, sample SPARQL queries, MCP smoke.
4. Cutover: `ONTOLOGY_V2=shadow` for 24h, then `on`, restart API and MCP.
5. Rollback: set `ONTOLOGY_V2=0`, restart; business writes unaffected; graph is rebuildable.
6. Troubleshooting: outbox lag, dead letters, worker crashes, checksum mismatch.
7. Decommission: remove legacy `SemanticMapper` calls after one clean release.

- [ ] **Step 2: Update `.env.example` and process docs**

Add the `ONTOLOGY_*` block from section 6. Document the new endpoints and MCP tools.

- [ ] **Step 3: Commit**

```bash
git add docs/2026-11-10-ontology-v2-runbook.md docs/2026-11-10-sse-process.md .env.example README.md
git commit -m "docs(ontology): add v2 runbook, env vars and endpoint reference"
```

### Task 7.4: Decommission the legacy path

**Files:**
- Modify: `packages/ontology/src/index.ts`
- Modify: `packages/ontology/src/semantic-mapper.ts`
- Modify: `packages/api/src/routes/ontology.ts`
- Modify: `packages/mcp/src/tools/get-engine.ts`

- [ ] **Step 1: Remove legacy writes**

Replace `syncReportToOntology` / `syncAll` calls with a no-op that logs a deprecation warning and points to the projector. Remove the old `executeSparql` implementation after all callers use the worker store. Keep `OwlStore` only if the legacy web graph endpoint is still needed; otherwise remove it.

- [ ] **Step 2: Make legacy endpoints aliases**

- `GET /ontology/sync` -> `POST /ontology/reconcile` behavior (admin).
- `GET /ontology/query?type=` -> `GET /ontology/entities?type=`.
- `GET /ontology/graph` -> `GET /ontology/entities` with graph projection.

- [ ] **Step 3: Remove `ensureOntologyLoaded`**

Delete `get-engine.ts`'s snapshot cache once no tool imports it. Keep the `OntologyEngine` for NL submit only if still used; otherwise move that path to the API and delete the engine.

- [ ] **Step 4: Run the full verification**

```bash
pnpm install
pnpm -r build
pnpm -r test
pnpm test:integration
bash test/mcp-regression.sh
```

Expected: all green; `grep -R "syncReportToOntology\|ensureOntologyLoaded\|executeSparql" packages | grep -v node_modules` returns only deprecation shims or nothing.

- [ ] **Step 5: Commit**

```bash
git add packages docs
git commit -m "refactor(ontology): retire legacy snapshot and toy SPARQL paths"
```

---

## 7. Acceptance scenarios

These are the end-to-end proofs. Each must pass before declaring the overhaul complete.

### A1: Record equivalence across the lifecycle

1. Create a draft report with two items.
2. Submit -> `pending`.
3. Approve step 1 -> still `pending` until final step.
4. Final approve -> `approved`.
5. Reject a different report -> `rejected` (not `approved`).
6. Mark paid -> `paid`.

After each step, `GET /ontology/entities/<report-uri>` returns the matching status and relations within 2 seconds.

### A2: Cross-domain query

`POST /ontology/query` with `{ department: "研发", status: "pending", group_by: "category" }` returns the expected counts and amounts, matching the same SQL query over Postgres.

### A3: Real SPARQL

```sparql
SELECT ?person (SUM(?amount) AS ?total) WHERE {
  ?report a sse:ExpenseReport ;
          sse:submittedBy ?person ;
          sse:containsItem ?item .
  ?item sse:amount ?amount .
  ?report sse:status "paid" .
} GROUP BY ?person ORDER BY DESC(?total)
```

Returns the same totals as `get_statistics` for the same period.

### A4: Explainability

`POST /ontology/explain` for a stuck report returns:
- the current status and current step,
- the pending approver and role,
- the matched rule and amount range,
- invoice verification status,
- the exact evidence URIs.

### A5: Validation

`POST /ontology/validate` for an amount/category with no active approver returns `valid: false` with a `missing_approver` issue and evidence. A valid case returns the matched rule and approval steps.

### A6: Anomalies

Seed a duplicate invoice number and an amount mismatch. `GET /ontology/anomalies` returns both with the correct entity URIs.

### A7: MCP

`query_ontology`, `get_entity_network`, `query_sparql`, `explain_expense`, `impact_analysis`, `find_anomalies`, and `get_ontology_schema` all return data through the API. A deactivated API key returns `UNAUTHORIZED`; an employee calling `query_sparql` returns `FORBIDDEN`.

### A8: Failure recovery

Stop the API mid-projection, restart it. The graph is restored from the latest snapshot, the projector resumes from the snapshot's `last_outbox_id`, no events are lost, and `/ontology/status` reports zero pending after catch-up. Separately, force a SPARQL timeout and verify the respawned worker restores the checkpoint and preserves `counts().quads`.

---

## 8. Test matrix

| Layer | Tests | Command |
|---|---|---|
| Graph port | select/join/filter/update/dump/load | `pnpm --filter @sse/ontology test` |
| TBox/SHACL | class/property contracts, valid/invalid fixtures | `pnpm --filter @sse/ontology test` |
| Mapper | all 8 tables, PII exclusion, rejected status | `pnpm --filter @sse/ontology test` |
| Projector | insert/update/delete, replay, retry, lock | `pnpm --filter @sse/ontology test` |
| Reconcile | deterministic checksum, relation completeness | `pnpm --filter @sse/ontology test` |
| Query service | scope, filters, aggregation | `pnpm --filter @sse/ontology test` |
| SPARQL guard | read-only, SERVICE/LOAD rejection, cap | `pnpm --filter @sse/ontology test` |
| Rules | CONSTRUCT idempotency, datatype round-trip | `pnpm --filter @sse/ontology test` |
| Evidence | explain/validate/impact/anomalies | `pnpm --filter @sse/ontology test` |
| API | endpoints, RBAC, OpenAPI | `pnpm --filter @sse/api test` |
| MCP | tool mapping, auth, timeout, audit | `pnpm --filter @sse/mcp test` |
| Web | client mapping, EntityDetail render | `pnpm --filter @sse/web test` |
| Integration | outbox, lifecycle, MCP smoke | `pnpm test:integration` + `bash test/mcp-regression.sh` |

---

## 9. Rollout and rollback

### Rollout

1. Merge Phase 0-2 with `ONTOLOGY_V2=0` (no behavior change). Apply migrations 015-017.
2. Enable `shadow` in staging; run A1-A8; compare shadow diff.
3. Enable `shadow` in production for 24h; require `shadow.equal = true` and `outboxPending = 0`.
4. Enable `on`; restart API and MCP; monitor lag and errors.
5. After one clean release, execute Task 7.4 to decommission the legacy path.

### Rollback

- Any phase: set `ONTOLOGY_V2=0` and restart, then run `UPDATE ontology_settings SET value = 'false' WHERE key = 'outbox_enabled'` to stop outbox growth. Business writes are never blocked by the projector.
- Graph corruption: `POST /ontology/reconcile` rebuilds from Postgres.
- Worker crash: the adapter respawns and reloads the last snapshot automatically.
- Bad rule/shape: deactivate the row in `reasoning_rules`; `materialize()` skips inactive rules.
- Migration rollback: migrations are additive; no destructive column drops in Phases 0-6.

---

## 10. Risks and mitigations

| Risk | Mitigation |
|---|---|
| Entity update wipes unrelated edges | `replaceEntity` only deletes owned predicates; never deletes incoming edges; child parent edges are explicit add/remove; regression test for person update preserving `submittedBy` |
| Restart or worker respawn loses the graph | Load latest snapshot on boot; `OxigraphStore` restores its checkpoint on respawn; A8 regression test |
| Outbox rows contain PII/secrets | Trigger strips `password_hash`, `phone`, `email`, `storage_key`, `storage_bucket`, `ocr_result`, `verification_result`; mapper whitelists; retention purge; tests assert absence |
| Outbox grows before cutover | Triggers are gated by `ontology_settings.outbox_enabled`; enable only when the projector runs; retention purge |
| Payment receipt columns mismatch | PaymentReceipt maps only real columns; monetary facts are on ExpenseReport; a schema contract test asserts the mapper does not reference non-existent fields |
| WASM graph memory growth | Monitor `quads`; snapshot/rebuild; cap history; document the scale ceiling; GraphStore port allows Fuseki/Neo4j later |
| Trigger overhead on write paths | Triggers only insert one outbox row; measure p95; batch projector; keep `ontology_outbox` indexed |
| SPARQL query blocks event loop | Worker thread + timeout + respawn; cap results; reject SERVICE/LOAD |
| Rule inference cost | Debounce to 2s; materialize on projector drain; clear/rebuild inferred graph; rules are small |
| Scope bypass via raw SPARQL | Admin/finance only; typed queries enforce scope; add tests for employee denial |
| UI graph too large | Server-side filtering and pagination; limit network depth to 5; default to 200 nodes |
| MCP API outage | Tools return `INTERNAL_ERROR`; existing non-ontology tools unaffected; document dependency |

---

## 10.5 Revisions after adversarial review

The first draft was reviewed by the architecture agent. These findings were fixed in this version:

| Finding | Fix in this plan |
|---|---|
| B1 full-subject delete corrupts parent/child/shared entities | `replaceEntity` deletes only owned predicates; `addRelation`/`removeRelation` for parent edges; regression tests |
| B2 graph lost on restart/worker respawn | snapshot restore on boot; `OxigraphStore` checkpoint + restore on respawn; A8 test |
| B3 payment receipt columns do not exist | PaymentReceipt maps real columns; monetary facts on ExpenseReport |
| H1 outbox PII sink | trigger strips phone/email/storage keys/OCR results; test |
| H2 Department nodes missing | users projection writes Department subject |
| H3 TBox never loaded | `loadTBox()` + asset copy + schema test |
| H4 snapshot table collision | dedicated `ontology_graph_snapshots` table |
| H5 graph not shared with routes | `graph-context.ts` singleton |
| H6 legacy endpoint breaks when flag off | flag-gated fallback to legacy `executeSparql`; typed `type` support |
| H7 triggers fire before projector runs | `ontology_settings.outbox_enabled` gate |
| H8 shadow gate unsatisfiable | compare against SQL truth, not the broken legacy mapper |
| M1 SHACL result extraction | read `report.dataset` instead of assuming result fields |
| M2 snapshot graph list/retention | pass real graph list; prune to last 5 |
| M3 watermark skips failed rows | stop at first retryable failure; dead-letter after 10 |
| M4 worker path under ts-jest | explicit `workerPath` option; worker tests run against `dist` |
| M5 result cap breaks ASK/CONSTRUCT | cap SELECT only; clamp existing LIMIT |
| M6 SERVICE guard regex | AST walk with `sparqljs` |
| M7 reconcile blocks request thread | batched background job + polling |
| L1 datatype serializer | mandatory N-Triples round-trip test |
| L2 provenance undefined | `PROV` namespace + `recordVersion` source |
| L3 cron parser fragile | fixed `ONTOLOGY_ANOMALY_INTERVAL_MS` |
| L4 anomaly/impact over-scope | ship 3 core anomalies; defer the rest to Phase 4b |
| L5 trigger permissions | `SECURITY DEFINER` + explicit grant + gated enablement |
| N1 object-property double-listing | one mechanism per predicate: entity-owned edges in `ownedPredicates`, parent-side edges in `add`/`remove` |
| N2 loadTBox clobbers checkpoint | TBox loaded before the snapshot; regression test after respawn |
| N3 `governedBy` never emitted | `explain`/`validate` share `matchRule`; no premature CONSTRUCT rule |
| N4 `requireAuth` does not exist | router-level `authMiddleware` + `requireRole` from `middleware/rbac` |
| N5 TBox incomplete | `PREDICATES` export + contract test asserts full coverage |
| N6 reconcile loses tombstones | preserve `urn:sse:history`; advance projector watermark explicitly |
| N7 implicit column names | explicit column -> predicate map |
| N8 soft-deleted users | map `deleted_at` to status `deleted`; no `belongsTo` |

---

## 11. Approval checklist

Before execution, confirm:

- [ ] D1 embedded Oxigraph is acceptable (vs external triplestore).
- [ ] D2 trigger-based outbox is acceptable (vs application events).
- [ ] D3 canonical status property + inferred legacy classes is acceptable.
- [ ] D4 API owns the graph; MCP becomes a thin client is acceptable.
- [ ] D5 raw SPARQL restricted to admin/finance is acceptable.
- [ ] D6 PII/secret exclusion from the graph is acceptable.
- [ ] D7 workbench UI scope is acceptable.
- [ ] D8 legacy endpoints/tool names remain during migration is acceptable.
- [ ] The Phase 0-7 order and the 24h shadow gate are acceptable.
- [ ] No task should start until this plan is approved.

**Baseline commit:** `6d039f1` (recorded 2026-11-10).

---

## 12. Execution status (2026-11-10)

Approved and implemented on branch `feat/ontology-platform-overhaul` in worktree `E:\app\opencode\sse-ontology-v2`.

| Phase | Status | Key commits |
|---|---|---|
| 0 | Done | `1cdc03e`, `9929254`, `d92be9c`, `ff83e55`, `83847bc` |
| 1 | Done | `32d6ac6`, `ea1e702`, `a1b4549`, `55b1ca4`, `33acb08` |
| 2 | Done | `44f3b2a`, `a507cdd`, `d8d5d4f`, `a2102f3`, `7c89e9f`, `5521bff` |
| 3 | Done | `db636f6`, `2c1ac70`, `758abe0`, `753d971`, `9ca826c` |
| 4 | Done | `532e3b1`, `953bea6`, `56e2d0f`, `fa6a2c6`, `6c1ffe3`, `7ba49d2`, `7286cb1` |
| 5 | Done | `f6d9c77`, `694b98e`, `4d608b2`, `46a8dfe`, `326549d`, `65992d4` |
| 6 | Done | `d4cbaca`, `02480e8`, `9e8dfc7`, `68d88af`, `9621dd9`, `7cad63c`, `6a5ba66` |
| 7 | Done | `6f16c77`, `d14135f`, `f4080a7`, `8a890bb`, `ef09fa3`, `ca5897e`, `ed43ff6` |

**Verification:** `pnpm -r build` passes (11 packages); `pnpm -r test` passes (595 tests, 0 failures: ontology 170, api 123, mcp 56, web 25, core 41, auth 30, db 21, ai 100, notifications 29).

**P0 security follow-up:** bcrypt login/change/create, login rate limiting, account enumeration fix, 72-byte bcrypt limit, SCIM/MDM service tokens, sentinel cleanup migration `018`, and the verified `admin123` seed hash are implemented and reviewed.

**Cutover artifacts:** `deploy/preflight-ontology-v2.sql`, `docs/2026-11-10-ontology-v2-cutover-checklist.md`, deployment nginx `X-Forwarded-For`/`TRUST_PROXY` notes, and the updated runbook.

**Deliberate deviations from the original text:**
- MCP Jest config is `jest.config.cjs` because `@sse/mcp` is `"type": "module"`; test scripts use `--passWithNoTests` where suites are added later.
- The `OntologyQueryService` pool is optional; `status()` degrades to graph-only counts without a DB.
- Legacy `executeSparql`, `OwlStore`, and legacy endpoints are retained as flag-gated rollback aliases. Full removal happens after the 24h production shadow gate and one clean `on` release.
- Anomalies v1 ships 3 checks; the other 6 are deferred to Phase 4b.
- `urn:sse:manual` is preserved across reconcile and included in snapshots.
- Shadow comparison uses SQL truth and `COUNT(*)` relation triples; stderr logs aggregate counts only.

**Still required before production:**
1. Backup the DB and apply migrations `015`-`017`.
2. Run `POST /ontology/reconcile`, verify counts/checksum/outbox.
3. Run `ONTOLOGY_V2=shadow` for 24h and require consecutive `shadow.equal=true` checks.
4. Smoke the 22 MCP tools and `/healthz`.
5. Cut over with `ONTOLOGY_V2=on`, restart API + MCP, monitor lag/dead letters/counts.
6. Rollback: `ONTOLOGY_V2=0`, restart, set `ontology_settings.outbox_enabled=false`.
7. Only after a clean release: remove `executeSparql`/`OwlStore`/legacy endpoints.
