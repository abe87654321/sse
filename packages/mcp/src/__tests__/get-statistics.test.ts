const mockQuery = jest.fn();

jest.mock("@sse/db", () => ({
  pool: { query: (...args: any[]) => mockQuery(...args) },
}));

import { registerApiKey } from "../auth";
import { handler } from "../tools/get-statistics";

registerApiKey("emp-key", { userId: "u-emp", role: "employee", department: "技术部" });
registerApiKey("fin-key", { userId: "u-fin", role: "finance", department: "财务部" });
registerApiKey("aud-key", { userId: "u-aud", role: "auditor", department: "技术部" });

function payload(result: { content: Array<{ text: string }> }): any {
  return JSON.parse(result.content[0].text);
}

function arrangeQueries() {
  mockQuery
    .mockResolvedValueOnce({
      rows: [
        {
          total_amount: "150",
          total_count: "2",
          approved_count: "2",
          rejected_count: "1",
          pending_count: "1",
          draft_count: "1",
        },
      ],
    })
    .mockResolvedValueOnce({
      rows: [
        { category: "交通", category_id: "c1", amount: "100", count: "1" },
        { category: "未分类", category_id: null, amount: "50", count: "1" },
      ],
    })
    .mockResolvedValueOnce({
      rows: [{ department: "技术部", amount: "150", count: "2" }],
    })
    .mockResolvedValueOnce({
      rows: [{ month: "2026-11", total_amount: "150", report_count: "2" }],
    });
}

beforeEach(() => {
  mockQuery.mockReset();
  arrangeQueries();
});

describe("get_statistics", () => {
  it("scopes employees to their own reports and uses the shared spending basis", async () => {
    const res = await handler({
      api_key: "emp-key",
      date_from: "2026-01-01",
      date_to: "2026-12-31",
      department: "市场部",
    });

    expect(res.isError).toBeFalsy();

    const [statSql, statParams] = mockQuery.mock.calls[0];
    expect(statSql).toContain("er.user_id = $1");
    expect(statSql).toContain("er.created_at < ($3::date + INTERVAL '1 day')");
    expect(statSql).toContain("er.status IN ('approved', 'paid')");
    expect(statParams).toEqual(["u-emp", "2026-01-01", "2026-12-31"]);

    const [categorySql, categoryParams] = mockQuery.mock.calls[1];
    expect(categorySql).toContain("LEFT JOIN expense_categories");
    expect(categorySql).toContain("COALESCE(ec.name, '未分类')");
    expect(categorySql).toContain("er.status = ANY($4)");
    expect(categoryParams).toEqual([
      "u-emp",
      "2026-01-01",
      "2026-12-31",
      ["approved", "paid"],
    ]);

    const [deptSql, deptParams] = mockQuery.mock.calls[2];
    expect(deptSql).toContain("LEFT JOIN users u ON u.id = er.user_id");
    expect(deptSql).toContain("COALESCE(d.name, '未分配')");
    expect(deptSql).toContain("er.status = ANY($4)");
    expect(deptParams).toEqual([
      "u-emp",
      "2026-01-01",
      "2026-12-31",
      ["approved", "paid"],
    ]);

    const [monthlySql, monthlyParams] = mockQuery.mock.calls[3];
    expect(monthlySql).toContain("TO_CHAR(er.created_at, 'YYYY-MM')");
    expect(monthlySql).toContain("LIMIT 12");
    expect(monthlySql).toContain("er.status = ANY($4)");
    expect(monthlyParams).toEqual([
      "u-emp",
      "2026-01-01",
      "2026-12-31",
      ["approved", "paid"],
    ]);

    const body = payload(res);
    expect(body.scope).toBe("self");
    expect(body.scope_label).toBe("本人");
    expect(body.total_amount).toBe(150);
    expect(body.report_count).toBe(2);
    expect(body.approved_count).toBe(2);
    expect(body.rejected_count).toBe(1);
    expect(body.pending_count).toBe(1);
    expect(body.draft_count).toBe(1);
    expect(body.by_category[1]).toMatchObject({
      category: "未分类",
      amount: 50,
    });
    expect(body.by_month).toEqual([
      { month: "2026-11", total_amount: 150, report_count: 2 },
    ]);
    expect(body.average_per_report).toBe(75);
  });

  it("lets finance pass a department filter", async () => {
    const res = await handler({ api_key: "fin-key", department: "市场部" });

    expect(res.isError).toBeFalsy();

    const [, statParams] = mockQuery.mock.calls[0];
    expect(statParams).toEqual(["市场部"]);

    const [categorySql, categoryParams] = mockQuery.mock.calls[1];
    expect(categorySql).toContain("u.department_id = (SELECT id FROM departments WHERE name = $1)");
    expect(categorySql).toContain("er.status = ANY($2)");
    expect(categoryParams).toEqual(["市场部", ["approved", "paid"]]);

    expect(payload(res).scope).toBe("all");
  });

  it("denies roles without a data scope", async () => {
    const res = await handler({ api_key: "aud-key" });

    expect(res.isError).toBe(true);
    expect(payload(res).error.code).toBe("FORBIDDEN");
    expect(mockQuery).not.toHaveBeenCalled();
  });
});
