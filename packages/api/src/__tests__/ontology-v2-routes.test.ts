import express from 'express';
import type { AddressInfo } from 'net';
import type { Server } from 'http';
import { signToken } from '@sse/auth';
import { MemoryGraphStore, loadTBox, setGraphContext } from '@sse/ontology';
import {
  ontologyV2Routes,
  ontologyV2UnavailableRoutes,
} from '../routes/ontology-v2';
import { errorHandler } from '../middleware/error';

const SSE = 'https://sse.local/ontology#';
const RDF = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#';
const DATA = 'urn:sse:data';

const NQ = `
<https://sse.local/report/r1> <${RDF}type> <${SSE}ExpenseReport> <${DATA}> .
<https://sse.local/report/r1> <${SSE}status> "pending" <${DATA}> .
<https://sse.local/report/r1> <${SSE}amount> "11"^^<http://www.w3.org/2001/XMLSchema#decimal> <${DATA}> .
<https://sse.local/report/r1> <${SSE}submittedBy> <https://sse.local/person/p1> <${DATA}> .
<https://sse.local/report/r1> <${SSE}containsItem> <https://sse.local/item/i1> <${DATA}> .

<https://sse.local/report/r2> <${RDF}type> <${SSE}ExpenseReport> <${DATA}> .
<https://sse.local/report/r2> <${SSE}status> "pending" <${DATA}> .
<https://sse.local/report/r2> <${SSE}submittedBy> <https://sse.local/person/p2> <${DATA}> .

<https://sse.local/person/p1> <${RDF}type> <${SSE}Person> <${DATA}> .
<https://sse.local/person/p1> <${SSE}name> "张三" <${DATA}> .
<https://sse.local/person/p1> <${SSE}belongsTo> <https://sse.local/dept/tech> <${DATA}> .
<https://sse.local/person/p2> <${RDF}type> <${SSE}Person> <${DATA}> .
<https://sse.local/person/p2> <${SSE}name> "李四" <${DATA}> .
<https://sse.local/person/p2> <${SSE}belongsTo> <https://sse.local/dept/sales> <${DATA}> .

<https://sse.local/dept/tech> <${RDF}type> <${SSE}Department> <${DATA}> .
<https://sse.local/dept/tech> <${SSE}name> "技术部" <${DATA}> .
<https://sse.local/dept/sales> <${RDF}type> <${SSE}Department> <${DATA}> .
<https://sse.local/dept/sales> <${SSE}name> "销售部" <${DATA}> .

<https://sse.local/item/i1> <${RDF}type> <${SSE}ExpenseItem> <${DATA}> .
<https://sse.local/item/i1> <${SSE}amount> "10" <${DATA}> .

<https://sse.local/invoice/v1> <${RDF}type> <${SSE}Invoice> <${DATA}> .
<https://sse.local/invoice/v1> <${SSE}invoiceNo> "INV-DUP" <${DATA}> .
<https://sse.local/invoice/v2> <${RDF}type> <${SSE}Invoice> <${DATA}> .
<https://sse.local/invoice/v2> <${SSE}invoiceNo> "INV-DUP" <${DATA}> .

<https://sse.local/report/deleted> <${RDF}type> <${SSE}ExpenseReport> <urn:sse:history> .
<https://sse.local/report/deleted> <${SSE}deletedAt> "2026-11-01T00:00:00Z" <urn:sse:history> .
`;

const adminToken = signToken({ userId: 'admin', role: 'admin', department: '管理部' });
const employeeToken = signToken({ userId: 'p1', role: 'employee', department: '技术部' });

function listen(app: express.Express): Promise<{ url: string; server: Server }> {
  return new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      resolve({ url: `http://127.0.0.1:${port}`, server });
    });
  });
}

function close(server: Server): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()));
}

describe('ontology v2 routes', () => {
  let url: string;
  let server: Server;

  beforeAll(async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});

    const store = new MemoryGraphStore();
    await loadTBox(store);
    await store.load(NQ);
    const pool = {
      query: async (sql: string) => {
        if (sql.includes('ontology_projector_state')) {
          return { rows: [{ last_snapshot_version: '3' }] };
        }
        if (sql.includes('FROM expense_categories')) {
          return { rows: [{ id: 'c1', name: '差旅' }] };
        }
        if (sql.includes('FROM approval_rules')) {
          return {
            rows: [{
              id: 'db-rule',
              name: 'DB 规则',
              min_amount: '0',
              max_amount: '1000',
              category_ids: [],
              approval_chain: [{ step: 1, role: 'finance' }],
              priority: 1,
            }],
          };
        }
        if (sql.includes('FROM users')) {
          return { rows: [{ cnt: '1' }] };
        }
        return {
          rows: [{ pending: '1', dead_lettered: '0', lag_seconds: '2', last_error: null }],
        };
      },
    };
    setGraphContext(store, pool);

    const app = express();
    app.use(express.json());
    app.use('/ontology', ontologyV2Routes);
    app.use(errorHandler);
    ({ url, server } = await listen(app));
  });

  afterAll(async () => {
    await close(server);
    (console.error as jest.Mock).mockRestore();
  });

  function get(path: string, token?: string) {
    return fetch(`${url}${path}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
  }

  function post(path: string, body: unknown, token?: string) {
    return fetch(`${url}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
    });
  }

  it('rejects unauthenticated requests', async () => {
    const res = await get('/ontology/status');
    expect(res.status).toBe(401);
  });

  it('returns the shared status shape', async () => {
    const res = await get('/ontology/status', adminToken);
    expect(res.status).toBe(200);
    const body: any = await res.json();
    expect(body.engine).toBe('oxigraph');
    expect(body.version).toBe(3);
    expect(body.counts.quads).toBeGreaterThan(0);
    expect(body.outbox).toEqual({
      pending: 1,
      deadLettered: 0,
      oldestPendingAgeSeconds: 2,
      lastError: null,
    });
  });

  it('returns the scoped graph snapshot with a legacy summary', async () => {
    const res = await get('/ontology/graph', adminToken);
    expect(res.status).toBe(200);
    const body: any = await res.json();

    expect(body.summary.total_nodes).toBe(body.graph.nodes.length);
    expect(body.summary.total_edges).toBe(body.graph.edges.length);
    expect(body.summary.type_counts.ExpenseReport).toBe(2);
    expect(body.summary.type_counts.Invoice).toBe(2);
    for (const node of body.graph.nodes) {
      expect(node.id).toBe(node.uri);
      expect(node).toHaveProperty('type');
      expect(node).toHaveProperty('properties');
    }
    expect(body.graph.nodes.map((node: any) => node.uri)).not.toContain(
      'https://sse.local/report/deleted',
    );
  });

  it('scopes the graph snapshot to the caller', async () => {
    const res = await get('/ontology/graph', employeeToken);
    expect(res.status).toBe(200);
    const body: any = await res.json();
    const uris = body.graph.nodes.map((node: any) => node.uri);

    expect(uris).toContain('https://sse.local/report/r1');
    expect(uris).not.toContain('https://sse.local/report/r2');
    expect(uris).not.toContain('https://sse.local/person/p2');
  });

  it('keeps the legacy array shape when type is supplied', async () => {
    const res = await get('/ontology/entities?type=ExpenseReport', adminToken);
    expect(res.status).toBe(200);
    const body: any = await res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body.map((entity: any) => entity.uri)).toEqual([
      'https://sse.local/report/r1',
      'https://sse.local/report/r2',
    ]);
    expect(body[0]).toHaveProperty('properties');
    expect(body[0]).not.toHaveProperty('total');
  });

  it('returns paged reports without a legacy type filter', async () => {
    const res = await post('/ontology/query', { page: 2, pageSize: 2 }, adminToken);
    expect(res.status).toBe(200);
    const body: any = await res.json();
    expect(body.total).toBe(2);
    expect(body.results).toEqual([]);
  });

  it('applies scope to entity reads', async () => {
    const outOfScope = await get(
      `/ontology/entities/${encodeURIComponent('https://sse.local/report/r2')}`,
      employeeToken,
    );
    expect(outOfScope.status).toBe(404);

    const ownItem = await get(
      `/ontology/entities/${encodeURIComponent('https://sse.local/item/i1')}`,
      employeeToken,
    );
    expect(ownItem.status).toBe(200);
    expect((await ownItem.json()) as any).toMatchObject({
      uri: 'https://sse.local/item/i1',
      type: 'ExpenseItem',
    });
  });

  it('returns 404 when a network root is out of scope', async () => {
    const res = await get(
      `/ontology/entities/${encodeURIComponent('https://sse.local/report/r2')}/network`,
      employeeToken,
    );
    expect(res.status).toBe(404);
    expect(((await res.json()) as any).error.code).toBe('NOT_FOUND');
  });

  it('walks an in-scope network', async () => {
    const res = await get(
      `/ontology/entities/${encodeURIComponent('https://sse.local/report/r1')}/network`,
      employeeToken,
    );
    expect(res.status).toBe(200);
    const body: any = await res.json();
    expect(body.nodes.map((node: any) => node.uri)).toContain('https://sse.local/report/r1');
    expect(body.nodes.map((node: any) => node.uri)).toContain('https://sse.local/item/i1');
  });

  it('maps invalid types to INVALID_PARAMS', async () => {
    const res = await get('/ontology/entities?type=bad-type!', adminToken);
    expect(res.status).toBe(400);
    expect(((await res.json()) as any).error.code).toBe('INVALID_PARAMS');
  });

  it('validates through the graph/DB fallback', async () => {
    const res = await post('/ontology/validate', { amount: 100 }, adminToken);
    expect(res.status).toBe(200);
    const body: any = await res.json();
    expect(body.source).toBe('db-fallback');
    expect(body.valid).toBe(true);
    expect(body.matched_rule.name).toBe('DB 规则');
  });

  it('explains a report with evidence URIs', async () => {
    const res = await post('/ontology/explain', { report_id: 'r1' }, adminToken);
    expect(res.status).toBe(200);
    const body: any = await res.json();
    expect(body.report).toBe('https://sse.local/report/r1');
    expect(body.evidenceUris).toContain('https://sse.local/report/r1');
    expect(body.why.length).toBeGreaterThan(0);
  });

  it('enforces scope on explain', async () => {
    const res = await post('/ontology/explain', { report_id: 'r2' }, employeeToken);
    expect(res.status).toBe(404);
  });

  it('analyzes impact without writing', async () => {
    const res = await post('/ontology/impact', { department: '技术部' }, adminToken);
    expect(res.status).toBe(200);
    const body: any = await res.json();
    expect(body.affected_reports.map((report: any) => report.uri)).toEqual([
      'https://sse.local/report/r1',
    ]);
    expect(body.hypothetical).toBe(false);
  });

  it('returns real anomalies with a summary', async () => {
    const res = await get('/ontology/anomalies', adminToken);
    expect(res.status).toBe(200);
    const body: any = await res.json();
    const codes = body.anomalies.map((anomaly: any) => anomaly.code);
    expect(codes).toContain('amount_mismatch');
    expect(codes).toContain('duplicate_invoice_no');
    expect(body.summary.total).toBe(body.anomalies.length);
  });

  it('filters anomalies by codes and recomputes the summary', async () => {
    const res = await get('/ontology/anomalies?codes=amount_mismatch', adminToken);
    expect(res.status).toBe(200);
    const body: any = await res.json();
    expect(body.anomalies.map((anomaly: any) => anomaly.code)).toEqual(['amount_mismatch']);
    expect(body.summary.total).toBe(1);
    expect(body.summary.byCode).toEqual({ amount_mismatch: 1 });
  });

  it('accepts repeated codes query params', async () => {
    const res = await get(
      '/ontology/anomalies?codes=amount_mismatch&codes=duplicate_invoice_no',
      adminToken,
    );
    expect(res.status).toBe(200);
    const body: any = await res.json();
    expect(new Set(body.anomalies.map((anomaly: any) => anomaly.code))).toEqual(
      new Set(['amount_mismatch', 'duplicate_invoice_no']),
    );
  });

  it('returns 503 for v2 routes when the platform is disabled', async () => {
    const app = express();
    app.use('/ontology', ontologyV2UnavailableRoutes);
    const offline = await listen(app);
    try {
      const res = await fetch(`${offline.url}/ontology/status`);
      expect(res.status).toBe(503);
      expect(((await res.json()) as any).error.code).toBe('ONTOLOGY_V2_UNAVAILABLE');
    } finally {
      await close(offline.server);
    }
  });
});
