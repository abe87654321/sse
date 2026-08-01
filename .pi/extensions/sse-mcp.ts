/**
 * SSE MCP Thin Client — Pi extension
 *
 * 瘦客户端：不 spawn 本地 MCP 进程，直接通过 fetch 调用远端 SSE REST API。
 *
 * 认证：启动时用 MCP API key 调 POST /auth/api-key-login 换取 JWT 并缓存。
 * 角色随 key 绑定的用户走（员工/审批人/管理员各自权限），客户端只持有 key。
 *
 * 环境变量：
 *   SSE_API_BASE : API 根地址（默认 http://192.168.3.107:3000）
 *   SSE_API_KEY  : MCP API key（必填）
 *
 * 工具输出与原 MCP server 一致（snake_case + pagination 结构）。
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

const API_BASE = process.env.SSE_API_BASE || "http://192.168.3.107:3000";
const API_KEY = process.env.SSE_API_KEY || "";

let accessToken: string | null = null;

// ---------- snake_case 适配 ----------

function toSnake(v: string): string {
  return v.replace(/[A-Z]/g, (m) => `_${m.toLowerCase()}`);
}

function deepSnake(obj: any): any {
  if (obj === null || obj === undefined) return obj;
  if (Array.isArray(obj)) return obj.map(deepSnake);
  if (typeof obj === "object") {
    const out: Record<string, any> = {};
    for (const [k, val] of Object.entries(obj)) {
      out[toSnake(k)] = deepSnake(val);
    }
    return out;
  }
  return obj;
}

function toPaginated(data: any): any {
  const body = deepSnake(data);
  const page = body.page ?? 1;
  const pageSize = body.page_size ?? (body.pageSize ?? 20);
  const total = body.total ?? body.count ?? (body.results ? body.results.length : 0);
  return {
    results: body.results ?? body.entities ?? body.data ?? [],
    pagination: { page, page_size: pageSize, total, has_more: page * pageSize < total },
  };
}

// ---------- HTTP 客户端 ----------

async function login(): Promise<void> {
  const res = await fetch(`${API_BASE}/auth/api-key-login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ apiKey: API_KEY }),
  });
  if (!res.ok) {
    let detail = res.statusText;
    try { detail = (await res.json()).error?.message || detail; } catch { /* ignore */ }
    throw new Error(`API key 登录失败 (${res.status}): ${detail}`);
  }
  const data = await res.json();
  accessToken = data.accessToken;
}

async function api(
  method: string,
  path: string,
  body?: unknown,
  retried = false,
): Promise<{ status: number; data: any }> {
  if (!API_KEY) throw new Error("未配置 SSE_API_KEY 环境变量");
  if (!accessToken) await login();

  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (res.status === 401 && !retried) {
    accessToken = null;
    await login();
    return api(method, path, body, true);
  }

  let data: any = null;
  const text = await res.text();
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }

  if (!res.ok) {
    const msg = data?.error?.message || `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return { status: res.status, data };
}

// ---------- 工具注册 ----------

export default function sseMcpExtension(pi: ExtensionAPI) {
  const str = (d: string) => ({ type: "string" as const, description: d });
  const num = (d: string) => ({ type: "number" as const, description: d });

  const tools: Array<{
    name: string;
    description: string;
    properties: Record<string, any>;
    required?: string[];
    call: (args: Record<string, unknown>) => Promise<any>;
  }> = [
    // ---------- 报销搜索 ----------
    {
      name: "search_expenses",
      description: "搜索报销单，支持按日期、申请人、状态、类别、金额范围、关键词筛选",
      properties: {
        date_from: str("起始日期 YYYY-MM-DD"),
        date_to: str("截止日期 YYYY-MM-DD"),
        applicant_id: str("申请人用户ID"),
        status: str("报销单状态"),
        category_id: str("费用类别ID"),
        amount_min: num("最低金额"),
        amount_max: num("最高金额"),
        keyword: str("标题关键词搜索"),
        page: num("页码，默认1"),
        page_size: num("每页条数，默认20，最大100"),
      },
      call: (a) =>
        api("GET", `/expenses?${new URLSearchParams(
          Object.entries(a).reduce((acc, [k, v]) => {
            if (v !== undefined && v !== null && v !== "") {
              const camel = k.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
              (acc as any)[camel] = String(v);
            }
            return acc;
          }, {} as Record<string, string>)
        )}`).then((r) => toPaginated(r.data)),
    },

    {
      name: "get_expense_detail",
      description: "获取报销单详情，包含明细项、发票和审批记录",
      properties: { report_id: str("报销单UUID") },
      required: ["report_id"],
      call: (a) => api("GET", `/expenses/${encodeURIComponent(a.report_id as string)}`).then((r) => deepSnake(r.data)),
    },

    {
      name: "get_approval_status",
      description: "查询报销单审批状态，包含审批历史和当前进度",
      properties: { report_id: str("报销单UUID") },
      required: ["report_id"],
      call: (a) =>
        api("GET", `/expenses/${encodeURIComponent(a.report_id as string)}`).then((r) => ({
          status: r.data.status,
          current_step: r.data.currentStep,
          approval_records: deepSnake(r.data.approvalRecords || []),
        })),
    },

    {
      name: "get_statistics",
      description: "获取报销统计数据，包含总额、单数、分类汇总、部门汇总",
      properties: {
        date_from: str("起始日期 YYYY-MM-DD"),
        date_to: str("截止日期 YYYY-MM-DD"),
        department: str("部门过滤（可选）"),
      },
      call: (a) =>
        api("GET", `/statistics?${new URLSearchParams(
          Object.entries(a).reduce((acc, [k, v]) => {
            if (v !== undefined && v !== null && v !== "") {
              (acc as any)[k.replace(/_([a-z])/g, (_, c) => c.toUpperCase())] = String(v);
            }
            return acc;
          }, {} as Record<string, string>)
        )}`).then((r) => deepSnake(r.data)),
    },

    {
      name: "get_user_summary",
      description: "获取用户报销汇总，包含报销单数、总额、分类汇总",
      properties: {
        user_id: str("用户UUID"),
        date_from: str("起始日期 YYYY-MM-DD"),
        date_to: str("截止日期 YYYY-MM-DD"),
      },
      required: ["user_id"],
      call: (a) => api("GET", `/expenses?applicantId=${encodeURIComponent(a.user_id as string)}`).then((r) => toPaginated(r.data)),
    },

    {
      name: "list_pending_approvals",
      description: "列出指定审批人的待审批报销单",
      properties: {
        approver_id: str("审批人用户UUID"),
        page: num("页码，默认1"),
        page_size: num("每页条数，默认20，最大100"),
      },
      required: ["approver_id"],
      call: (a) => api("GET", `/approvals/pending`).then((r) => deepSnake(r.data)),
    },

    // ---------- 提交类 ----------
    {
      name: "submit_expense_from_text",
      description: "从自然语言描述中提取报销信息，自动创建报销单并提交审批。",
      properties: { text: str("报销描述，如：张三出差北京住宿费600元") },
      required: ["text"],
      call: (a) => api("POST", "/ontology/submit-from-text", { text: a.text }).then((r) => deepSnake(r.data)),
    },

    {
      name: "submit_expense_from_invoice",
      description: "上传发票图片(base64)，通过OCR识别后自动创建报销单并提交审批。",
      properties: {
        image_base64: str("发票图片的base64编码"),
        file_format: str("文件格式: pdf 或 image"),
      },
      required: ["image_base64"],
      call: (a) =>
        api("POST", "/expenses/from-invoice", { imageBase64: a.image_base64, fileFormat: a.file_format }).then((r) => deepSnake(r.data)),
    },

    // ---------- 查询/解释 ----------
    {
      name: "query_expense_status",
      description: "用自然语言查询报销单状态。如'张三的出差住宿报销批了吗'",
      properties: { query: str("自然语言查询") },
      required: ["query"],
      call: (a) => api("POST", "/ontology/query-expense-status", { query: a.query }).then((r) => deepSnake(r.data)),
    },

    {
      name: "explain_decision",
      description: "解释报销单审批流程：匹配的规则、审批链、审批历史",
      properties: { report_id: str("报销单 UUID") },
      required: ["report_id"],
      call: (a) =>
        api("GET", `/expenses/${encodeURIComponent(a.report_id as string)}`).then((r) => ({
          status: r.data.status,
          rule_name: r.data.ruleName || null,
          matched_rule: r.data.ruleName ? { name: r.data.ruleName } : null,
          approval_records: deepSnake(r.data.approvalRecords || []),
        })),
    },

    {
      name: "validate_expense",
      description: "合规检查：验证费用项是否符合审批规则",
      properties: {
        amount: num("报销金额"),
        category_id: str("费用类别 UUID（可选）"),
        category_name: str("费用类别名称（可选）"),
      },
      required: ["amount"],
      call: (a) =>
        api("POST", "/expenses/validate", {
          amount: a.amount,
          categoryId: a.category_id,
          categoryName: a.category_name,
        }).then((r) => deepSnake(r.data)),
    },

    // ---------- 本体图谱 ----------
    {
      name: "query_ontology",
      description: "查询本体图谱。可按类型过滤，获取全图谱或统计概览",
      properties: { type: str("实体类型过滤，不填返回全图谱") },
      call: (a) =>
        a.type
          ? api("GET", `/ontology/query?type=${encodeURIComponent(a.type as string)}`).then((r) => ({
              type: a.type,
              count: (r.data || []).length,
              entities: deepSnake(r.data || []),
            }))
          : api("GET", "/ontology/graph").then((r) => {
              const g = r.data;
              const typeCounts: Record<string, number> = {};
              for (const n of g.nodes || []) typeCounts[n.type] = (typeCounts[n.type] || 0) + 1;
              return {
                summary: {
                  total_nodes: (g.nodes || []).length,
                  total_edges: (g.edges || []).length,
                  type_counts: typeCounts,
                },
                graph: deepSnake(g),
              };
            }),
    },

    {
      name: "get_entity_network",
      description: "获取实体N跳语义关系网络，可视化报销单、人员、部门间的关联",
      properties: {
        entity_id: str("实体标识，如报告ID或人员名称"),
        depth: num("关系跳数，默认2"),
      },
      required: ["entity_id"],
      call: (a) => api("GET", "/ontology/graph").then((r) => deepSnake(r.data)),
    },

    {
      name: "query_sparql",
      description: "Execute a SPARQL query against the SSE ontology knowledge graph for cross-domain queries.",
      properties: { query: str("SPARQL SELECT query string, e.g. SELECT ?s ?p ?o WHERE { ?s ?p ?o }") },
      required: ["query"],
      call: (a) => api("POST", "/ontology/sparql", { query: a.query }).then((r) => deepSnake(r.data)),
    },
  ];

  for (const tool of tools) {
    pi.registerTool({
      name: tool.name,
      label: tool.name,
      description: tool.description,
      promptSnippet: tool.description,
      parameters: Type.Object(tool.properties),
      async execute(_toolCallId, params) {
        try {
          const result = await tool.call(params as Record<string, unknown>);
          return { content: [{ type: "text" as const, text: JSON.stringify(result) }], details: { sse: tool.name } };
        } catch (err: any) {
          return {
            content: [{ type: "text" as const, text: JSON.stringify({ error: { code: "INTERNAL_ERROR", message: err.message } }) }],
            details: { sse: tool.name, error: err.message },
          };
        }
      },
    });
  }

  pi.registerCommand("sse-mcp", {
    description: "SSE MCP thin client status / re-login: /sse-mcp [status|relogin]",
    handler: async (args, ctx) => {
      const cmd = (args || "").trim().toLowerCase();
      if (cmd === "relogin") {
        accessToken = null;
        try {
          await login();
          ctx.ui.notify(`SSE MCP re-logged in (role via key)`, "info");
        } catch (err: any) {
          ctx.ui.notify(`Login failed: ${err.message}`, "error");
        }
      } else {
        ctx.ui.notify(
          `SSE MCP thin client: base=${API_BASE} key=${API_KEY ? "configured" : "MISSING"} ${accessToken ? "logged in" : "not logged in"} (${tools.length} tools)`,
          "info"
        );
      }
    },
  });

  console.error(`[sse-mcp] registered ${tools.length} tools (thin client -> ${API_BASE})`);
}
