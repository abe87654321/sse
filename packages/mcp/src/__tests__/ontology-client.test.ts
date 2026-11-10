import { ontologyClient } from "../tools/ontology-client";
import type { AuthContext } from "../auth";

const auth: AuthContext = { userId: "u1", role: "employee", department: "D" };

const originalFetch = global.fetch;

function mockFetch(status: number, body: unknown) {
  const fn = jest.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  });
  (global as any).fetch = fn;
  return fn;
}

afterEach(() => {
  if (originalFetch) {
    global.fetch = originalFetch;
  } else {
    delete (global as any).fetch;
  }
  jest.restoreAllMocks();
});

describe("ontologyClient", () => {
  it("sends signed auth and maps API errors", async () => {
    const fetchMock = mockFetch(403, { error: { code: "FORBIDDEN", message: "nope" } });

    const res = await ontologyClient(auth).getStatus();

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/ontology/status"),
      expect.objectContaining({
        method: "GET",
        headers: expect.objectContaining({
          Authorization: expect.stringContaining("Bearer "),
        }),
      }),
    );
    expect(res.ok).toBe(false);
    expect(res.status).toBe(403);
    expect(res.data.error.code).toBe("FORBIDDEN");
  });

  it("returns successful status/schema payloads", async () => {
    mockFetch(200, { version: 1 });

    const res = await ontologyClient(auth).getStatus();

    expect(res.ok).toBe(true);
    expect(res.status).toBe(200);
    expect(res.data).toEqual({ version: 1 });
  });

  it("posts typed searches to /ontology/query", async () => {
    const fetchMock = mockFetch(200, { results: [], total: 0 });

    const res = await ontologyClient(auth).search({ type: "Person", page: 2 });

    expect(res.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/ontology/query"),
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ type: "Person", page: 2 }),
      }),
    );
  });

  it("lists entities with a query string and skips empty values", async () => {
    const fetchMock = mockFetch(200, []);

    await ontologyClient(auth).listEntities({ type: "Person", status: undefined, q: "" });

    const [url] = fetchMock.mock.calls[0];
    expect(url).toContain("/ontology/entities?");
    expect(url).toContain("type=Person");
    expect(url).not.toContain("status=");
    expect(url).not.toContain("q=");
  });

  it("encodes entity URIs and forwards network depth/direction", async () => {
    const fetchMock = mockFetch(200, { nodes: [], edges: [] });
    const uri = "https://sse.local/report/r1";

    await ontologyClient(auth).network(uri, 3, "out");

    const [url] = fetchMock.mock.calls[0];
    expect(url).toContain(`/ontology/entities/${encodeURIComponent(uri)}/network`);
    expect(url).toContain("depth=3");
    expect(url).toContain("direction=out");
  });

  it("gets a single entity", async () => {
    const fetchMock = mockFetch(200, { uri: "x" });
    const uri = "https://sse.local/person/p1";

    await ontologyClient(auth).getEntity(uri);

    expect(fetchMock.mock.calls[0][0]).toContain(
      `/ontology/entities/${encodeURIComponent(uri)}`,
    );
  });

  it("posts SPARQL and validation/analysis payloads", async () => {
    const fetchMock = mockFetch(200, { results: [] });
    const client = ontologyClient(auth);

    await client.sparql("SELECT * WHERE { ?s ?p ?o }");
    await client.validate({ amount: 10 });
    await client.explain("r1");
    await client.impact({ department: "研发" });

    const calls = fetchMock.mock.calls.map(([url, init]: any) => ({ url, ...init }));
    expect(calls[0]).toMatchObject({
      url: expect.stringContaining("/ontology/sparql"),
      method: "POST",
      body: JSON.stringify({ query: "SELECT * WHERE { ?s ?p ?o }" }),
    });
    expect(calls[1]).toMatchObject({
      url: expect.stringContaining("/ontology/validate"),
      method: "POST",
      body: JSON.stringify({ amount: 10 }),
    });
    expect(calls[2]).toMatchObject({
      url: expect.stringContaining("/ontology/explain"),
      method: "POST",
      body: JSON.stringify({ report_id: "r1" }),
    });
    expect(calls[3]).toMatchObject({
      url: expect.stringContaining("/ontology/impact"),
      method: "POST",
      body: JSON.stringify({ department: "研发" }),
    });
  });

  it("serializes anomaly codes and limit into the query string", async () => {
    const fetchMock = mockFetch(200, { anomalies: [], summary: { total: 0 } });

    await ontologyClient(auth).anomalies({
      codes: ["amount_mismatch", "missing_approver"],
      limit: 5,
    });

    const [url] = fetchMock.mock.calls[0];
    expect(url).toContain("/ontology/anomalies?");
    expect(url).toContain("codes=amount_mismatch%2Cmissing_approver");
    expect(url).toContain("limit=5");
  });
});
