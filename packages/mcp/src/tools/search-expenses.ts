import { pool, PgExpenseRepo } from "@sse/db";
import { resolveDataScope } from "@sse/auth";
import { resolveAuthContext } from "../auth.js";
import { ToolDefinition, ToolResult, toPaginated, parseISO8601Date, errorResult, successResult } from "./types.js";

export const definition: ToolDefinition = {
  name: "search_expenses",
  description: "搜索报销单，支持按日期、申请人、状态、类别、金额范围、关键词筛选",
  inputSchema: {
    type: "object",
    properties: {
      date_from: { type: "string", description: "起始日期 YYYY-MM-DD" },
      date_to: { type: "string", description: "截止日期 YYYY-MM-DD" },
      applicant_id: { type: "string", description: "申请人用户ID" },
      status: { type: "string", description: "报销单状态" },
      category_id: { type: "string", description: "费用类别ID" },
      amount_min: { type: "number", description: "最低金额" },
      amount_max: { type: "number", description: "最高金额" },
      keyword: { type: "string", description: "编号或标题关键词搜索" },
      page: { type: "number", description: "页码，默认1", default: 1 },
      page_size: { type: "number", description: "每页条数，默认20，最大100", default: 20 },
    },
  },
};

const CATEGORY_NAMES_SQL = `COALESCE(
  (SELECT array_agg(DISTINCT ec.name ORDER BY ec.name)
     FROM expense_items ei
     JOIN expense_categories ec ON ec.id = ei.category_id
    WHERE ei.report_id = er.id),
  ARRAY[]::text[]
)`;

function mapReport(row: any) {
  return {
    id: row.id,
    serial_no: row.serial_no ?? row.serialNo,
    user_id: row.user_id ?? row.userId,
    applicant_name: row.applicant_name ?? row.applicantName ?? null,
    category_names: row.category_names ?? row.categoryNames ?? [],
    title: row.title,
    total_amount: Number(row.total_amount ?? row.totalAmount),
    status: row.status,
    current_step: row.current_step ?? row.currentStep,
    submitted_at: row.submitted_at ?? row.submittedAt ?? undefined,
    completed_at: row.completed_at ?? row.completedAt ?? undefined,
    created_at: row.created_at ?? row.createdAt,
    updated_at: row.updated_at ?? row.updatedAt,
  };
}

export async function handler(args: Record<string, unknown>): Promise<ToolResult> {
  const auth = resolveAuthContext(args);
  if (!auth) {
    return errorResult("UNAUTHORIZED", "缺少有效的 API Key");
  }

  const page = Math.max(1, (typeof args.page === "number" ? args.page : parseInt(String(args.page ?? "1"), 10)) || 1);
  const pageSize = Math.min(100, Math.max(1, (typeof args.page_size === "number" ? args.page_size : parseInt(String(args.page_size ?? "20"), 10)) || 20));

  const repo = new PgExpenseRepo();

  try {
    const scope = resolveDataScope(auth);
    if (scope.kind === "deny") {
      return errorResult("FORBIDDEN", "当前角色无权查询报销单");
    }

    if (scope.kind === "self") {
      const { results, total } = await repo.findManyByUser(scope.userId, {
        dateFrom: parseISO8601Date(args.date_from),
        dateTo: parseISO8601Date(args.date_to),
        status: typeof args.status === "string" ? args.status : undefined,
        categoryId: typeof args.category_id === "string" ? args.category_id : undefined,
        amountMin: typeof args.amount_min === "number" ? args.amount_min : undefined,
        amountMax: typeof args.amount_max === "number" ? args.amount_max : undefined,
        keyword: typeof args.keyword === "string" ? args.keyword : undefined,
        page,
        pageSize,
      });
      return successResult(toPaginated(results.map(mapReport), total, page, pageSize));
    }

    const conditions: string[] = [];
    const values: any[] = [];
    let idx = 1;

    if (scope.kind === "department") {
      conditions.push(`u.department = $${idx++}`);
      values.push(scope.department);
    }

    const dateFrom = parseISO8601Date(args.date_from);
    const dateTo = parseISO8601Date(args.date_to);
    const applicantId = typeof args.applicant_id === "string" ? args.applicant_id : undefined;
    const status = typeof args.status === "string" ? args.status : undefined;
    const keyword = typeof args.keyword === "string" ? args.keyword : undefined;
    const categoryId = typeof args.category_id === "string" ? args.category_id : undefined;
    const amountMin = typeof args.amount_min === "number" ? args.amount_min : undefined;
    const amountMax = typeof args.amount_max === "number" ? args.amount_max : undefined;

    if (dateFrom) { conditions.push(`er.created_at >= $${idx++}`); values.push(dateFrom); }
    if (dateTo) { conditions.push(`er.created_at <= $${idx++}`); values.push(dateTo); }
    if (applicantId) { conditions.push(`er.user_id = $${idx++}`); values.push(applicantId); }
    if (status) { conditions.push(`er.status = $${idx++}`); values.push(status); }
    if (keyword) {
      conditions.push(`(er.serial_no ILIKE $${idx} OR er.title ILIKE $${idx})`);
      values.push(`%${keyword}%`);
      idx++;
    }

    if (categoryId || amountMin !== undefined || amountMax !== undefined) {
      const itemConds: string[] = [];
      if (categoryId) { itemConds.push(`ei.category_id = $${idx++}`); values.push(categoryId); }
      if (amountMin !== undefined) { itemConds.push(`ei.amount >= $${idx++}`); values.push(amountMin); }
      if (amountMax !== undefined) { itemConds.push(`ei.amount <= $${idx++}`); values.push(amountMax); }
      conditions.push(`er.id IN (SELECT ei.report_id FROM expense_items ei WHERE ${itemConds.join(" AND ")})`);
    }

    const fromClause = "expense_reports er JOIN users u ON u.id = er.user_id";
    const orderClause = "ORDER BY er.created_at DESC";

    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const offset = (page - 1) * pageSize;

    const [dataRes, countRes] = await Promise.all([
      pool.query(
        `SELECT er.*, u.name AS applicant_name, ${CATEGORY_NAMES_SQL} AS category_names
           FROM ${fromClause} ${where} ${orderClause} LIMIT $${idx++} OFFSET $${idx++}`,
        [...values, pageSize, offset],
      ),
      pool.query(`SELECT COUNT(*) FROM ${fromClause} ${where}`, values),
    ]);

    return successResult(
      toPaginated(dataRes.rows.map(mapReport), parseInt(countRes.rows[0].count, 10), page, pageSize),
    );
  } catch (err) {
    return errorResult("INTERNAL_ERROR", err instanceof Error ? err.message : "查询失败");
  }
}
