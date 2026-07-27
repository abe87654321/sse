# 本体层 MCP 工具 + 可视化页面 — 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 ontology 包注册 7 个 MCP 工具，新增 NL→本体生成和 Cytoscape.js 可视化页面

**Architecture:** MCP 工具复用现有 `definition` + `handler` 模式，通过 `OntologyEngine` 调用 LLM/OCR/DB。前端页面使用 Cytoscape.js 渲染图谱，通过新增 REST API 与 OwlStore 交互。

**Tech Stack:** TypeScript, MCP SDK, N3.js, Ollama LLM, Vue 3 + Cytoscape.js, Express

---

### Task 1: OwlStore 扩展（getGraph + CRUD）

**Files:**
- Modify: `packages/ontology/src/owl-store.ts`

- [ ] **Step 1: 新增 getGraph()、实体/关系 CRUD 方法**

将 `packages/ontology/src/owl-store.ts` 替换为以下内容：

```typescript
import { Store, Parser, Writer } from 'n3';

export interface GraphNode {
  id: string;
  label: string;
  type: string;
  properties: Record<string, string>;
}

export interface GraphEdge {
  id: string;
  from: string;
  to: string;
  label: string;
}

export interface OntologyGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export class OwlStore {
  private store: Store;
  private baseUri: string;

  constructor(baseUri = 'https://sse.local/ontology#') {
    this.store = new Store();
    this.baseUri = baseUri;
  }

  async loadFromTurtle(turtlePath: string): Promise<void> {
    const fs = await import('fs');
    const parser = new Parser({ baseIRI: this.baseUri });
    const data = fs.readFileSync(turtlePath, 'utf-8');
    const quads = parser.parse(data);
    this.store.addQuads(quads);
  }

  async saveToTurtle(turtlePath: string): Promise<void> {
    const fs = await import('fs');
    const writer = new Writer({ format: 'Turtle' });
    const quads = this.store.getQuads(null, null, null, null);
    const result = writer.quadsToString(quads);
    fs.writeFileSync(turtlePath, result, 'utf-8');
  }

  addEntity(uri: string, type: string, properties: Record<string, string>): void {
    const subject = this.store.createNamedNode(uri);
    this.store.addQuad(subject, this.store.createNamedNode('http://www.w3.org/1999/02/22-rdf-syntax-ns#type'), this.store.createNamedNode(this.baseUri + type));
    for (const [key, value] of Object.entries(properties)) {
      this.store.addQuad(subject, this.store.createNamedNode(this.baseUri + key), this.store.createLiteral(value));
    }
  }

  addRelation(fromUri: string, predicate: string, toUri: string): void {
    const subject = this.store.createNamedNode(fromUri);
    const objectUri = toUri.startsWith('http') ? toUri : `${this.baseUri}${toUri}`;
    this.store.addQuad(subject, this.store.createNamedNode(this.baseUri + predicate), this.store.createNamedNode(objectUri));
  }

  deleteEntity(uri: string): void {
    this.store.removeMatches(this.store.createNamedNode(uri), null, null, null);
    this.store.removeMatches(null, null, this.store.createNamedNode(uri), null);
  }

  deleteRelation(fromUri: string, predicate: string, toUri: string): void {
    const subject = this.store.createNamedNode(fromUri);
    const predicateNode = this.store.createNamedNode(this.baseUri + predicate);
    const objectUri = toUri.startsWith('http') ? toUri : `${this.baseUri}${toUri}`;
    this.store.removeMatches(subject, predicateNode, this.store.createNamedNode(objectUri), null);
  }

  queryByType(type: string): Array<{ uri: string; properties: Record<string, string> }> {
    const results: Array<{ uri: string; properties: Record<string, string> }> = [];
    const typeNode = this.store.createNamedNode(this.baseUri + type);
    for (const quad of this.store.match(null, this.store.createNamedNode('http://www.w3.org/1999/02/22-rdf-syntax-ns#type'), typeNode)) {
      const props: Record<string, string> = {};
      for (const pq of this.store.match(quad.subject, null, null)) {
        if (pq.predicate.value === 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type') continue;
        const predicate = pq.predicate.value.replace(this.baseUri, '');
        props[predicate] = pq.object.value;
      }
      results.push({ uri: quad.subject.value, properties: props });
    }
    return results;
  }

  getGraph(): OntologyGraph {
    const nodes: GraphNode[] = [];
    const edges: GraphEdge[] = [];
    const seenNodes = new Set<string>();
    const rdfType = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type';

    for (const quad of this.store.getQuads(null, null, null, null)) {
      const subjectUri = quad.subject.value;
      const predicateUri = quad.predicate.value;
      const objectValue = quad.object.value;

      if (!seenNodes.has(subjectUri)) {
        seenNodes.add(subjectUri);
        const typeQuad = this.store.getQuads(quad.subject, this.store.createNamedNode(rdfType), null, null)[0];
        const type = typeQuad ? typeQuad.object.value.replace(this.baseUri, '') : 'Unknown';
        const shortId = subjectUri.replace(this.baseUri, '').replace(/^https:\/\/sse\.local\//, '');
        nodes.push({ id: subjectUri, label: shortId, type, properties: {} });
      }

      if (predicateUri === rdfType) continue;

      const isObjectLiteral = !objectValue.startsWith('http');
      const propertyName = predicateUri.replace(this.baseUri, '');

      if (isObjectLiteral) {
        const nodeEntry = nodes.find(n => n.id === subjectUri);
        if (nodeEntry) nodeEntry.properties[propertyName] = objectValue;
      } else {
        if (!seenNodes.has(objectValue)) {
          seenNodes.add(objectValue);
          const objTypeQuad = this.store.getQuads(this.store.createNamedNode(objectValue), this.store.createNamedNode(rdfType), null, null)[0];
          const objType = objTypeQuad ? objTypeQuad.object.value.replace(this.baseUri, '') : 'Unknown';
          const shortId = objectValue.replace(this.baseUri, '').replace(/^https:\/\/sse\.local\//, '');
          nodes.push({ id: objectValue, label: shortId, type: objType, properties: {} });
        }
        edges.push({ id: `${subjectUri}--${propertyName}--${objectValue}`, from: subjectUri, to: objectValue, label: propertyName });
      }
    }

    return { nodes, edges };
  }

  clear(): void {
    this.store = new Store();
  }
}
```

- [ ] **Step 2: 编译验证**

```bash
pnpm --filter @sse/ontology build
```

Expected: PASS

- [ ] **Step 3: 提交**

```bash
git add packages/ontology/src/owl-store.ts
git commit -m "feat: extend OwlStore with getGraph, CRUD for entities and relations"
```

---

### Task 2: EntityExtractor 扩展（extractGraph NL→图谱）

**Files:**
- Modify: `packages/ontology/src/entity-extractor.ts`

- [ ] **Step 1: 新增 extractGraph 方法**

将 `packages/ontology/src/entity-extractor.ts` 替换为以下内容：

```typescript
import { LocalProvider } from '@sse/ai';
import type { ExpenseExtraction } from './types';

export interface GraphExtraction {
  entities: Array<{ uri: string; type: string; properties: Record<string, string> }>;
  relations: Array<{ from: string; to: string; predicate: string }>;
}

export class EntityExtractor {
  private provider: LocalProvider;

  constructor(endpoint: string, model: string) {
    this.provider = new LocalProvider({ endpoint, modelName: model });
  }

  async extractFromText(text: string): Promise<ExpenseExtraction> {
    const prompt = `你是一个报销信息提取助手。从以下自然语言中提取报销相关信息，以JSON格式返回。
不要添加JSON之外的任何内容。

输入: "${text}"

返回格式:
{
  "person": {"name": "姓名", "phone": "手机号(如有)"},
  "amount": 金额数字,
  "category": "费用类别(差旅费/住宿费/交通费/餐饮费/办公费/招待费/通讯费/培训费/其他)",
  "description": "费用描述",
  "date": "日期(YYYY-MM-DD, 如有)"
}

如果无法提取某个字段，设该字段为null。`;

    const result = await this.provider.analyzeText(text, prompt);
    try {
      const jsonMatch = result.match(/\{[\s\S]*\}/);
      if (jsonMatch) return JSON.parse(jsonMatch[0]);
    } catch { /* fall through */ }
    return {};
  }

  async extractFromInvoice(ocrText: string): Promise<ExpenseExtraction> {
    const prompt = `你是一个发票信息提取助手。从以下发票OCR识别结果中提取报销信息，以JSON格式返回。

OCR结果: "${ocrText}"

返回格式:
{
  "amount": 发票金额,
  "category": "费用类别",
  "description": "发票内容",
  "date": "发票日期(YYYY-MM-DD)"
}`;
    const result = await this.provider.analyzeText(ocrText, prompt);
    try {
      const jsonMatch = result.match(/\{[\s\S]*\}/);
      if (jsonMatch) return JSON.parse(jsonMatch[0]);
    } catch { /* fall through */ }
    return {};
  }

  async extractGraph(text: string): Promise<GraphExtraction> {
    const prompt = `你是一个知识图谱提取助手。从以下自然语言描述中提取本体实体和关系，以JSON格式返回。
不要添加JSON之外的任何内容。

本体类型可用: Person, Department, Company, Report, DraftReport, PendingReport, ApprovedReport, ExpenseItem, Invoice, ApprovalRule, Approver

可用关系: belongsTo, submittedBy, containsItem, hasInvoice, approvedBy, governedBy, partOf, manages

输入: "${text}"

返回格式:
{
  "entities": [
    { "uri": "简短英文ID", "type": "类型名", "properties": { "属性名": "属性值", ... } }
  ],
  "relations": [
    { "from": "来源实体URI", "to": "目标实体URI", "predicate": "关系名" }
  ]
}

注意:
1. uri 使用简短的英文ID（如 person/alice, report/RE001, item/001）
2. 每个实体至少要有 type 和一个识别属性
3. 关系必须连接两个已有实体的 uri
4. 如果描述提到了组织或部门也要提取`;

    const result = await this.provider.analyzeText(text, prompt);
    try {
      const jsonMatch = result.match(/\{[\s\S]*\}/);
      if (jsonMatch) return JSON.parse(jsonMatch[0]);
    } catch { /* fall through */ }
    return { entities: [], relations: [] };
  }
}
```

- [ ] **Step 2: 更新 types.ts 导出**

`packages/ontology/src/types.ts` 末尾追加：

```typescript
export interface GraphExtraction {
  entities: Array<{ uri: string; type: string; properties: Record<string, string> }>;
  relations: Array<{ from: string; to: string; predicate: string }>;
}
```

- [ ] **Step 3: 编译验证**

```bash
pnpm --filter @sse/ontology build
```

Expected: PASS

- [ ] **Step 4: 提交**

```bash
git add packages/ontology/src/entity-extractor.ts packages/ontology/src/types.ts
git commit -m "feat: add extractGraph method to EntityExtractor for NL-to-graph generation"
```

---

### Task 3: 7 个 MCP 工具实现

**Files:**
- Create: `packages/mcp/src/tools/submit-expense-from-text.ts`
- Create: `packages/mcp/src/tools/submit-expense-from-invoice.ts`
- Create: `packages/mcp/src/tools/query-expense-status.ts`
- Create: `packages/mcp/src/tools/explain-decision.ts`
- Create: `packages/mcp/src/tools/get-entity-network.ts`
- Create: `packages/mcp/src/tools/validate-expense.ts`
- Create: `packages/mcp/src/tools/query-ontology.ts`
- Modify: `packages/mcp/src/server.ts`

- [ ] **Step 1: 创建 submit-expense-from-text.ts**

`packages/mcp/src/tools/submit-expense-from-text.ts`:

```typescript
import type { ToolDefinition, ToolResult } from "./types.js";
import { errorResult, successResult } from "./types.js";
import { resolveAuthContext } from "../auth.js";
import { OntologyEngine } from "@sse/ontology";
import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { pool } from "@sse/db";

const CONFIG_PATH = join(process.cwd(), "ai-config.json");

function getEngine(): OntologyEngine {
  const defaults = { fillEngine: { endpoint: "http://localhost:11434/v1/chat/completions", model: "llama3.1:8b" } };
  let cfg = defaults;
  try { if (existsSync(CONFIG_PATH)) { const saved = JSON.parse(readFileSync(CONFIG_PATH, "utf-8")); cfg = { ...defaults, fillEngine: { ...defaults.fillEngine, ...(saved.fillEngine || {}) } }; } } catch { /* use defaults */ }
  return new OntologyEngine(cfg.fillEngine.endpoint, cfg.fillEngine.model);
}

export const definition: ToolDefinition = {
  name: "submit_expense_from_text",
  description: "从自然语言描述中提取报销信息，自动创建报销单并提交审批。输入中文描述，系统自动识别人员、金额、类别等信息。",
  inputSchema: {
    type: "object",
    properties: {
      text: { type: "string", description: "报销的自然语言描述，如：张三出差北京住宿费600元" },
    },
    required: ["text"],
  },
};

export async function handler(args: Record<string, unknown>): Promise<ToolResult> {
  const auth = resolveAuthContext(args);
  if (!auth) return errorResult("UNAUTHORIZED", "无效或缺失 API key");

  const text = args.text as string;
  if (!text) return errorResult("INVALID_PARAMS", "请提供 text 参数");

  try {
    const engine = getEngine();
    const result = await engine.submitFromText(text, auth.userId, "");
    return successResult(result);
  } catch (err: any) {
    return errorResult("INTERNAL_ERROR", err.message || "内部错误");
  }
}
```

- [ ] **Step 2: 创建 submit-expense-from-invoice.ts**

`packages/mcp/src/tools/submit-expense-from-invoice.ts`:

```typescript
import type { ToolDefinition, ToolResult } from "./types.js";
import { errorResult, successResult } from "./types.js";
import { resolveAuthContext } from "../auth.js";
import { OntologyEngine } from "@sse/ontology";
import { parseOcr } from "@sse/ocr";
import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { pool } from "@sse/db";

const CONFIG_PATH = join(process.cwd(), "ai-config.json");

function getEngine(): OntologyEngine {
  const defaults = { fillEngine: { endpoint: "http://localhost:11434/v1/chat/completions", model: "llama3.1:8b" } };
  let cfg = defaults;
  try { if (existsSync(CONFIG_PATH)) { const saved = JSON.parse(readFileSync(CONFIG_PATH, "utf-8")); cfg = { ...defaults, fillEngine: { ...defaults.fillEngine, ...(saved.fillEngine || {}) } }; } } catch { /* use defaults */ }
  return new OntologyEngine(cfg.fillEngine.endpoint, cfg.fillEngine.model);
}

export const definition: ToolDefinition = {
  name: "submit_expense_from_invoice",
  description: "上传发票图片(base64)，通过OCR识别后自动创建报销单并提交审批。支持PDF和图片格式的发票。",
  inputSchema: {
    type: "object",
    properties: {
      image_base64: { type: "string", description: "发票图片的base64编码" },
      file_format: { type: "string", description: "文件格式: pdf 或 image" },
    },
    required: ["image_base64"],
  },
};

export async function handler(args: Record<string, unknown>): Promise<ToolResult> {
  const auth = resolveAuthContext(args);
  if (!auth) return errorResult("UNAUTHORIZED", "无效或缺失 API key");

  const imageBase64 = args.image_base64 as string;
  if (!imageBase64) return errorResult("INVALID_PARAMS", "请提供 image_base64 参数");

  try {
    const ocrText = await parseOcr(imageBase64, (args.file_format as string) || "image");
    if (!ocrText) return errorResult("OCR_FAILED", "发票OCR识别无返回结果，请检查模型连接");

    const engine = getEngine();
    const extraction = await engine.extractor.extractFromInvoice(ocrText);

    if (!extraction.amount) {
      return errorResult("EXTRACTION_EMPTY", "未能从发票中提取到有效金额信息。OCR结果: " + ocrText.substring(0, 200));
    }

    const { rows: categories } = await pool.query(
      "SELECT id FROM expense_categories WHERE name ILIKE $1 LIMIT 1",
      [`%${extraction.category || ""}%`]
    );
    if (categories.length > 0) extraction.categoryId = categories[0].id;

    const { valid, error, dto } = await engine.reasoner.reason(extraction);

    let resolvedUserId = auth.userId;
    if (extraction.person?.name) {
      const { rows: users } = await pool.query(
        "SELECT id FROM users WHERE name = $1 OR phone = $1",
        [extraction.person.name]
      );
      if (users.length > 0) {
        resolvedUserId = users[0].id;
        if (extraction.person) extraction.person.matchedUserId = resolvedUserId;
      }
    }

    if (!valid) return successResult({ success: false, error, notified: ["role:admin"] });

    const actionResult = await engine.executor.execute(dto!, resolvedUserId, "");
    if (actionResult.success && actionResult.report_id) {
      try { await engine.mapper.syncReportToOntology(actionResult.report_id); } catch { /* best effort */ }
    }
    return successResult(actionResult);
  } catch (err: any) {
    return errorResult("INTERNAL_ERROR", err.message || "内部错误");
  }
}
```

- [ ] **Step 3: 创建 query-expense-status.ts**

`packages/mcp/src/tools/query-expense-status.ts`:

```typescript
import type { ToolDefinition, ToolResult } from "./types.js";
import { errorResult, successResult } from "./types.js";
import { resolveAuthContext } from "../auth.js";
import { EntityExtractor } from "@sse/ontology";
import { pool } from "@sse/db";
import { readFileSync, existsSync } from "fs";
import { join } from "path";

const CONFIG_PATH = join(process.cwd(), "ai-config.json");

export const definition: ToolDefinition = {
  name: "query_expense_status",
  description: "用自然语言查询报销单状态。输入如'张三的出差住宿报销批了吗'或'最近有哪些待审批的报销'",
  inputSchema: {
    type: "object",
    properties: {
      query: { type: "string", description: "自然语言查询，如：张三最近的报销审批通过了吗" },
    },
    required: ["query"],
  },
};

export async function handler(args: Record<string, unknown>): Promise<ToolResult> {
  const auth = resolveAuthContext(args);
  if (!auth) return errorResult("UNAUTHORIZED", "无效或缺失 API key");

  const query = args.query as string;
  if (!query) return errorResult("INVALID_PARAMS", "请提供 query 参数");

  try {
    const defaults = { fillEngine: { endpoint: "http://localhost:11434/v1/chat/completions", model: "llama3.1:8b" } };
    let cfg = defaults;
    try { if (existsSync(CONFIG_PATH)) { const saved = JSON.parse(readFileSync(CONFIG_PATH, "utf-8")); cfg = { ...defaults, fillEngine: { ...defaults.fillEngine, ...(saved.fillEngine || {}) } }; } } catch { /* use defaults */ }

    const extractor = new EntityExtractor(cfg.fillEngine.endpoint, cfg.fillEngine.model);

    const extractPrompt = `从以下查询中提取关键词和过滤条件，返回JSON:
查询: "${query}"

返回格式: { "name": "人名或null", "status": "pending/approved/rejected/paid或null", "keyword": "关键词或null", "dateHint": "日期或null" }`;

    const parsed = await extractor["provider"].analyzeText(query, extractPrompt);
    let filters: any = {};
    try {
      const jsonMatch = parsed.match(/\{[\s\S]*\}/);
      if (jsonMatch) filters = JSON.parse(jsonMatch[0]);
    } catch { /* proceed with empty filters */ }

    let sql = "SELECT er.id, er.serial_no, er.title, er.total_amount, er.status, er.submitted_at, u.name as applicant_name FROM expense_reports er JOIN users u ON u.id = er.user_id WHERE 1=1";
    const values: any[] = [];
    let idx = 1;

    if (filters.name) {
      sql += ` AND u.name ILIKE $${idx++}`;
      values.push(`%${filters.name}%`);
    }
    if (filters.status) {
      sql += ` AND er.status = $${idx++}`;
      values.push(filters.status);
    }
    if (filters.keyword) {
      sql += ` AND (er.title ILIKE $${idx++} OR er.serial_no ILIKE $${idx++})`;
      values.push(`%${filters.keyword}%`, `%${filters.keyword}%`);
    }

    sql += " ORDER BY er.submitted_at DESC LIMIT 20";

    const { rows } = await pool.query(sql, values);

    const explainPrompt = `查询"${query}"结果如下，请用简洁中文总结（不超过3句话）:\n${JSON.stringify(rows, null, 2)}`;
    const summary = await extractor["provider"].analyzeText(JSON.stringify(rows), explainPrompt);

    return successResult({ summary, results: rows, count: rows.length });
  } catch (err: any) {
    return errorResult("INTERNAL_ERROR", err.message || "内部错误");
  }
}
```

- [ ] **Step 4: 创建 explain-decision.ts**

`packages/mcp/src/tools/explain-decision.ts`:

```typescript
import type { ToolDefinition, ToolResult } from "./types.js";
import { errorResult, successResult } from "./types.js";
import { resolveAuthContext, enforceReadAccess } from "../auth.js";
import { pool } from "@sse/db";

export const definition: ToolDefinition = {
  name: "explain_decision",
  description: "解释某个报销单的审批流程：为什么匹配了特定审批规则、当前审批链有哪些步骤、每个步骤的审批人是谁。",
  inputSchema: {
    type: "object",
    properties: {
      report_id: { type: "string", description: "报销单 UUID" },
    },
    required: ["report_id"],
  },
};

export async function handler(args: Record<string, unknown>): Promise<ToolResult> {
  const auth = resolveAuthContext(args);
  if (!auth) return errorResult("UNAUTHORIZED", "无效或缺失 API key");

  const reportId = args.report_id as string;
  if (!reportId) return errorResult("INVALID_PARAMS", "请提供 report_id 参数");

  try {
    const { rows: reports } = await pool.query(
      "SELECT er.*, u.name as applicant_name, u.department FROM expense_reports er JOIN users u ON u.id = er.user_id WHERE er.id = $1",
      [reportId]
    );
    if (reports.length === 0) return errorResult("NOT_FOUND", "报销单不存在或无权访问");
    const report = reports[0];

    if (!enforceReadAccess(auth, report.user_id, report.department)) {
      return errorResult("NOT_FOUND", "报销单不存在或无权访问");
    }

    const { rows: items } = await pool.query(
      "SELECT ei.*, ec.name as cat_name FROM expense_items ei LEFT JOIN expense_categories ec ON ec.id = ei.category_id WHERE ei.report_id = $1",
      [reportId]
    );

    const { rows: rules } = await pool.query(
      "SELECT * FROM approval_rules WHERE is_active = true AND min_amount <= $1 AND max_amount > $1 ORDER BY priority ASC",
      [report.total_amount]
    );

    const matchedRule = rules.length > 0 ? rules[0] : null;

    const { rows: records } = await pool.query(
      "SELECT ar.*, u.name as approver_name FROM approval_records ar LEFT JOIN users u ON u.id = ar.approver_id WHERE ar.report_id = $1 ORDER BY ar.step",
      [reportId]
    );

    const reportCategories = [...new Set(items.map((i: any) => i.cat_name))];
    const allRules = rules.map((r: any) => ({
      name: r.name,
      range: `${r.min_amount} - ${r.max_amount}`,
      priority: r.priority,
      matched: r.id === matchedRule?.id,
    }));

    const result = {
      report: {
        id: report.id,
        serial_no: report.serial_no,
        title: report.title,
        total_amount: report.total_amount,
        status: report.status,
        applicant: report.applicant_name,
        department: report.department,
        categories: reportCategories,
      },
      approval_chain: matchedRule ? matchedRule.approval_chain : [],
      matched_rule: matchedRule ? { name: matchedRule.name, priority: matchedRule.priority, amount_range: `${matchedRule.min_amount} - ${matchedRule.max_amount}` } : null,
      all_candidate_rules: allRules,
      approval_history: records.map((r: any) => ({
        step: r.step,
        approver: r.approver_name,
        result: r.result,
        comment: r.comment,
        approved_at: r.approved_at,
        step_started_at: r.step_started_at,
      })),
      explanation: matchedRule
        ? `总金额 ¥${report.total_amount} 匹配规则"${matchedRule.name}"（区间 ${matchedRule.min_amount}-${matchedRule.max_amount}，优先级 ${matchedRule.priority}），${reportCategories.length > 0 ? "费用类别: " + reportCategories.join("、") : ""}`
        : "未匹配到审批规则，请检查规则配置",
    };

    return successResult(result);
  } catch (err: any) {
    return errorResult("INTERNAL_ERROR", err.message || "内部错误");
  }
}
```

- [ ] **Step 5: 创建 get-entity-network.ts**

`packages/mcp/src/tools/get-entity-network.ts`:

```typescript
import type { ToolDefinition, ToolResult } from "./types.js";
import { errorResult, successResult } from "./types.js";
import { resolveAuthContext } from "../auth.js";
import { OntologyEngine } from "@sse/ontology";
import { readFileSync, existsSync } from "fs";
import { join } from "path";

const CONFIG_PATH = join(process.cwd(), "ai-config.json");

function getEngine(): OntologyEngine {
  const defaults = { fillEngine: { endpoint: "http://localhost:11434/v1/chat/completions", model: "llama3.1:8b" } };
  let cfg = defaults;
  try { if (existsSync(CONFIG_PATH)) { const saved = JSON.parse(readFileSync(CONFIG_PATH, "utf-8")); cfg = { ...defaults, fillEngine: { ...defaults.fillEngine, ...(saved.fillEngine || {}) } }; } } catch { /* use defaults */ }
  return new OntologyEngine(cfg.fillEngine.endpoint, cfg.fillEngine.model);
}

export const definition: ToolDefinition = {
  name: "get_entity_network",
  description: "获取某个实体的N跳语义关系网络。返回周边节点和边的集合，可用于可视化报销单、人员、部门之间的关联关系。",
  inputSchema: {
    type: "object",
    properties: {
      entity_id: { type: "string", description: "实体标识，如报告ID或人员名称" },
      depth: { type: "number", description: "关系跳数，默认2" },
    },
    required: ["entity_id"],
  },
};

export async function handler(args: Record<string, unknown>): Promise<ToolResult> {
  const auth = resolveAuthContext(args);
  if (!auth) return errorResult("UNAUTHORIZED", "无效或缺失 API key");

  const entityId = args.entity_id as string;
  const depth = (args.depth as number) || 2;
  if (!entityId) return errorResult("INVALID_PARAMS", "请提供 entity_id 参数");

  try {
    const engine = getEngine();

    const graph = engine.store.getGraph();

    const targetUri = entityId.includes("://") ? entityId : `https://sse.local/${entityId}`;

    const visited = new Set<string>();
    const neighborhoodNodes: typeof graph.nodes = [];
    const neighborhoodEdges: typeof graph.edges = [];

    function expand(currentUri: string, currentDepth: number) {
      if (currentDepth > depth || visited.has(currentUri)) return;
      visited.add(currentUri);

      const node = graph.nodes.find(n => n.id === currentUri);
      if (node && !neighborhoodNodes.find(n => n.id === currentUri)) {
        neighborhoodNodes.push(node);
      }

      for (const edge of graph.edges) {
        if (edge.from === currentUri || edge.to === currentUri) {
          if (!neighborhoodEdges.find(e => e.id === edge.id)) {
            neighborhoodEdges.push(edge);
          }
          const neighbor = edge.from === currentUri ? edge.to : edge.from;
          if (!visited.has(neighbor)) {
            expand(neighbor, currentDepth + 1);
          }
        }
      }
    }

    expand(targetUri, 0);

    return successResult({
      center: targetUri,
      depth,
      nodes: neighborhoodNodes,
      edges: neighborhoodEdges,
      node_count: neighborhoodNodes.length,
      edge_count: neighborhoodEdges.length,
    });
  } catch (err: any) {
    return errorResult("INTERNAL_ERROR", err.message || "内部错误");
  }
}
```

- [ ] **Step 6: 创建 validate-expense.ts**

`packages/mcp/src/tools/validate-expense.ts`:

```typescript
import type { ToolDefinition, ToolResult } from "./types.js";
import { errorResult, successResult } from "./types.js";
import { resolveAuthContext } from "../auth.js";
import { pool } from "@sse/db";

export const definition: ToolDefinition = {
  name: "validate_expense",
  description: "合规检查：验证费用项是否符合审批规则，包括金额限制、类别匹配和审批链可用性。返回检查结果和改进建议。",
  inputSchema: {
    type: "object",
    properties: {
      amount: { type: "number", description: "报销金额" },
      category_id: { type: "string", description: "费用类别 UUID（可选）" },
      category_name: { type: "string", description: "费用类别名称（可选，用于模糊匹配）" },
    },
    required: ["amount"],
  },
};

export async function handler(args: Record<string, unknown>): Promise<ToolResult> {
  const auth = resolveAuthContext(args);
  if (!auth) return errorResult("UNAUTHORIZED", "无效或缺失 API key");

  const amount = args.amount as number;
  if (!amount || amount <= 0) return errorResult("INVALID_PARAMS", "请提供有效的 amount 参数");

  try {
    const categoryId = args.category_id as string;
    const categoryName = args.category_name as string;

    let categoryMatch: any = null;
    if (categoryId) {
      const { rows } = await pool.query("SELECT id, name FROM expense_categories WHERE id = $1", [categoryId]);
      categoryMatch = rows[0] || null;
    } else if (categoryName) {
      const { rows } = await pool.query("SELECT id, name FROM expense_categories WHERE name ILIKE $1 LIMIT 1", [`%${categoryName}%`]);
      categoryMatch = rows[0] || null;
    }

    const { rows: rules } = await pool.query(
      "SELECT * FROM approval_rules WHERE is_active = true AND min_amount <= $1 AND max_amount > $1 ORDER BY priority ASC",
      [amount]
    );

    let matchedRule = rules.length > 0 ? rules[0] : null;

    if (matchedRule && categoryMatch && matchedRule.category_ids && matchedRule.category_ids.length > 0) {
      const hasCategory = matchedRule.category_ids.includes(categoryMatch.id);
      if (!hasCategory) {
        const newMatched = rules.find((r: any) => !r.category_ids || r.category_ids.length === 0 || r.category_ids.includes(categoryMatch.id));
        matchedRule = newMatched || null;
      }
    }

    const issues: string[] = [];
    const suggestions: string[] = [];

    if (!matchedRule) {
      issues.push("未匹配到有效的审批规则");
      suggestions.push("请管理员检查审批规则配置");
    } else {
      const chain = matchedRule.approval_chain || [];
      for (const step of chain) {
        if (step.role) {
          const { rows: approvers } = await pool.query(
            "SELECT COUNT(*) as cnt FROM users WHERE role = $1 AND status = 'active'",
            [step.role]
          );
          if (parseInt(approvers[0].cnt) === 0) {
            issues.push(`审批步骤 ${step.step}（${step.label || step.role}）没有在职的审批人`);
            suggestions.push(`请管理员为角色"${step.role}"添加在职用户`);
          }
        }
        if (step.assignee_id) {
          const { rows: assignees } = await pool.query(
            "SELECT COUNT(*) as cnt FROM users WHERE id = $1 AND status = 'active'",
            [step.assignee_id]
          );
          if (parseInt(assignees[0].cnt) === 0) {
            issues.push(`审批步骤 ${step.step} 的指定审批人不存在或已禁用`);
          }
        }
      }
    }

    if (!categoryMatch && (categoryId || categoryName)) {
      issues.push("指定的费用类别不存在");
      suggestions.push("请使用系统已知的费用类别");
    }

    return successResult({
      valid: issues.length === 0,
      amount,
      category: categoryMatch ? { id: categoryMatch.id, name: categoryMatch.name } : null,
      matched_rule: matchedRule ? { name: matchedRule.name, amount_range: `${matchedRule.min_amount} - ${matchedRule.max_amount}`, approval_steps: matchedRule.approval_chain?.length || 0 } : null,
      issues,
      suggestions,
    });
  } catch (err: any) {
    return errorResult("INTERNAL_ERROR", err.message || "内部错误");
  }
}
```

- [ ] **Step 7: 创建 query-ontology.ts**

`packages/mcp/src/tools/query-ontology.ts`:

```typescript
import type { ToolDefinition, ToolResult } from "./types.js";
import { errorResult, successResult } from "./types.js";
import { resolveAuthContext } from "../auth.js";
import { OntologyEngine } from "@sse/ontology";
import { readFileSync, existsSync } from "fs";
import { join } from "path";

const CONFIG_PATH = join(process.cwd(), "ai-config.json");

function getEngine(): OntologyEngine {
  const defaults = { fillEngine: { endpoint: "http://localhost:11434/v1/chat/completions", model: "llama3.1:8b" } };
  let cfg = defaults;
  try { if (existsSync(CONFIG_PATH)) { const saved = JSON.parse(readFileSync(CONFIG_PATH, "utf-8")); cfg = { ...defaults, fillEngine: { ...defaults.fillEngine, ...(saved.fillEngine || {}) } }; } } catch { /* use defaults */ }
  return new OntologyEngine(cfg.fillEngine.endpoint, cfg.fillEngine.model);
}

export const definition: ToolDefinition = {
  name: "query_ontology",
  description: "查询本体图谱。可按类型过滤实体，获取全图谱数据，或获取统计概览。",
  inputSchema: {
    type: "object",
    properties: {
      type: { type: "string", description: "实体类型过滤（如 Person, Report, ExpenseItem），不填返回全图谱" },
      format: { type: "string", description: "返回格式: graph（图谱含节点和边）或 entities（仅实体列表）。默认 graph" },
    },
  },
};

export async function handler(args: Record<string, unknown>): Promise<ToolResult> {
  const auth = resolveAuthContext(args);
  if (!auth) return errorResult("UNAUTHORIZED", "无效或缺失 API key");

  try {
    const engine = getEngine();

    if (args.type && args.format !== "entities") {
      const entities = engine.store.queryByType(args.type as string);
      return successResult({ type: args.type, count: entities.length, entities });
    }

    const graph = engine.store.getGraph();

    const typeCounts: Record<string, number> = {};
    for (const node of graph.nodes) {
      typeCounts[node.type] = (typeCounts[node.type] || 0) + 1;
    }

    return successResult({
      summary: { total_nodes: graph.nodes.length, total_edges: graph.edges.length, type_counts: typeCounts },
      graph,
    });
  } catch (err: any) {
    return errorResult("INTERNAL_ERROR", err.message || "内部错误");
  }
}
```

- [ ] **Step 8: 注册工具到 server.ts**

修改 `packages/mcp/src/server.ts`，在现有 import 块末尾追加：

```typescript
import * as submitExpenseFromTextTool from "./tools/submit-expense-from-text.js";
import * as submitExpenseFromInvoiceTool from "./tools/submit-expense-from-invoice.js";
import * as queryExpenseStatusTool from "./tools/query-expense-status.js";
import * as explainDecisionTool from "./tools/explain-decision.js";
import * as getEntityNetworkTool from "./tools/get-entity-network.js";
import * as validateExpenseTool from "./tools/validate-expense.js";
import * as queryOntologyTool from "./tools/query-ontology.js";
```

修改 `allTools` 数组，在 `listPendingApprovalsTool,` 后追加：

```typescript
const allTools: ToolEntry[] = [
  searchExpensesTool,
  getExpenseDetailTool,
  getApprovalStatusTool,
  getStatisticsTool,
  getUserSummaryTool,
  listPendingApprovalsTool,
  submitExpenseFromTextTool,
  submitExpenseFromInvoiceTool,
  queryExpenseStatusTool,
  explainDecisionTool,
  getEntityNetworkTool,
  validateExpenseTool,
  queryOntologyTool,
];
```

- [ ] **Step 9: 编译验证**

```bash
pnpm --filter @sse/mcp build
```

Expected: PASS (13 tools registered)

- [ ] **Step 10: 提交**

```bash
git add packages/mcp/src/tools/ packages/mcp/src/server.ts
git commit -m "feat: add 7 ontology MCP tools - submit, query, explain, validate, network, ontology query"
```

---

### Task 4: API 扩展（/from-text, /graph, /entity, /relation）

**Files:**
- Modify: `packages/api/src/routes/ontology.ts`

- [ ] **Step 1: 新增 NL→图谱 和 CRUD 端点**

将 `packages/api/src/routes/ontology.ts` 替换为以下内容：

```typescript
import { Router, Request, Response, NextFunction } from 'express';
import { OntologyEngine } from '@sse/ontology';
import { authMiddleware } from '@sse/auth';
import { AppError } from '../middleware/error';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

const router = Router();
const CONFIG_PATH = join(process.cwd(), 'ai-config.json');

function loadAiConfig() {
  const defaults = { fillEngine: { endpoint: 'http://localhost:11434/v1/chat/completions', model: 'llama3.1:8b' } };
  try { if (existsSync(CONFIG_PATH)) { const saved = JSON.parse(readFileSync(CONFIG_PATH, 'utf-8')); return { ...defaults, fillEngine: { ...defaults.fillEngine, ...(saved.fillEngine || {}) } }; } } catch { /* use defaults */ }
  return defaults;
}

let engine: OntologyEngine;

function getEngine(): OntologyEngine {
  if (!engine) {
    const cfg = loadAiConfig();
    engine = new OntologyEngine(cfg.fillEngine.endpoint, cfg.fillEngine.model);
  }
  return engine;
}

function asyncWrap(fn: (req: Request, res: Response, next: NextFunction) => Promise<void>) {
  return (req: Request, res: Response, next: NextFunction) => { Promise.resolve(fn(req, res, next)).catch(next); };
}

router.use(authMiddleware);

router.post('/submit-from-text', asyncWrap(async (req, res) => {
  const { text } = req.body;
  if (!text) throw new AppError(400, 'INVALID_PARAMS', '请提供 text');
  const result = await getEngine().submitFromText(text, req.user!.userId, req.headers.authorization?.split(' ')[1] || '');
  res.json(result);
}));

router.get('/sync', asyncWrap(async (_req, res) => {
  await getEngine().mapper.syncAll();
  res.json({ message: '本体同步完成' });
}));

router.get('/query', asyncWrap(async (req, res) => {
  const type = req.query.type as string;
  if (!type) throw new AppError(400, 'INVALID_PARAMS', '请提供 type 参数');
  res.json(getEngine().store.queryByType(type));
}));

router.get('/graph', asyncWrap(async (_req, res) => {
  const graph = getEngine().store.getGraph();
  res.json(graph);
}));

router.post('/from-text', asyncWrap(async (req, res) => {
  const { text } = req.body;
  if (!text) throw new AppError(400, 'INVALID_PARAMS', '请提供 text 描述');

  const extraction = await getEngine().extractor.extractGraph(text);

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

  const graph = store.getGraph();
  res.json({ entities_added: extraction.entities.length, relations_added: extraction.relations.length, graph });
}));

router.put('/entity', asyncWrap(async (req, res) => {
  const { uri, type, properties } = req.body;
  if (!uri || !type) throw new AppError(400, 'INVALID_PARAMS', '请提供 uri 和 type');
  const store = getEngine().store;
  store.deleteEntity(uri);
  store.addEntity(uri, type, properties || {});
  res.json({ message: '实体已保存', uri });
}));

router.delete('/entity', asyncWrap(async (req, res) => {
  const uri = req.query.uri as string;
  if (!uri) throw new AppError(400, 'INVALID_PARAMS', '请提供 uri 参数');
  getEngine().store.deleteEntity(uri);
  res.json({ message: '实体已删除' });
}));

router.post('/relation', asyncWrap(async (req, res) => {
  const { from, to, predicate } = req.body;
  if (!from || !to || !predicate) throw new AppError(400, 'INVALID_PARAMS', '请提供 from、to 和 predicate');
  getEngine().store.addRelation(from, predicate, to);
  res.json({ message: '关系已添加', from, predicate, to });
}));

router.delete('/relation', asyncWrap(async (req, res) => {
  const { from, to, predicate } = req.body;
  if (!from || !to || !predicate) throw new AppError(400, 'INVALID_PARAMS', '请提供 from、to 和 predicate');
  getEngine().store.deleteRelation(from, predicate, to);
  res.json({ message: '关系已删除' });
}));

export { router as ontologyRoutes };
```

- [ ] **Step 2: 编译验证**

```bash
pnpm --filter @sse/api build
```

Expected: PASS

- [ ] **Step 3: 提交**

```bash
git add packages/api/src/routes/ontology.ts
git commit -m "feat: add ontology API endpoints - from-text, graph, entity/relation CRUD"
```

---

### Task 5: 前端本体可视化页面

**Files:**
- Create: `packages/web/src/pages/Ontology.vue`
- Modify: `packages/web/src/router/index.ts`
- Modify: `packages/web/src/layouts/DefaultLayout.vue`

- [ ] **Step 1: 安装 cytoscape**

```bash
pnpm --filter @sse/web add cytoscape
```

Expected: cytoscape installed

- [ ] **Step 2: 创建 Ontology.vue**

`packages/web/src/pages/Ontology.vue`:

```vue
<template>
  <div class="ontology-page">
    <div class="page-header">
      <h2 class="page-header-title">本体可视化</h2>
      <div class="header-spacer"></div>
      <button class="btn-secondary btn-sm" @click="syncFromDB" :disabled="syncing">🔄 从数据库同步</button>
      <button class="btn-secondary btn-sm" @click="exportTurtle">📥 导出 Turtle</button>
    </div>

    <!-- NL 输入区 -->
    <div class="card nl-input-section">
      <label>自然语言描述（描述实体和关系）</label>
      <div class="nl-input-row">
        <input
          v-model="nlText"
          placeholder='例如：张三属于技术部，提交了报销单RE-001，包含住宿费2000元，由李四审批'
          @keyup.enter="generateFromText"
        />
        <button class="btn-primary btn-sm" @click="generateFromText" :disabled="generating || !nlText.trim()">
          {{ generating ? '生成中...' : '✨ 生成本体' }}
        </button>
      </div>
    </div>

    <!-- 手动添加 -->
    <div v-if="showManualAdd" class="card manual-add-section">
      <!-- 添加节点 -->
      <div class="manual-row">
        <input v-model="newNodeUri" placeholder="URI (如 person/zhangsan)" class="input-sm" />
        <input v-model="newNodeType" placeholder="类型 (如 Person)" class="input-sm" />
        <input v-model="newNodeProps" placeholder="属性 (JSON, 如 {\"name\":\"张三\"})" class="input-sm" />
        <button class="btn-secondary btn-sm" @click="addNode">+ 添加节点</button>
      </div>
      <!-- 添加关系 -->
      <div class="manual-row" style="margin-top:8px">
        <input v-model="newRelFrom" placeholder="来源 URI" class="input-sm" />
        <input v-model="newRelPredicate" placeholder="关系 (如 submittedBy)" class="input-sm" />
        <input v-model="newRelTo" placeholder="目标 URI" class="input-sm" />
        <button class="btn-secondary btn-sm" @click="addRelation">+ 添加关系</button>
      </div>
    </div>
    <div class="toolbar-row">
      <button class="btn-text btn-sm" @click="showManualAdd = !showManualAdd">
        {{ showManualAdd ? '收起手动添加' : '+ 手动添加' }}
      </button>
      <span class="text-muted" style="font-size:0.78rem">节点: {{ graph.nodes.length }} · 边: {{ graph.edges.length }}</span>
    </div>

    <!-- Cytoscape 图 -->
    <div class="card graph-container" ref="graphContainer" v-loading="loading"></div>

    <!-- 属性面板 -->
    <div v-if="selectedNode" class="card properties-panel">
      <h4>属性面板 — {{ selectedNode.label }}</h4>
      <div class="prop-item"><span class="prop-label">URI：</span>{{ selectedNode.id }}</div>
      <div class="prop-item"><span class="prop-label">类型：</span>{{ selectedNode.type }}</div>
      <div v-for="(val, key) in selectedNode.properties" :key="key" class="prop-item prop-editable">
        <span class="prop-label">{{ key }}：</span>
        <input v-model="selectedNode.properties[key]" class="input-sm" />
      </div>
      <div class="prop-actions">
        <button class="btn-primary btn-sm" @click="saveNode">保存修改</button>
        <button class="btn-danger btn-sm" @click="deleteSelectedNode">删除节点</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, nextTick } from 'vue'
import api from '../api/index'
import cytoscape, { type Core, type NodeSingular } from 'cytoscape'

const graphContainer = ref<HTMLElement | null>(null)
const graph = ref<{ nodes: any[]; edges: any[] }>({ nodes: [], edges: [] })
const selectedNode = ref<any>(null)
const loading = ref(false)
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

const RDF_TYPE = 'rdf_type'
const COLORS: Record<string, string> = {
  Person: '#f97316', Department: '#6366f1', Company: '#a855f7',
  Report: '#10b981', DraftReport: '#94a3b8', PendingReport: '#f59e0b',
  ApprovedReport: '#10b981', ExpenseItem: '#3b82f6', Invoice: '#ef4444',
  ApprovalRule: '#ec4899', Approver: '#14b8a6', Unknown: '#6b7280',
}

function buildCyElements() {
  const nodes = graph.value.nodes.map(n => ({
    data: {
      id: n.id,
      label: n.label,
      type: n.type,
      properties: JSON.stringify(n.properties),
      color: COLORS[n.type] || COLORS.Unknown,
    },
  }))
  const edges = graph.value.edges.map(e => ({
    data: {
      id: e.id,
      source: e.from,
      target: e.to,
      label: e.label,
    },
  }))
  return { nodes, edges }
}

function initCytoscape() {
  if (!graphContainer.value) return
  if (cy) cy.destroy()

  const elements = buildCyElements()
  cy = cytoscape({
    container: graphContainer.value,
    elements,
    style: [
      { selector: 'node', style: { 'label': 'data(label)', 'background-color': 'data(color)', 'color': '#fff', 'text-valign': 'bottom', 'text-halign': 'center', 'font-size': '11px', 'text-margin-y': 6, 'shape': (ele: any) => ele.data('type')?.includes('Report') ? 'round-rectangle' : 'ellipse', 'width': 50, 'height': 50 } },
      { selector: 'edge', style: { 'label': 'data(label)', 'curve-style': 'bezier', 'line-color': '#94a3b8', 'target-arrow-color': '#94a3b8', 'target-arrow-shape': 'triangle', 'width': 1.5, 'font-size': '9px', 'color': '#64748b', 'text-rotation': 'autorotate' } },
    ],
    layout: { name: 'cose', animate: false, padding: 40 },
    minZoom: 0.2,
    maxZoom: 3,
  })

  cy.on('tap', 'node', (evt) => {
    const node = evt.target as NodeSingular
    const data = node.data()
    let props: Record<string, string> = {}
    try { props = JSON.parse(data.properties || '{}') } catch { /* fallback */ }
    selectedNode.value = { id: data.id, label: data.label, type: data.type, properties: props }
  })

  cy.on('tap', (evt) => {
    if (evt.target === cy) selectedNode.value = null
  })
}

async function fetchGraph() {
  loading.value = true
  try {
    const res = await api.get('/ontology/graph')
    graph.value = res.data
    await nextTick()
    initCytoscape()
  } catch (err: any) { console.error('加载图谱失败', err) }
  finally { loading.value = false }
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
    await api.put('/ontology/entity', { uri: selectedNode.value.id, type: selectedNode.value.type, properties: selectedNode.value.properties })
    alert('保存成功')
  } catch (err: any) { alert('保存失败: ' + (err.response?.data?.message || err.message)) }
}

async function deleteSelectedNode() {
  if (!selectedNode.value) return
  if (!confirm('确定删除此节点及其所有关系？')) return
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
  if (!newRelFrom.value || !newRelTo.value || !newRelPredicate.value) { alert('请填写来源、目标和关系'); return }
  try {
    await api.post('/ontology/relation', { from: newRelFrom.value, to: newRelTo.value, predicate: newRelPredicate.value })
    newRelFrom.value = ''; newRelTo.value = ''; newRelPredicate.value = ''
    await fetchGraph()
  } catch (err: any) { alert('添加失败: ' + (err.response?.data?.message || err.message)) }
}

function exportTurtle() {
  alert('Turtle 导出功能: 前端无法直接访问文件系统，请调用 GET /ontology/graph 后自行转换。')
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
.input-sm { height: 32px; font-size: 0.82rem; padding: 0 8px; border: 1px solid var(--border-color); border-radius: var(--radius-sm); background: var(--bg-card); color: var(--text-primary); }
.toolbar-row { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; }
.graph-container { height: 520px; padding: 0; overflow: hidden; border-radius: var(--radius-md); position: relative; }
.graph-container :deep(.el-loading-mask) { border-radius: var(--radius-md); }
.properties-panel { margin-top: 12px; padding: 16px 20px; }
.properties-panel h4 { margin: 0 0 10px; font-size: 0.95rem; color: var(--accent-coral); }
.prop-item { margin-bottom: 6px; font-size: 0.85rem; display: flex; align-items: center; }
.prop-label { font-weight: 600; color: var(--text-secondary); min-width: 70px; }
.prop-editable input { flex: 1; }
.prop-actions { margin-top: 12px; display: flex; gap: 8px; }
</style>
```

- [ ] **Step 3: 添加路由**

修改 `packages/web/src/router/index.ts`，在 `admin/messages` 路由后追加：

```typescript
  {
    path: '/ontology',
    name: 'ontology',
    component: () => import('../pages/Ontology.vue'),
    meta: { title: '本体可视化', icon: 'Share' },
  },
```

- [ ] **Step 4: 添加侧边栏菜单**

修改 `packages/web/src/layouts/DefaultLayout.vue`，在 `navItems` 数组的 admin 部分末尾追加：

```typescript
  { path: '/ontology', label: '本体可视化' },
```

- [ ] **Step 5: 编译验证**

```bash
pnpm --filter @sse/web build
```

Expected: PASS (新依赖 cytoscape 的 Vue SFC 编译通过)

- [ ] **Step 6: 提交**

```bash
git add packages/web/src/pages/Ontology.vue packages/web/src/router/index.ts packages/web/src/layouts/DefaultLayout.vue packages/web/package.json pnpm-lock.yaml
git commit -m "feat: add ontology visualization page with Cytoscape.js graph and NL-to-graph generation"
```

---

### Task 6: 集成验证

- [ ] **Step 1: 全量编译**

```bash
pnpm build
```

Expected: ALL packages pass

- [ ] **Step 2: 启动 API 测试端点**

```bash
pnpm --filter @sse/api dev
```

测试 NL→图谱：

```bash
curl -X POST http://localhost:3000/ontology/from-text -H 'Content-Type: application/json' -H 'Authorization: Bearer <TOKEN>' -d '{"text":"张三属于技术部，提交了报销单RE-001，包含住宿费2000元，由李四审批"}'
```

Expected: 返回 entities_added 和 relations_added > 0

- [ ] **Step 3: 提交**

```bash
git add -A && git commit -m "chore: integration verification for ontology MCP tools and visualization"
```

---

> **全部任务完成后应可：启动 API → 前端 /ontology 页面看到图谱 → NL 输入生成本体 → MCP 工具可调用**
