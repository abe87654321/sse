jest.mock("@sse/db", () => ({
  pool: { query: jest.fn() },
}));

import { pool } from "@sse/db";
import { registerApiKey } from "../auth";
import {
  definition as queryOntologyDef,
  handler as queryOntology,
} from "../tools/query-ontology";
import {
  definition as getEntityNetworkDef,
  handler as getEntityNetwork,
} from "../tools/get-entity-network";
import {
  definition as querySparqlDef,
  handler as querySparql,
} from "../tools/query-sparql";
import {
  definition as validateExpenseDef,
  handler as validateExpense,
} from "../tools/validate-expense";

const dbQuery = (pool as any).query as jest.Mock;
const originalFetch = global.fetch;

const EMPLOYEE_KEY = "emp-key";
const ADMIN_KEY = "admin-key";

registerApiKey(EMPLOYEE_KEY, { userId: "u1", role: "employee", department: "研发" });
registerApiKey(ADMIN_KEY, { userId: "a1", role: "admin", department: "管理部" });

function mockFetch(status: number, body: unknown) {
  const fn = jest.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  });
  (global as any).fetch = fn;
  return fn;
}

function payload(result: { content: Array<{ text: string }> }): any {
  return JSON.parse(result.content[0].text);
}

beforeEach(() => {
  dbQuery.mockReset();
});

afterEach(() => {
  if (originalFetch) global.fetch = originalFetch;
  else delete (global as any).fetch;
  jest.restoreAllMocks();
});

describe("query_ontology", () => {
  it("keeps the legacy { type } shape via GET /ontology/entities", async () => {
    const entities = [{ uri: "https://sse.local/person/p1", properties: { name: "张三" } }];
    const fetchMock = mockFetch(200, entities);

    const res = await queryOntology({ api_key: EMPLOYEE_KEY, type: "Person" });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain("/ontology/entities?");
    expect(url).toContain("type=Person");
    expect(init).toMatchObject({ method: "GET" });
    expect(payload(res)).toEqual({ type: "Person", count: 1, entities });
  });

  it("posts richer filters to /ontology/query", async () => {
    const data = { results: [{ uri: "x" }], total: 1 };
    const fetchMock = mockFetch(200, data);

    const res = await queryOntology({
      api_key: EMPLOYEE_KEY,
      status: "pending",
      department: "研发",
      q: "差旅",
      page: 2,
      page_size: 5,
    });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain("/ontology/query");
    expect(init).toMatchObject({ method: "POST" });
    expect(JSON.parse(init.body)).toEqual({
      status: "pending",
      department: "研发",
      q: "差旅",
      page: 2,
      page_size: 5,
    });
    expect(payload(res)).toEqual(data);
  });

  it("maps API errors to errorResult", async () => {
    mockFetch(403, { error: { code: "FORBIDDEN", message: "nope" } });

    const res = await queryOntology({ api_key: EMPLOYEE_KEY, type: "Person" });

    expect(res.isError).toBe(true);
    expect(payload(res).error.code).toBe("FORBIDDEN");
  });

  it("rejects missing auth", async () => {
    const res = await queryOntology({ type: "Person" });
    expect(res.isError).toBe(true);
    expect(payload(res).error.code).toBe("UNAUTHORIZED");
  });

  it("keeps its name and accepts the new optional filters", () => {
    expect(queryOntologyDef.name).toBe("query_ontology");
    expect(Object.keys(queryOntologyDef.inputSchema.properties)).toEqual(
      expect.arrayContaining([
        "type",
        "status",
        "department",
        "q",
        "page",
        "page_size",
      ]),
    );
  });
});

describe("get_entity_network", () => {
  it("normalizes bare ids and forwards default depth/direction", async () => {
    const data = { nodes: [], edges: [] };
    const fetchMock = mockFetch(200, data);

    const res = await getEntityNetwork({ api_key: EMPLOYEE_KEY, entity_id: "report/r1" });

    const [url] = fetchMock.mock.calls[0];
    expect(url).toContain(
      `/ontology/entities/${encodeURIComponent("https://sse.local/report/r1")}/network`,
    );
    expect(url).toContain("depth=2");
    expect(url).toContain("direction=both");
    expect(payload(res)).toEqual(data);
  });

  it("clamps depth to 5 and honors direction=in", async () => {
    const fetchMock = mockFetch(200, { nodes: [], edges: [] });

    await getEntityNetwork({
      api_key: EMPLOYEE_KEY,
      entity_id: "https://sse.local/report/r1",
      depth: 99,
      direction: "in",
    });

    const [url] = fetchMock.mock.calls[0];
    expect(url).toContain("depth=5");
    expect(url).toContain("direction=in");
  });

  it("maps API errors", async () => {
    mockFetch(404, { error: { code: "NOT_FOUND", message: "missing" } });

    const res = await getEntityNetwork({ api_key: EMPLOYEE_KEY, entity_id: "report/x" });

    expect(res.isError).toBe(true);
    expect(payload(res).error.code).toBe("NOT_FOUND");
  });

  it("keeps its name/required args and adds direction", () => {
    expect(getEntityNetworkDef.name).toBe("get_entity_network");
    expect(getEntityNetworkDef.inputSchema.required).toEqual(["entity_id"]);
    expect(Object.keys(getEntityNetworkDef.inputSchema.properties)).toEqual(
      expect.arrayContaining(["entity_id", "depth", "direction"]),
    );
  });
});

describe("query_sparql", () => {
  it("keeps the admin/finance role gate", async () => {
    const fetchMock = mockFetch(200, { results: [] });

    const res = await querySparql({
      api_key: EMPLOYEE_KEY,
      query: "SELECT ?s WHERE { ?s ?p ?o }",
    });

    expect(res.isError).toBe(true);
    expect(payload(res).error.code).toBe("FORBIDDEN");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("posts the query to /ontology/sparql for admins", async () => {
    const data = { results: [], count: 0 };
    const fetchMock = mockFetch(200, data);

    const res = await querySparql({
      api_key: ADMIN_KEY,
      query: "SELECT ?s WHERE { ?s ?p ?o }",
    });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain("/ontology/sparql");
    expect(init).toMatchObject({ method: "POST" });
    expect(JSON.parse(init.body)).toEqual({ query: "SELECT ?s WHERE { ?s ?p ?o }" });
    expect(payload(res)).toEqual(data);
    expect(querySparqlDef.name).toBe("query_sparql");
  });

  it("maps API errors", async () => {
    mockFetch(400, { error: { code: "INVALID_PARAMS", message: "bad query" } });

    const res = await querySparql({ api_key: ADMIN_KEY, query: "not sparql" });

    expect(res.isError).toBe(true);
    expect(payload(res).error.code).toBe("INVALID_PARAMS");
  });
});

describe("validate_expense", () => {
  it("posts to /ontology/validate", async () => {
    const data = { valid: true, issues: [] };
    const fetchMock = mockFetch(200, data);

    const res = await validateExpense({
      api_key: EMPLOYEE_KEY,
      amount: 100,
      category_id: "c1",
    });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain("/ontology/validate");
    expect(init).toMatchObject({ method: "POST" });
    expect(JSON.parse(init.body)).toEqual({ amount: 100, category_id: "c1" });
    expect(payload(res)).toEqual(data);
    expect(validateExpenseDef.name).toBe("validate_expense");
  });

  it.each([404, 501])("falls back to the DB implementation on %i", async (status) => {
    mockFetch(status, { error: { code: "NOT_FOUND", message: "no endpoint" } });
    dbQuery.mockImplementation(async (sql: string) => {
      if (sql.includes("FROM expense_categories")) {
        return { rows: [{ id: "c1", name: "差旅" }] };
      }
      if (sql.includes("FROM approval_rules")) {
        return {
          rows: [
            {
              id: "r1",
              name: "差旅规则",
              min_amount: 0,
              max_amount: 1000,
              category_ids: [],
              approval_chain: [{ step: 1, role: "admin" }],
            },
          ],
        };
      }
      if (sql.includes("FROM users")) return { rows: [{ cnt: "1" }] };
      return { rows: [] };
    });

    const res = await validateExpense({
      api_key: EMPLOYEE_KEY,
      amount: 100,
      category_id: "c1",
    });

    const body = payload(res);
    expect(res.isError).toBeFalsy();
    expect(body.valid).toBe(true);
    expect(body.matched_rule.name).toBe("差旅规则");
    expect(dbQuery).toHaveBeenCalled();
  });

  it("rejects invalid amounts before calling the API", async () => {
    const fetchMock = mockFetch(200, {});

    const res = await validateExpense({ api_key: EMPLOYEE_KEY, amount: 0 });

    expect(res.isError).toBe(true);
    expect(payload(res).error.code).toBe("INVALID_PARAMS");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
