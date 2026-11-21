export type SnapshotType = 'submit' | 'approve' | 'reject' | 'pay' | 'backfill';

export type SnapshotActorType = 'user' | 'system';

export type SnapshotVerificationStatus =
  | 'no_invoices'
  | 'pending'
  | 'unverified'
  | 'warning'
  | 'error'
  | 'pass';

export type ReportSnapshot = {
  id: string;
  reportId: string;
  snapshotType: SnapshotType;
  schemaVersion: number;
  approvalRecordId?: string;
  step?: number;
  actorType: SnapshotActorType;
  actorId?: string;
  actorRole?: string;
  contentHash: string;
  legacy: boolean;
  createdAt: Date;
};

export type ReportSnapshotRule = {
  id: string;
  name: string;
  minAmount: number;
  maxAmount: number;
  priority: number;
  chain: Array<{
    step: number;
    role: string | null;
    assigneeId: string | null;
    label: string;
  }>;
};

export type ReportSnapshotApprovalRecord = {
  id: string;
  step: number;
  approverId: string;
  approverName: string | null;
  result: string;
  comment: string | null;
  stepStartedAt: string | null;
  approvedAt: string | null;
  verificationAcknowledged: boolean;
};

export type ReportSnapshotAction = {
  recordId: string;
  step: number;
  result: string;
  comment: string | null;
};

export type ReportSnapshotInvoice = {
  id: string;
  fileName: string;
  fileFormat: string;
  fileSize: number;
  checksum: string;
  invoiceNo: string | null;
  verificationStatus: string;
  verificationResult: unknown | null;
  verifiedAt: string | null;
  uploadedAt: string | null;
};

export type ReportSnapshotItem = {
  id: string;
  categoryId: string;
  categoryName: string | null;
  amount: number;
  expenseDate: string;
  description: string;
  invoices: ReportSnapshotInvoice[];
};

export type ReportSnapshotPayment = {
  paidAt: string | null;
  paidBy: string | null;
  paidByName: string | null;
  paymentRef: string | null;
  paymentComment: string | null;
  receipt: {
    id: string;
    fileName: string;
    fileFormat: string;
    checksum: string;
    verificationStatus: string;
    verificationResult: unknown | null;
    verifiedAt: string | null;
  } | null;
};

export type ReportSnapshotPayload = {
  schemaVersion: number;
  snapshotType: SnapshotType;
  capturedAt: string;
  legacy: boolean;
  report: {
    id: string;
    serialNo: string;
    title: string;
    description: string | null;
    status: string;
    currentStep: number;
    totalAmount: number;
    userId: string;
    applicantName: string | null;
    applicantDepartment: string | null;
    submittedAt: string | null;
    completedAt: string | null;
    paidAt: string | null;
    paidBy: string | null;
    paymentRef: string | null;
    paymentComment: string | null;
    paymentUpdatedAt: string | null;
    paymentUpdatedBy: string | null;
    createdAt: string;
    updatedAt: string;
  };
  items: ReportSnapshotItem[];
  verification: {
    aggregateStatus: SnapshotVerificationStatus;
    acknowledged: boolean;
  };
  approval: {
    rule: ReportSnapshotRule | null;
    records: ReportSnapshotApprovalRecord[];
    action: ReportSnapshotAction | null;
  };
  payment: ReportSnapshotPayment | null;
};

export type ReportSnapshotDetail = ReportSnapshot & {
  payload: ReportSnapshotPayload;
  hashValid: boolean;
};
