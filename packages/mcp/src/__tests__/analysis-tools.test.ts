import { registerApiKey } from "../auth";
import {
  definition as explainExpenseDef,
  handler as explainExpense,
} from "../tools/explain-expense";
import {
  definition as impactAnalysisDef,
  handler as impactAnalysis,
} from "../tools/impact-analysis";
import {
  definition as findAnomaliesDef,
  handler as findAnomalies,
} from "../tools/find-anomalies";
import {
  definition as getOntologySchemaDef,
  handler as getOntologySchema,
} from "../tools/get-ontology-schema";

const originalFetch = global.fetch;
const KEY = "analysis-key";

registerApiKey(KEY, { userId: "u1", role: "employee", department: "研发" });

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

afterEach(() => {
  if (originalFetch) global.fetch = originalFetch;
  else delete (global as any).fetch;
  jest.restoreAllMocks();
});

describe("explain_expense", () => {
  it("posts report_id to /ontology/explain", async () => {
    const data = { report: { id: "r1" }, evidence: [] };
    const fetchMock = mockFetch(200, data);

    const res = await explainExpense({ api_key: KEY, report_id: "r1" });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain("/ontology/explain");
    expect(init).toMatchObject({ method: "POST" });
    expect(JSON.parse(init.body)).toEqual({ report_id: "r1" });
    expect(payload(res)).toEqual(data);
  });

  it("maps API errors", async () => {
    mockFetch(404, { error: { code: "NOT_FOUND", message: "missing" } });

    const res = await explainExpense({ api_key: KEY, report_id: "r1" });

    expect(res.isError).toBe(true);
    expect(payload(res).error.code).toBe("NOT_FOUND");
  });

  it("requires auth and report_id", async () => {
    const unauthorized = await explainExpense({ report_id: "r1" });
    expect(payload(unauthorized).error.code).toBe("UNAUTHORIZED");

    const invalid = await explainExpense({ api_key: KEY });
    expect(payload(invalid).error.code).toBe("INVALID_PARAMS");
  });

  it("keeps its name and required schema", () => {
    expect(explainExpenseDef.name).toBe("explain_expense");
    expect(explainExpenseDef.inputSchema.required).toEqual(["report_id"]);
  });
});

describe("impact_analysis", () => {
  it("forwards rule/category/department/amount filters", async () => {
    const data = { impacted_reports: [], summary: { total: 0 } };
    const fetchMock = mockFetch(200, data);

    const res = await impactAnalysis({
      api_key: KEY,
      rule_id: "rule-1",
      category_id: "cat-1",
      department: "研发",
      min_amount: 100,
      max_amount: 900,
      amount_delta: 50,
    });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain("/ontology/impact");
    expect(init).toMatchObject({ method: "POST" });
    expect(JSON.parse(init.body)).toEqual({
      rule_id: "rule-1",
      category_id: "cat-1",
      department: "研发",
      min_amount: 100,
      max_amount: 900,
      amount_delta: 50,
    });
    expect(payload(res)).toEqual(data);
  });

  it("omits undefined filters", async () => {
    const fetchMock = mockFetch(200, { impacted_reports: [] });

    await impactAnalysis({ api_key: KEY, department: "财务部" });

    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ department: "财务部" });
  });

  it("maps API errors and requires auth", async () => {
    mockFetch(500, { error: { code: "INTERNAL_ERROR", message: "boom" } });

    const res = await impactAnalysis({ api_key: KEY });
    expect(res.isError).toBe(true);
    expect(payload(res).error.code).toBe("INTERNAL_ERROR");

    const unauthorized = await impactAnalysis({});
    expect(payload(unauthorized).error.code).toBe("UNAUTHORIZED");
  });

  it("keeps its name and optional filters", () => {
    expect(impactAnalysisDef.name).toBe("impact_analysis");
    expect(Object.keys(impactAnalysisDef.inputSchema.properties)).toEqual(
      expect.arrayContaining([
        "rule_id",
        "category_id",
        "department",
        "min_amount",
        "max_amount",
        "amount_delta",
      ]),
    );
  });
});

describe("find_anomalies", () => {
  it("serializes codes and limit into the query string", async () => {
    const data = { anomalies: [], summary: { total: 0 } };
    const fetchMock = mockFetch(200, data);

    const res = await findAnomalies({
      api_key: KEY,
      codes: ["amount_mismatch", "duplicate_invoice_no"],
      limit: 5,
    });

    const [url] = fetchMock.mock.calls[0];
    expect(url).toContain("/ontology/anomalies?");
    expect(url).toContain("codes=amount_mismatch%2Cduplicate_invoice_no");
    expect(url).toContain("limit=5");
    expect(payload(res)).toEqual(data);
  });

  it("maps API errors and requires auth", async () => {
    mockFetch(403, { error: { code: "FORBIDDEN", message: "nope" } });

    const res = await findAnomalies({ api_key: KEY });
    expect(res.isError).toBe(true);
    expect(payload(res).error.code).toBe("FORBIDDEN");

    const unauthorized = await findAnomalies({});
    expect(payload(unauthorized).error.code).toBe("UNAUTHORIZED");
  });

  it("keeps its name and optional schema", () => {
    expect(findAnomaliesDef.name).toBe("find_anomalies");
    expect(Object.keys(findAnomaliesDef.inputSchema.properties)).toEqual(
      expect.arrayContaining(["codes", "limit"]),
    );
  });
});

describe("get_ontology_schema", () => {
  it("gets /ontology/schema", async () => {
    const data = { classes: ["ExpenseReport"], properties: ["amount"] };
    const fetchMock = mockFetch(200, data);

    const res = await getOntologySchema({ api_key: KEY });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain("/ontology/schema");
    expect(init).toMatchObject({ method: "GET" });
    expect(payload(res)).toEqual(data);
  });

  it("maps API errors and requires auth", async () => {
    mockFetch(503, {
      error: { code: "ONTOLOGY_V2_UNAVAILABLE", message: "disabled" },
    });

    const res = await getOntologySchema({ api_key: KEY });
    expect(res.isError).toBe(true);
    expect(payload(res).error.code).toBe("ONTOLOGY_V2_UNAVAILABLE");

    const unauthorized = await getOntologySchema({});
    expect(payload(unauthorized).error.code).toBe("UNAUTHORIZED");
  });

  it("keeps its name and empty input schema", () => {
    expect(getOntologySchemaDef.name).toBe("get_ontology_schema");
    expect(getOntologySchemaDef.inputSchema.properties).toEqual({});
  });
});
