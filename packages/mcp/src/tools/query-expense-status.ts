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
  description: "用自然语言查询报销单状态。如'张三的出差住宿报销批了吗'",
  inputSchema: {
    type: "object",
    properties: {
      query: { type: "string", description: "自然语言查询" },
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
    const defaults = {
      fillEngine: {
        endpoint: process.env.AI_ENDPOINT || "http://localhost:11434/v1/chat/completions",
        model: process.env.AI_MODEL || "llama3.2-vision",
      },
    };
    let cfg = defaults;
    try {
      if (existsSync(CONFIG_PATH)) {
        const saved = JSON.parse(readFileSync(CONFIG_PATH, "utf-8"));
        cfg = { ...defaults, fillEngine: { ...defaults.fillEngine, ...(saved.fillEngine || {}) } };
      }
    } catch { /* use defaults */ }
    const extractor = new EntityExtractor(cfg.fillEngine.endpoint, cfg.fillEngine.model);
    const extractPrompt = `从查询中提取过滤条件返回JSON: { "name": "人名或null", "status": "pending/approved/rejected/paid或null", "keyword": "关键词或null" }\n查询: "${query}"`;
    const parsed = await (extractor as any).provider.analyzeText(query, extractPrompt);
    let filters: any = {};
    try { const m = parsed.match(/\{[\s\S]*\}/); if (m) filters = JSON.parse(m[0]); } catch { /* ignore */ }
    let sql = "SELECT er.id, er.serial_no, er.title, er.total_amount, er.status, er.submitted_at, u.name as applicant_name FROM expense_reports er JOIN users u ON u.id = er.user_id WHERE 1=1";
    const values: any[] = []; let idx = 1;
    if (filters.name) { sql += ` AND u.name ILIKE $${idx++}`; values.push(`%${filters.name}%`); }
    if (filters.status) { sql += ` AND er.status = $${idx++}`; values.push(filters.status); }
    if (filters.keyword) { sql += ` AND (er.title ILIKE $${idx++} OR er.serial_no ILIKE $${idx++})`; values.push(`%${filters.keyword}%`, `%${filters.keyword}%`); }
    sql += " ORDER BY er.submitted_at DESC LIMIT 20";
    const { rows } = await pool.query(sql, values);
    const summaryPrompt = `查询"${query}"结果如下，用简洁中文总结:\n${JSON.stringify(rows, null, 2)}`;
    const summary = await (extractor as any).provider.analyzeText(JSON.stringify(rows), summaryPrompt);
    return successResult({ summary, results: rows, count: rows.length });
  } catch (err: any) {
    return errorResult("INTERNAL_ERROR", err.message || "内部错误");
  }
}
