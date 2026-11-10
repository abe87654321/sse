import {
  allTools,
  createToolCallHandler,
  withTimeout,
  ToolTimeoutError,
  type ToolEntry,
} from "../server";
import { registerApiKey } from "../auth";

const KEY = "server-test-key";
registerApiKey(KEY, { userId: "u1", role: "admin", department: "管理部" });

function success(data: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data) }],
  };
}

function failure(code: string, message: string) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify({ error: { code, message } }) }],
    isError: true,
  };
}

function entry(
  name: string,
  handler: ToolEntry["handler"],
  required?: string[],
): ToolEntry {
  return {
    definition: {
      name,
      description: `test ${name}`,
      inputSchema: { type: "object", properties: {}, required },
    },
    handler,
  };
}

function auditEvents(spy: jest.SpyInstance): any[] {
  return spy.mock.calls
    .map(([line]) => String(line))
    .filter((line) => line.startsWith("[mcp-audit] "))
    .map((line) => JSON.parse(line.slice("[mcp-audit] ".length)));
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("tool registry", () => {
  it("registers 22 unique tools including the new analysis tools", () => {
    const names = allTools.map((tool) => tool.definition.name);
    expect(allTools).toHaveLength(22);
    expect(new Set(names).size).toBe(22);
    expect(names).toEqual(
      expect.arrayContaining([
        "explain_expense",
        "impact_analysis",
        "find_anomalies",
        "get_ontology_schema",
      ]),
    );
  });
});

describe("createToolCallHandler", () => {
  it("returns success and audits enriched fields", async () => {
    const spy = jest.spyOn(console, "error").mockImplementation(() => {});
    const handler = createToolCallHandler(() =>
      entry("demo", async () => success({ results: [1, 2, 3] })),
    );

    const res = await handler({ params: { name: "demo", arguments: { api_key: KEY } } });

    expect(res.isError).toBeFalsy();
    const events = auditEvents(spy);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      tool: "demo",
      user_id: "u1",
      role: "admin",
      ok: true,
      error_code: null,
      result_count: 3,
      timed_out: false,
    });
    expect(typeof events[0].duration_ms).toBe("number");
  });

  it("audits API/tool errors with their error code", async () => {
    const spy = jest.spyOn(console, "error").mockImplementation(() => {});
    const handler = createToolCallHandler(() =>
      entry("demo", async () => failure("FORBIDDEN", "no")),
    );

    const res = await handler({ params: { name: "demo", arguments: { api_key: KEY } } });

    expect(res.isError).toBe(true);
    const events = auditEvents(spy);
    expect(events[0]).toMatchObject({
      tool: "demo",
      ok: false,
      error_code: "FORBIDDEN",
      result_count: 0,
      timed_out: false,
    });
  });

  it("enforces the per-tool timeout and audits timed_out", async () => {
    const spy = jest.spyOn(console, "error").mockImplementation(() => {});
    const handler = createToolCallHandler(
      () => entry("slow", () => new Promise(() => {}) as any),
      { timeoutMs: 20 },
    );

    const res = await handler({ params: { name: "slow", arguments: { api_key: KEY } } });

    expect(res.isError).toBe(true);
    expect(JSON.parse(res.content[0].text).error.code).toBe("TIMEOUT");
    const events = auditEvents(spy);
    expect(events[0]).toMatchObject({
      tool: "slow",
      ok: false,
      error_code: "TIMEOUT",
      timed_out: true,
    });
  });

  it("audits unknown tools as NOT_FOUND", async () => {
    const spy = jest.spyOn(console, "error").mockImplementation(() => {});
    const handler = createToolCallHandler(() => undefined);

    const res = await handler({ params: { name: "missing", arguments: {} } });

    expect(res.isError).toBe(true);
    expect(auditEvents(spy)[0]).toMatchObject({
      tool: "missing",
      ok: false,
      error_code: "NOT_FOUND",
      timed_out: false,
    });
  });

  it("audits missing required params as INVALID_PARAMS", async () => {
    const spy = jest.spyOn(console, "error").mockImplementation(() => {});
    const handler = createToolCallHandler(() =>
      entry("needs_args", async () => success({}), ["needed"]),
    );

    const res = await handler({ params: { name: "needs_args", arguments: { api_key: KEY } } });

    expect(res.isError).toBe(true);
    expect(JSON.parse(res.content[0].text).error.code).toBe("INVALID_PARAMS");
    expect(auditEvents(spy)[0]).toMatchObject({
      tool: "needs_args",
      error_code: "INVALID_PARAMS",
      ok: false,
    });
  });

  it("never logs api keys or invoice bytes", async () => {
    const spy = jest.spyOn(console, "error").mockImplementation(() => {});
    const handler = createToolCallHandler(() =>
      entry("safe", async () => success({ ok: true })),
    );

    await handler({
      params: {
        name: "safe",
        arguments: { api_key: KEY, image_base64: "INVOICE_SECRET_BYTES" },
      },
    });

    const logged = spy.mock.calls.map(([line]) => String(line)).join("\n");
    expect(logged).not.toContain(KEY);
    expect(logged).not.toContain("INVOICE_SECRET_BYTES");
  });
});

describe("withTimeout", () => {
  it("rejects with ToolTimeoutError when the tool hangs", async () => {
    await expect(withTimeout(new Promise(() => {}), "x", 10)).rejects.toBeInstanceOf(
      ToolTimeoutError,
    );
  });

  it("passes through resolved values", async () => {
    await expect(withTimeout(Promise.resolve("ok"), "x", 50)).resolves.toBe("ok");
  });
});
