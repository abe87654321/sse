import type { ToolResult } from "./types.js";
import { errorResult } from "./types.js";

export function validateParams(
  args: Record<string, unknown>,
  schema: Record<string, { type: string; required?: boolean }>
): ToolResult | null {
  for (const [key, rule] of Object.entries(schema)) {
    const val = args[key];
    if (rule.required && (val === undefined || val === null || val === "")) {
      return errorResult("INVALID_PARAMS", `缺少必填参数: ${key}`);
    }
    if (val !== undefined && val !== null && val !== "") {
      const actualType = Array.isArray(val) ? "array" : typeof val;
      if (rule.type !== "any" && actualType !== rule.type) {
        return errorResult("INVALID_PARAMS", `参数 ${key} 类型错误: 期望 ${rule.type}, 实际 ${actualType}`);
      }
    }
  }
  return null;
}
