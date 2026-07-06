import { pool, PgExpenseRepo, PgInvoiceRepo, PgApprovalRecordRepo } from "@sse/db";
import { resolveAuthContext } from "../auth.js";
import { ToolDefinition, ToolResult, errorResult, successResult, formatTimestamp } from "./types.js";
import { UserRole } from "@sse/shared";
import { canViewReport } from "@sse/auth";

export const definition: ToolDefinition = {
  name: "get_expense_detail",
  description: "获取报销单详情，包含明细项、发票和审批记录",
  inputSchema: {
    type: "object",
    properties: {
      report_id: { type: "string", description: "报销单UUID" },
    },
    required: ["report_id"],
  },
};

export async function handler(args: Record<string, unknown>): Promise<ToolResult> {
  const auth = resolveAuthContext(args);
  if (!auth) {
    return errorResult("UNAUTHORIZED", "缺少有效的 API Key");
  }

  const reportId = typeof args.report_id === "string" ? args.report_id : "";
  if (!reportId) {
    return errorResult("INVALID_PARAMS", "report_id 为必填参数");
  }

  try {
    const expenseRepo = new PgExpenseRepo();
    const invoiceRepo = new PgInvoiceRepo();
    const approvalRepo = new PgApprovalRecordRepo();

    const report = await expenseRepo.findById(reportId);
    if (!report) {
      return errorResult("NOT_FOUND", `报销单 ${reportId} 不存在`);
    }

    const { rows: userRows } = await pool.query("SELECT department FROM users WHERE id = $1", [report.userId]);
    const ownerDept = userRows[0]?.department ?? "";

    const viewerRole = auth.role as UserRole;
    if (!canViewReport(viewerRole, auth.department, ownerDept, report.userId, auth.userId)) {
      return errorResult("UNAUTHORIZED", "无权查看此报销单");
    }

    const { rows: items } = await pool.query(
      `SELECT ei.*, ec.name AS category_name
       FROM expense_items ei
       JOIN expense_categories ec ON ec.id = ei.category_id
       WHERE ei.report_id = $1
       ORDER BY ei.id`,
      [reportId],
    );

    const itemsWithInvoices = await Promise.all(
      items.map(async (item: any) => {
        const invoice = await invoiceRepo.findByItemId(item.id);
        return {
          id: item.id,
          category_id: item.category_id,
          category_name: item.category_name,
          amount: Number(item.amount),
          expense_date: formatTimestamp(item.expense_date),
          description: item.description,
          invoice: invoice
            ? {
                id: invoice.id,
                file_name: invoice.fileName,
                file_format: invoice.fileFormat,
                checksum: invoice.checksum,
                ocr_result: invoice.ocrResult ?? null,
                uploaded_at: formatTimestamp(invoice.uploadedAt),
              }
            : null,
        };
      }),
    );

    const approvalRecords = await approvalRepo.findByReportId(reportId);

    return successResult({
      id: report.id,
      serial_no: report.serialNo,
      user_id: report.userId,
      title: report.title,
      total_amount: report.totalAmount,
      status: report.status,
      current_step: report.currentStep,
      submitted_at: formatTimestamp(report.submittedAt),
      completed_at: formatTimestamp(report.completedAt),
      created_at: formatTimestamp(report.createdAt),
      updated_at: formatTimestamp(report.updatedAt),
      items: itemsWithInvoices,
      invoices: itemsWithInvoices
        .filter((i: any) => i.invoice)
        .map((i: any) => i.invoice),
      approval_records: approvalRecords.map((r) => ({
        id: r.id,
        step: r.step,
        approver_id: r.approverId,
        step_started_at: formatTimestamp(r.stepStartedAt),
        result: r.result,
        comment: r.comment ?? null,
        approved_at: formatTimestamp(r.approvedAt),
        reminder_sent_at: formatTimestamp(r.reminderSentAt),
        escalated_at: formatTimestamp(r.escalatedAt),
      })),
    });
  } catch (err) {
    return errorResult("INTERNAL_ERROR", err instanceof Error ? err.message : "查询失败");
  }
}
