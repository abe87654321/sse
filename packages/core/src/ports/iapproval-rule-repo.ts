import type { ApprovalRule } from '@sse/shared';

export interface IApprovalRuleRepo {
  findActive(): Promise<ApprovalRule[]>;
  findById(id: string): Promise<ApprovalRule | null>;
  findAll(): Promise<ApprovalRule[]>;
  create(rule: Omit<ApprovalRule, 'id'>): Promise<ApprovalRule>;
  update(id: string, rule: Partial<ApprovalRule>): Promise<void>;
  delete(id: string): Promise<void>;
}
