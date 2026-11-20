import { ReportStatus } from '@sse/shared';

export type ReportDeletionInput = {
  status: ReportStatus | string;
  actorRole: string;
  actorId: string;
  ownerId: string;
  hasAuditRecords: boolean;
};

export type ReportDeletionDecision =
  | { allowed: true }
  | { allowed: false; code: 'FORBIDDEN' | 'REPORT_LOCKED'; message: string };

export function evaluateReportDeletion(input: ReportDeletionInput): ReportDeletionDecision {
  const isAdmin = input.actorRole === 'admin';
  const isOwner = input.actorId === input.ownerId;

  if (!isAdmin && !isOwner) {
    return { allowed: false, code: 'FORBIDDEN', message: '无权删除此报销单' };
  }

  if (input.status !== ReportStatus.DRAFT || input.hasAuditRecords) {
    return {
      allowed: false,
      code: 'REPORT_LOCKED',
      message: '只有未产生审批或付款记录的草稿可以删除；其他单据必须保留审计证据',
    };
  }

  return { allowed: true };
}
