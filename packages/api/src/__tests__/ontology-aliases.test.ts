import express from 'express';
import type { AddressInfo } from 'net';
import type { Server } from 'http';
import { signToken } from '@sse/auth';
import { MemoryGraphStore, loadTBox, setGraphContext } from '@sse/ontology';
import { ontologyRoutes } from '../routes/ontology';
import { errorHandler } from '../middleware/error';

const SSE = 'https://sse.local/ontology#';
const RDF = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#';
const DATA = 'urn:sse:data';

const NQ = `
<https://sse.local/report/r1> <${RDF}type> <${SSE}ExpenseReport> <${DATA}> .
<https://sse.local/report/r1> <${SSE}status> "pending" <${DATA}> .
<https://sse.local/report/r1> <${SSE}serialNo> "RE-1" <${DATA}> .
<https://sse.local/report/r1> <${SSE}submittedBy> <https://sse.local/person/p1> <${DATA}> .
<https://sse.local/person/p1> <${RDF}type> <${SSE}Person> <${DATA}> .
<https://sse.local/person/p1> <${SSE}name> "张三" <${DATA}> .
<https://sse.local/person/p1> <${SSE}belongsTo> <https://sse.local/dept/tech> <${DATA}> .
<https://sse.local/dept/tech> <${RDF}type> <${SSE}Department> <${DATA}> .
<https://sse.local/dept/tech> <${SSE}name> "技术部" <${DATA}> .
`;

const adminToken = signToken({ userId: 'admin', role: 'admin', department: '管理部' });

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

describe('legacy ontology aliases', () => {
  const original = process.env.ONTOLOGY_V2;
  let url: string;
  let server: Server;
  let store: MemoryGraphStore;

  beforeAll(async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});

    store = new MemoryGraphStore();
    await loadTBox(store);
    await store.load(NQ);

    const pool = {
      query: async (sql: string) => {
        if (sql.includes('nextval')) return { rows: [{ version: '1' }] };
        if (sql.includes('MAX(id)')) return { rows: [{ max_id: '0' }] };
        if (sql.includes('ontology_projector_state')) {
          return { rows: [{ last_outbox_id: '0', last_snapshot_version: '0' }] };
        }
        return { rows: [] };
      },
    };
    setGraphContext(store, pool);

    const app = express();
    app.use(express.json());
    app.use('/ontology', ontologyRoutes);
    app.use(errorHandler);
    ({ url, server } = await listen(app));
  });

  afterAll(async () => {
    process.env.ONTOLOGY_V2 = original;
    await close(server);
    (console.error as jest.Mock).mockRestore();
  });

  function get(path: string) {
    return fetch(`${url}${path}`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
  }

  it('serves v2 entities from /ontology/query when the flag is on', async () => {
    process.env.ONTOLOGY_V2 = 'on';
    const res = await get('/ontology/query?type=ExpenseReport');
    expect(res.status).toBe(200);
    const body: any = await res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body).toEqual([
      {
        uri: 'https://sse.local/report/r1',
        properties: expect.objectContaining({
          serialNo: 'RE-1',
          status: 'pending',
        }),
      },
    ]);
  });

  it('falls back to the legacy /ontology/query when the flag is off', async () => {
    process.env.ONTOLOGY_V2 = '0';
    const res = await get('/ontology/query?type=ExpenseReport');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
  });

  it('serves the v2 graph shape from /ontology/graph when the flag is on', async () => {
    process.env.ONTOLOGY_V2 = 'on';
    const res = await get('/ontology/graph');
    expect(res.status).toBe(200);
    const body: any = await res.json();
    expect(body.summary.total_nodes).toBe(body.graph.nodes.length);
    expect(body.summary.type_counts.ExpenseReport).toBe(1);
    expect(body.graph.nodes.map((node: any) => node.uri)).toContain(
      'https://sse.local/report/r1',
    );
  });

  it('falls back to the legacy graph shape when the flag is off', async () => {
    process.env.ONTOLOGY_V2 = '0';
    const res = await get('/ontology/graph');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ nodes: [], edges: [] });
  });

  it('starts a reconcile job from /ontology/sync when the flag is on', async () => {
    process.env.ONTOLOGY_V2 = 'on';
    const res = await get('/ontology/sync');
    expect(res.status).toBe(202);
    const body: any = await res.json();
    expect(body.job_id).toEqual(expect.any(String));
    expect(body.state).toBe('running');
  });
});
