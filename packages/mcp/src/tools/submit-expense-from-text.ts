import type { ToolDefinition, ToolResult } from "./types.js";
import { errorResult, successResult } from "./types.js";
import { resolveAuthContext } from "../auth.js";
import { OntologyEngine } from "@sse/ontology";
import { readFileSync, existsSync } from "fs";
import { join } from "path";

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
  name: "submit_expense_from_text",
  description: "从自然语言描述中提取报销信息，自动创建报销单并提交审批。",
  inputSchema: {
    type: "object",
    properties: {
      text: { type: "string", description: "报销描述，如：张三出差北京住宿费600元" },
    },
    required: ["text"],
  },
};

export async function handler(args: Record<string, unknown>): Promise<ToolResult> {
  const auth = resolveAuthContext(args);
  if (!auth) return errorResult("UNAUTHORIZED", "无效或缺失 API key");
  const text = args.text as string;
  if (!text) return errorResult("INVALID_PARAMS", "请提供 text 参数");
  try {
    const engine = getEngine();
    const result = await engine.submitFromText(text, auth.userId, "");
    return successResult(result);
  } catch (err: any) {
    return errorResult("INTERNAL_ERROR", err.message || "内部错误");
  }
}
