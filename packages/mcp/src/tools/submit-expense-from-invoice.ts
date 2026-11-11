import type { ToolDefinition, ToolResult } from "./types.js";
import { errorResult, successResult } from "./types.js";
import { resolveAuthContext } from "../auth.js";
import { ensureOntologyLoaded } from "./get-engine.js";
import { signToken } from "@sse/auth";
import { parseOcr } from "@sse/ocr";
import { pool } from "@sse/db";
import {
  decodeBase64,
  getReportDetail,
  resolveInvoiceExt,
  uploadInvoiceFile,
  verifyReport,
} from "./api-client.js";

export const definition: ToolDefinition = {
  name: "submit_expense_from_invoice",
  description:
    "上传发票(base64)，OCR 识别后自动创建并提交报销单。PDF/OFD 会自动入库并触发 AI 核对；图片仅做 OCR，不入库。",
  inputSchema: {
    type: "object",
    properties: {
      image_base64: { type: "string", description: "发票文件的 base64 编码" },
      file_format: { type: "string", description: "文件格式: pdf 或 image" },
      file_name: { type: "string", description: "文件名，用于判定 PDF/OFD（可选）" },
      auto_verify: {
        type: "boolean",
        description: "PDF/OFD 建单后自动入库并触发 AI 核对，默认 true",
      },
    },
    required: ["image_base64"],
  },
};

async function attachInvoiceAndVerify(
  auth: { userId: string; role: string; department: string },
  actionResult: any,
  args: Record<string, unknown>,
): Promise<void> {
  const ext = resolveInvoiceExt(
    typeof args.file_name === "string" ? args.file_name : undefined,
    typeof args.file_format === "string" ? args.file_format : undefined,
  );

  if (ext !== "pdf" && ext !== "ofd") {
    actionResult.invoice_stored = false;
    actionResult.verification_note =
      "图片发票仅做 OCR，未入库；AI 核对需要 PDF/OFD 原始文件。";
    return;
  }

  try {
    const reportId = actionResult.report_id as string;
    const detail = await getReportDetail(auth, reportId);
    if (!detail.ok) {
      actionResult.invoice_stored = false;
      actionResult.verification_error =
        detail.data?.error?.message || `获取报销明细失败 (HTTP ${detail.status})`;
      return;
    }

    const itemId = detail.data?.items?.[0]?.id;
    if (!itemId) {
      actionResult.invoice_stored = false;
      actionResult.verification_error = "未找到费用明细，无法挂载发票";
      return;
    }

    const fileName =
      typeof args.file_name === "string" && args.file_name.includes(".")
        ? args.file_name
        : `invoice.${ext}`;
    const upload = await uploadInvoiceFile(auth, reportId, itemId, {
      buffer: decodeBase64(args.image_base64 as string),
      fileName,
    });

    if (!upload.ok) {
      actionResult.invoice_stored = false;
      actionResult.verification_error =
        upload.data?.error?.message || `发票入库失败 (HTTP ${upload.status})`;
      return;
    }
    actionResult.invoice_stored = true;
    actionResult.invoice = upload.data;

    const verify = await verifyReport(auth, reportId, false);
    if (verify.ok) {
      actionResult.verification = verify.data;
    } else {
      actionResult.verification_error =
        verify.data?.error?.message || `AI 核对失败 (HTTP ${verify.status})`;
    }
  } catch (err: any) {
    actionResult.invoice_stored = false;
    actionResult.verification_error = err.message || "自动入库/核对失败";
  }
}

export async function handler(args: Record<string, unknown>): Promise<ToolResult> {
  const auth = resolveAuthContext(args);
  if (!auth) return errorResult("UNAUTHORIZED", "无效或缺失 API key");
  const imageBase64 = args.image_base64 as string;
  if (!imageBase64) return errorResult("INVALID_PARAMS", "请提供 image_base64 参数");
  try {
    const ocrText = await parseOcr(imageBase64, (args.file_format as string) || "image");
    if (!ocrText) return errorResult("OCR_FAILED", "发票OCR识别无返回结果");
    const engine = await ensureOntologyLoaded();
    const extraction = await engine.extractor.extractFromInvoice(ocrText);
    if (!extraction.amount) return errorResult("EXTRACTION_EMPTY", "未能从发票提取到金额。OCR: " + ocrText.substring(0, 200));
    const { rows: categories } = await pool.query("SELECT id, name FROM expense_categories");
    const rawCategory = String(extraction.category || "").trim();
    const normalizedCategory = rawCategory.replace(/费$/, "").trim();
    const category = categories.find((row: any) => {
      const name = String(row.name ?? "").trim();
      if (!name) return false;
      return (
        name === rawCategory ||
        name === normalizedCategory ||
        (!!normalizedCategory && (name.includes(normalizedCategory) || normalizedCategory.includes(name)))
      );
    });
    if (category) extraction.categoryId = category.id;
    let resolvedUserId = auth.userId;
    if (extraction.person?.name) {
      const { rows: users } = await pool.query("SELECT id FROM users WHERE name = $1 OR phone = $1", [extraction.person.name]);
      if (users.length > 0) { resolvedUserId = users[0].id; if (extraction.person) extraction.person.matchedUserId = resolvedUserId; }
    }
    const { valid, error, dto } = await engine.reasoner.reason(extraction);
    if (!valid) return successResult({ success: false, error, notified: ["role:admin"] });
    const token = signToken({ userId: auth.userId, role: auth.role, department: auth.department });
    const actionResult = await engine.executor.execute(dto!, resolvedUserId, token);
    if (actionResult.success && actionResult.report_id) {
      try { await engine.mapper.syncReportToOntology(actionResult.report_id); } catch { /* best effort */ }
      if (args.auto_verify !== false) {
        await attachInvoiceAndVerify(auth, actionResult, args);
      }
    }
    return successResult(actionResult);
  } catch (err: any) {
    return errorResult("INTERNAL_ERROR", err.message || "内部错误");
  }
}
