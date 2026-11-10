import type { ToolDefinition, ToolResult } from "./types.js";
import { errorResult, successResult } from "./types.js";
import { resolveAuthContext } from "../auth.js";
import { verifyReport } from "./api-client.js";

export const definition: ToolDefinition = {
  name: "verify_expense",
  description:
    "对报销单的发票执行 AI 核对（金额/日期/发票号一致性 + 重复票检测），返回核对摘要与逐张明细。",
  inputSchema: {
    type: "object",
    properties: {
      report_id: { type: "string", description: "报销单 UUID" },
      force: {
        type: "boolean",
        description: "为 true 时忽略 OCR 缓存并重新识别（会消耗 OCR 额度）",
      },
    },
    required: ["report_id"],
  },
};

export async function handler(args: Record<string, unknown>): Promise<ToolResult> {
  const auth = resolveAuthContext(args);
  if (!auth) return errorResult("UNAUTHORIZED", "无效或缺失 API key");

  const reportId = typeof args.report_id === "string" ? args.report_id : "";
  if (!reportId) return errorResult("INVALID_PARAMS", "请提供 report_id");

  try {
    const { ok, status, data } = await verifyReport(auth, reportId, args.force === true);
    if (!ok) {
      return errorResult(
        data?.error?.code || "VERIFY_FAILED",
        data?.error?.message || `发票核对失败 (HTTP ${status})`,
      );
    }
    return successResult(data);
  } catch (err: any) {
    return errorResult("INTERNAL_ERROR", err.message || "内部错误");
  }
}
