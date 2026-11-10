import type { ToolDefinition, ToolResult } from "./types.js";
import { errorResult, successResult } from "./types.js";
import { resolveAuthContext } from "../auth.js";
import { decodeBase64, resolveInvoiceExt, uploadInvoiceFile } from "./api-client.js";

const MAX_INVOICE_BYTES = 10 * 1024 * 1024;

export const definition: ToolDefinition = {
  name: "upload_invoice",
  description:
    "将发票文件(base64)挂到报销单的费用明细上（仅 PDF/OFD），为 AI 核对提供原始凭证。",
  inputSchema: {
    type: "object",
    properties: {
      report_id: { type: "string", description: "报销单 UUID" },
      item_id: { type: "string", description: "费用明细 UUID" },
      image_base64: { type: "string", description: "发票文件内容的 base64（PDF/OFD）" },
      file_name: { type: "string", description: "文件名，用于判定格式，如 invoice.pdf" },
    },
    required: ["report_id", "item_id", "image_base64"],
  },
};

export async function handler(args: Record<string, unknown>): Promise<ToolResult> {
  const auth = resolveAuthContext(args);
  if (!auth) return errorResult("UNAUTHORIZED", "无效或缺失 API key");

  const reportId = typeof args.report_id === "string" ? args.report_id : "";
  const itemId = typeof args.item_id === "string" ? args.item_id : "";
  const imageBase64 = typeof args.image_base64 === "string" ? args.image_base64 : "";
  if (!reportId) return errorResult("INVALID_PARAMS", "请提供 report_id");
  if (!itemId) return errorResult("INVALID_PARAMS", "请提供 item_id");
  if (!imageBase64) return errorResult("INVALID_PARAMS", "请提供 image_base64");

  const fileName = typeof args.file_name === "string" ? args.file_name : undefined;
  const ext = resolveInvoiceExt(fileName, undefined);
  if (ext !== "pdf" && ext !== "ofd") {
    return errorResult(
      "INVALID_FILE_TYPE",
      "发票入库仅支持 PDF/OFD；图片无法作为发票原始凭证保存",
    );
  }

  try {
    const buffer = decodeBase64(imageBase64);
    if (buffer.length === 0) return errorResult("INVALID_PARAMS", "发票内容为空");
    if (buffer.length > MAX_INVOICE_BYTES) {
      return errorResult("FILE_TOO_LARGE", "发票文件不能超过 10MB");
    }

    const resolvedName = fileName && fileName.includes(".") ? fileName : `invoice.${ext}`;
    const { ok, status, data } = await uploadInvoiceFile(auth, reportId, itemId, {
      buffer,
      fileName: resolvedName,
    });

    if (!ok) {
      return errorResult(
        data?.error?.code || "UPLOAD_FAILED",
        data?.error?.message || `发票上传失败 (HTTP ${status})`,
      );
    }
    return successResult(data);
  } catch (err: any) {
    return errorResult("INTERNAL_ERROR", err.message || "内部错误");
  }
}
