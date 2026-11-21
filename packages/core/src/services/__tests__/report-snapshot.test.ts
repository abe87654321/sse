import { buildReportSnapshotPayload } from '../report-snapshot';
import type { ApprovalRule, ExpenseReport, Invoice } from '@sse/shared';

const report: ExpenseReport = {
  id: 'r1',
  serialNo: 'RE-001',
  userId: 'u1',
  applicantName: '张三',
  title: '差旅报销',
  totalAmount: 300,
  description: '上海出差',
  status: 'pending',
  currentStep: 1,
  createdAt: new Date('2026-11-01T08:00:00Z'),
  updatedAt: new Date('2026-11-02T08:00:00Z'),
};

const rule: ApprovalRule = {
  id: 'rule-1',
  name: '默认审批规则',
  minAmount: 0,
  maxAmount: 10000,
  categoryIds: [],
  priority: 1,
  isActive: true,
  approvalChain: [
    { step: 1, role: 'dept_approver', label: '部门审批' },
    { step: 2, role: 'finance', label: '财务审批' },
  ],
};

function invoice(overrides: Partial<Invoice> = {}): Invoice {
  return {
    id: 'i1',
    itemId: 'it1',
    fileName: 'invoice.pdf',
    fileFormat: 'pdf',
    fileSize: 1024,
    storageKey: 'invoices/r1/i1.pdf',
    storageBucket: 'invoices',
    checksum: 'abc123',
    verificationStatus: 'pass',
    verificationResult: {
      status: 'pass',
      checks: [],
      summary: 'ok',
      checkedAt: '2026-11-02T09:00:00.000Z',
      duplicates: [],
    },
    verifiedAt: new Date('2026-11-02T09:00:00Z'),
    uploadedAt: new Date('2026-11-02T08:30:00Z'),
    ...overrides,
  };
}

describe('buildReportSnapshotPayload', () => {
  it('builds a full payload with report, items, invoices, verification, rule and action', () => {
    const payload = buildReportSnapshotPayload({
      snapshotType: 'approve',
      capturedAt: '2026-11-02T10:00:00.000Z',
      report,
      applicantDepartment: '技术部',
      items: [
        {
          item: {
            id: 'it1',
            reportId: 'r1',
            categoryId: 'c1',
            amount: 300,
            expenseDate: '2026-11-01',
            description: '高铁票',
          },
          categoryName: '交通费',
          invoices: [invoice()],
        },
      ],
      approvalRecords: [
        {
          id: 'ar1',
          step: 1,
          approverId: 'd1',
          approverName: '李四',
          result: 'approved',
          comment: '同意',
          stepStartedAt: new Date('2026-11-02T09:30:00Z'),
          approvedAt: new Date('2026-11-02T10:00:00Z'),
          verificationAcknowledged: true,
        },
      ],
      rule,
      action: { recordId: 'ar1', step: 1, result: 'approved', comment: '同意' },
    });

    expect(payload.schemaVersion).toBe(1);
    expect(payload.report.totalAmount).toBe(300);
    expect(payload.report.applicantDepartment).toBe('技术部');
    expect(payload.items[0].categoryName).toBe('交通费');
    expect(payload.items[0].invoices[0].fileName).toBe('invoice.pdf');
    expect(payload.items[0].invoices[0]).not.toHaveProperty('storageKey');
    expect(payload.verification.aggregateStatus).toBe('pass');
    expect(payload.verification.acknowledged).toBe(true);
    expect(payload.approval.rule?.chain).toHaveLength(2);
    expect(payload.approval.action).toEqual({
      recordId: 'ar1',
      step: 1,
      result: 'approved',
      comment: '同意',
    });
    expect(payload.payment).toBeNull();
  });

  it('reports no_invoices when the report has no invoices', () => {
    const payload = buildReportSnapshotPayload({
      snapshotType: 'submit',
      report,
      items: [
        {
          item: {
            id: 'it1',
            reportId: 'r1',
            categoryId: 'c1',
            amount: 300,
            expenseDate: '2026-11-01',
            description: '高铁票',
          },
          invoices: [],
        },
      ],
      approvalRecords: [],
      rule: null,
      action: null,
    });

    expect(payload.verification.aggregateStatus).toBe('no_invoices');
    expect(payload.approval.rule).toBeNull();
    expect(payload.approval.action).toBeNull();
    expect(payload.payment).toBeNull();
  });

  it('groups multiple invoices per item and builds the payment section for pay snapshots', () => {
    const payload = buildReportSnapshotPayload({
      snapshotType: 'pay',
      report: {
        ...report,
        status: 'paid',
        paidAt: new Date('2026-11-03T08:00:00Z'),
        paidBy: 'fin-1',
        paymentRef: 'BANK-1',
        paymentComment: '已转账',
      },
      items: [
        {
          item: {
            id: 'it1',
            reportId: 'r1',
            categoryId: 'c1',
            amount: 300,
            expenseDate: '2026-11-01',
            description: '高铁票',
          },
          categoryName: '交通费',
          invoices: [
            invoice({ id: 'i1', verificationStatus: 'pass' }),
            invoice({ id: 'i2', verificationStatus: 'warning' }),
          ],
        },
      ],
      approvalRecords: [],
      rule: null,
      action: null,
      paidByName: '王五',
      paymentReceipt: {
        id: 'pr1',
        reportId: 'r1',
        fileName: 'receipt.pdf',
        fileFormat: 'pdf',
        fileSize: 2048,
        storageKey: 'payment-receipts/r1/receipt.pdf',
        storageBucket: 'payment-receipts',
        checksum: 'def456',
        uploadedAt: new Date('2026-11-03T07:00:00Z'),
        verificationStatus: 'pass',
        verificationResult: {
          status: 'pass',
          checks: [],
          summary: 'ok',
          checkedAt: '2026-11-03T07:30:00.000Z',
          duplicateReceipts: [],
        },
        verifiedAt: new Date('2026-11-03T07:30:00Z'),
      },
    });

    expect(payload.items[0].invoices).toHaveLength(2);
    expect(payload.verification.aggregateStatus).toBe('warning');
    expect(payload.payment).toEqual(
      expect.objectContaining({
        paidBy: 'fin-1',
        paidByName: '王五',
        paymentRef: 'BANK-1',
        paymentComment: '已转账',
        receipt: expect.objectContaining({ id: 'pr1', fileName: 'receipt.pdf' }),
      })
    );
  });

  it('keeps the rule null for legacy input', () => {
    const payload = buildReportSnapshotPayload({
      snapshotType: 'approve',
      legacy: true,
      report,
      items: [],
      approvalRecords: [],
      rule: null,
      action: null,
    });

    expect(payload.legacy).toBe(true);
    expect(payload.approval.rule).toBeNull();
    expect(payload.payment).toBeNull();
  });
});
