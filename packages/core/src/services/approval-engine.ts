import type { ApprovalRule, ApprovalRecord } from '@sse/shared';
import { ApprovalResult } from '@sse/shared';
import type { IApprovalRuleRepo } from '../ports/iapproval-rule-repo';
import type { IApprovalRecordRepo } from '../ports/iapproval-record-repo';

export class ApprovalEngine {
  constructor(
    private readonly ruleRepo: IApprovalRuleRepo,
    private readonly recordRepo: IApprovalRecordRepo,
  ) {}

  async matchRule(totalAmount: number, categoryIds: string[]): Promise<ApprovalRule | null> {
    const rules = await this.ruleRepo.findActive();

    const matching = rules.filter((rule) => {
      if (rule.minAmount > totalAmount) return false;
      if (rule.maxAmount <= totalAmount) return false;
      if (rule.categoryIds && rule.categoryIds.length > 0) {
        if (!categoryIds.some((cid) => rule.categoryIds!.includes(cid))) return false;
      }
      return true;
    });

    matching.sort((a, b) => a.priority - b.priority);
    return matching[0] ?? null;
  }

  async startApproval(reportId: string, rule: ApprovalRule): Promise<ApprovalRecord> {
    const firstStep = rule.approvalChain[0];
    const record: Omit<ApprovalRecord, 'id'> = {
      reportId,
      step: firstStep.step,
      approverId: firstStep.role,
      stepStartedAt: new Date(),
      result: ApprovalResult.PENDING,
    };
    return this.recordRepo.create(record);
  }

  async approveStep(
    reportId: string,
    step: number,
    approverId: string,
    result: string,
    comment?: string,
  ): Promise<void> {
    const records = await this.recordRepo.findByReportId(reportId);
    const record = records.find((r) => r.step === step);
    if (record) {
      await this.recordRepo.updateResult(record.id, result, comment);
    }
  }
}
