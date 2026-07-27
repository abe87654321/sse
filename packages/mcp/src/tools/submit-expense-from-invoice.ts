import type { ToolDefinition, ToolResult } from "./types.js";
import { errorResult, successResult } from "./types.js";
import { resolveAuthContext } from "../auth.js";
import { OntologyEngine } from "@sse/ontology";
import { parseOcr } from "@sse/ocr";
import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { pool } from "@sse/db";

const CONFIG_PATH = join(process.cwd(), "ai-config.json");

function getEngine(): OntologyEngine {
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
  return new OntologyEngine(cfg.fillEngine.endpoint, cfg.fillEngine.model);
}

export const definition: ToolDefinition = {
  name: "submit_expense_from_invoice",
  description: "上传发票图片(base64)，通过OCR识别后自动创建报销单并提交审批。",
  inputSchema: {
    type: "object",
    properties: {
      image_base64: { type: "string", description: "发票图片的base64编码" },
      file_format: { type: "string", description: "文件格式: pdf 或 image" },
    },
    required: ["image_base64"],
  },
};

export async function handler(args: Record<string, unknown>): Promise<ToolResult> {
  const auth = resolveAuthContext(args);
  if (!auth) return errorResult("UNAUTHORIZED", "无效或缺失 API key");
  const imageBase64 = args.image_base64 as string;
  if (!imageBase64) return errorResult("INVALID_PARAMS", "请提供 image_base64 参数");
  try {
    const ocrText = await parseOcr(imageBase64, (args.file_format as string) || "image");
    if (!ocrText) return errorResult("OCR_FAILED", "发票OCR识别无返回结果");
    const engine = getEngine();
    const extraction = await engine.extractor.extractFromInvoice(ocrText);
    if (!extraction.amount) return errorResult("EXTRACTION_EMPTY", "未能从发票提取到金额。OCR: " + ocrText.substring(0, 200));
    const { rows: categories } = await pool.query("SELECT id FROM expense_categories WHERE name ILIKE $1 LIMIT 1", [`%${extraction.category || ""}%`]);
    if (categories.length > 0) extraction.categoryId = categories[0].id;
    let resolvedUserId = auth.userId;
    if (extraction.person?.name) {
      const { rows: users } = await pool.query("SELECT id FROM users WHERE name = $1 OR phone = $1", [extraction.person.name]);
      if (users.length > 0) { resolvedUserId = users[0].id; if (extraction.person) extraction.person.matchedUserId = resolvedUserId; }
    }
    const { valid, error, dto } = await engine.reasoner.reason(extraction);
    if (!valid) return successResult({ success: false, error, notified: ["role:admin"] });
    const actionResult = await engine.executor.execute(dto!, resolvedUserId, "");
    if (actionResult.success && actionResult.report_id) {
      try { await engine.mapper.syncReportToOntology(actionResult.report_id); } catch { /* best effort */ }
    }
    return successResult(actionResult);
  } catch (err: any) {
    return errorResult("INTERNAL_ERROR", err.message || "内部错误");
  }
}
