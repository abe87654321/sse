import type { ApprovalRule, ApprovalRecord } from '@sse/shared';
import { ApprovalResult } from '@sse/shared';
import type { IApprovalRuleRepo } from '../ports/iapproval-rule-repo';
import type { IApprovalRecordRepo } from '../ports/iapproval-record-repo';
import type { IUserRepo } from '../ports/iuser-repo';

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

  async resolveApprovers(
    rule: ApprovalRule,
    userRepo: IUserRepo,
    department: string,
  ): Promise<Map<number, string[]>> {
    const stepApprovers = new Map<number, string[]>();
    for (const step of rule.approvalChain) {
      if (step.assigneeId) {
        const user = await userRepo.findById(step.assigneeId);
        stepApprovers.set(step.step, user ? [user.id] : []);
      } else if (step.role) {
        const users = await userRepo.findByRole(step.role, department);
        stepApprovers.set(step.step, users.map((u) => u.id));
      } else {
        stepApprovers.set(step.step, []);
      }
    }
    return stepApprovers;
  }

  async dedupeApprovalChain(
    rule: ApprovalRule,
    userRepo: IUserRepo,
    department: string,
  ): Promise<{ effectiveChain: typeof rule.approvalChain; merged: boolean }> {
    const stepApprovers = await this.resolveApprovers(rule, userRepo, department);
    const steps = rule.approvalChain;
    const merged = new Set<number>();

    for (let i = 1; i < steps.length; i++) {
      const currentIds = stepApprovers.get(steps[i].step) || [];
      if (currentIds.length === 0) continue;
      for (let j = 0; j < i; j++) {
        const prevIds = stepApprovers.get(steps[j].step) || [];
        if (prevIds.length === 0) continue;
        const overlap = currentIds.some((id) => prevIds.includes(id));
        if (overlap) {
          merged.add(steps[i].step);
          break;
        }
      }
    }

    if (merged.size === 0) {
      return { effectiveChain: steps, merged: false };
    }

    const effectiveChain = steps.filter((s) => !merged.has(s.step));
    return { effectiveChain, merged: true };
  }

  async startApproval(reportId: string, rule: ApprovalRule): Promise<ApprovalRecord> {
    const firstStep = rule.approvalChain[0];
    const record: Omit<ApprovalRecord, 'id'> = {
      reportId,
      step: firstStep.step,
      approverId: firstStep.role || '',
      stepStartedAt: new Date(),
      result: ApprovalResult.PENDING,
    };
    return this.recordRepo.create(record);
  }

  async approveStep(
    reportId: string,
    step: number,
    result: string,
    comment?: string,
  ): Promise<void> {
    const records = await this.recordRepo.findByReportId(reportId);
    for (const record of records) {
      if (record.step === step && record.result === ApprovalResult.PENDING) {
        await this.recordRepo.updateResult(record.id, result, comment);
      }
    }
  }

  async createNextStep(reportId: string, rule: ApprovalRule, currentStep: number): Promise<ApprovalRecord | null> {
    const chain = rule.approvalChain;
    const currentIndex = chain.findIndex((s) => s.step === currentStep);
    if (currentIndex < 0 || currentIndex >= chain.length - 1) return null;

    const nextStep = chain[currentIndex + 1];
    if (!nextStep.role && !nextStep.assigneeId) return null;

    const record: Omit<ApprovalRecord, 'id'> = {
      reportId,
      step: nextStep.step,
      approverId: nextStep.role || nextStep.assigneeId || '',
      stepStartedAt: new Date(),
      result: ApprovalResult.PENDING,
    };
    return this.recordRepo.create(record);
  }

  isLastStep(rule: ApprovalRule, currentStep: number): boolean {
    const chain = rule.approvalChain;
    const currentIndex = chain.findIndex((s) => s.step === currentStep);
    return currentIndex >= chain.length - 1;
  }
}
