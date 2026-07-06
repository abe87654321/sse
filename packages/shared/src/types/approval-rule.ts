export type ApprovalChainStep = {
  step: number;
  role: string;
  label: string;
  reminderAfterHours?: number;
  escalateAfterHours?: number;
  escalateTo?: string;
};

export type ApprovalRule = {
  id: string;
  name: string;
  minAmount: number;
  maxAmount: number;
  categoryIds?: string[];
  approvalChain: ApprovalChainStep[];
  priority: number;
  isActive: boolean;
};
