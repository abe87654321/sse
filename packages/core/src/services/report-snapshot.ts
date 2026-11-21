import type {
  ApprovalRule,
  ExpenseReport,
  PaymentReceipt,
  ReportSnapshotApprovalRecord,
  ReportSnapshotInvoice,
  ReportSnapshotItem,
  ReportSnapshotPayload,
  ReportSnapshotRule,
  SnapshotType,
} from '@sse/shared';
import { aggregateVerificationStatus } from './invoice-verifier';

export type SnapshotInvoiceInput = {
  id: string;
  fileName: string;
  fileFormat: string;
  fileSize: number;
  checksum: string;
  invoiceNo?: string | null;
  verificationStatus?: string | null;
  verificationResult?: unknown;
  verifiedAt?: Date | string | null;
  uploadedAt?: Date | string | null;
};

export type SnapshotItemInput = {
  id: string;
  reportId?: string;
  categoryId: string;
  amount: number;
  expenseDate: Date | string;
  description?: string | null;
};

export type SnapshotDataItem = {
  item: SnapshotItemInput;
  categoryName?: string | null;
  invoices: SnapshotInvoiceInput[];
};

export type SnapshotRecordInput = {
  id: string;
  step: number;
  approverId: string;
  approverName?: string | null;
  result: string;
  comment?: string | null;
  stepStartedAt: Date | string;
  approvedAt?: Date | string | null;
  verificationAcknowledged?: boolean;
};

export type BuildReportSnapshotInput = {
  snapshotType: Exclude<SnapshotType, 'backfill'>;
  capturedAt?: string;
  legacy?: boolean;
  report: ExpenseReport;
  applicantDepartment?: string | null;
  items: SnapshotDataItem[];
  approvalRecords: SnapshotRecordInput[];
  rule?: ApprovalRule | null;
  action?: {
    recordId: string;
    step: number;
    result: string;
    comment?: string | null;
  } | null;
  paymentReceipt?: PaymentReceipt | null;
  paidByName?: string | null;
};

function iso(value: Date | string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toISOString();
}

function dateOnly(value: Date | string): string {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

function mapInvoice(invoice: SnapshotInvoiceInput): ReportSnapshotInvoice {
  return {
    id: invoice.id,
    fileName: invoice.fileName,
    fileFormat: invoice.fileFormat,
    fileSize: Number(invoice.fileSize),
    checksum: invoice.checksum,
    invoiceNo: invoice.invoiceNo ?? null,
    verificationStatus: invoice.verificationStatus ?? 'pending',
    verificationResult: invoice.verificationResult ?? null,
    verifiedAt: iso(invoice.verifiedAt),
    uploadedAt: iso(invoice.uploadedAt),
  };
}

function mapItem(entry: SnapshotDataItem): ReportSnapshotItem {
  return {
    id: entry.item.id,
    categoryId: entry.item.categoryId,
    categoryName: entry.categoryName ?? null,
    amount: Number(entry.item.amount),
    expenseDate: dateOnly(entry.item.expenseDate),
    description: entry.item.description ?? '',
    invoices: entry.invoices.map(mapInvoice),
  };
}

function mapRule(rule: ApprovalRule): ReportSnapshotRule {
  return {
    id: rule.id,
    name: rule.name,
    minAmount: Number(rule.minAmount),
    maxAmount: Number(rule.maxAmount),
    priority: rule.priority,
    chain: rule.approvalChain.map((step) => ({
      step: step.step,
      role: step.role ?? null,
      assigneeId: step.assigneeId ?? null,
      label: step.label,
    })),
  };
}

function mapRecord(record: SnapshotRecordInput): ReportSnapshotApprovalRecord {
  return {
    id: record.id,
    step: record.step,
    approverId: record.approverId,
    approverName: record.approverName ?? null,
    result: record.result,
    comment: record.comment ?? null,
    stepStartedAt: iso(record.stepStartedAt),
    approvedAt: iso(record.approvedAt),
    verificationAcknowledged: record.verificationAcknowledged ?? false,
  };
}

export function buildReportSnapshotPayload(
  input: BuildReportSnapshotInput
): ReportSnapshotPayload {
  const items = input.items.map(mapItem);
  const invoices = items.flatMap((item) => item.invoices);
  const actionRecord = input.action
    ? input.approvalRecords.find((record) => record.id === input.action!.recordId)
    : undefined;
  const receipt = input.paymentReceipt;

  return {
    schemaVersion: 1,
    snapshotType: input.snapshotType,
    capturedAt: input.capturedAt ?? new Date().toISOString(),
    legacy: input.legacy ?? false,
    report: {
      id: input.report.id,
      serialNo: input.report.serialNo,
      title: input.report.title,
      description: input.report.description ?? null,
      status: input.report.status,
      currentStep: input.report.currentStep,
      totalAmount: Number(input.report.totalAmount),
      userId: input.report.userId,
      applicantName: input.report.applicantName ?? null,
      applicantDepartment: input.applicantDepartment ?? null,
      submittedAt: iso(input.report.submittedAt),
      completedAt: iso(input.report.completedAt),
      paidAt: iso(input.report.paidAt),
      paidBy: input.report.paidBy ?? null,
      paymentRef: input.report.paymentRef ?? null,
      paymentComment: input.report.paymentComment ?? null,
      paymentUpdatedAt: iso(input.report.paymentUpdatedAt),
      paymentUpdatedBy: input.report.paymentUpdatedBy ?? null,
      createdAt: iso(input.report.createdAt) ?? '',
      updatedAt: iso(input.report.updatedAt) ?? '',
    },
    items,
    verification: {
      aggregateStatus: aggregateVerificationStatus(
        invoices.map((invoice) => invoice.verificationStatus)
      ),
      acknowledged: actionRecord?.verificationAcknowledged ?? false,
    },
    approval: {
      rule: input.rule ? mapRule(input.rule) : null,
      records: input.approvalRecords.map(mapRecord),
      action: input.action
        ? {
            recordId: input.action.recordId,
            step: input.action.step,
            result: input.action.result,
            comment: input.action.comment ?? null,
          }
        : null,
    },
    payment:
      input.snapshotType === 'pay'
        ? {
            paidAt: iso(input.report.paidAt),
            paidBy: input.report.paidBy ?? null,
            paidByName: input.paidByName ?? null,
            paymentRef: input.report.paymentRef ?? null,
            paymentComment: input.report.paymentComment ?? null,
            receipt: receipt
              ? {
                  id: receipt.id,
                  fileName: receipt.fileName,
                  fileFormat: receipt.fileFormat,
                  checksum: receipt.checksum,
                  verificationStatus: receipt.verificationStatus,
                  verificationResult: receipt.verificationResult ?? null,
                  verifiedAt: iso(receipt.verifiedAt),
                }
              : null,
          }
        : null,
  };
}
