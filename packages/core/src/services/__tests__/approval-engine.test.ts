import { ApprovalEngine } from '../approval-engine';
import type { ApprovalRule } from '@sse/shared';

describe('ApprovalEngine', () => {
  const mockRules: ApprovalRule[] = [
    {
      id: 'r1',
      name: 'Low amount',
      minAmount: 0,
      maxAmount: 500,
      categoryIds: ['c_office', 'c_comm', 'c_other'],
      approvalChain: [
        {
          step: 1,
          role: 'dept_approver',
          label: 'Dept',
          reminderAfterHours: 48,
          escalateAfterHours: 96,
          escalateTo: 'parent_of_approver',
        },
      ],
      priority: 10,
      isActive: true,
    },
    {
      id: 'r2',
      name: 'Standard',
      minAmount: 500,
      maxAmount: 3000,
      categoryIds: [],
      approvalChain: [
        {
          step: 1,
          role: 'dept_approver',
          label: 'Dept',
          reminderAfterHours: 48,
          escalateAfterHours: 96,
          escalateTo: 'parent_of_approver',
        },
        {
          step: 2,
          role: 'finance',
          label: 'Finance',
          reminderAfterHours: 48,
          escalateAfterHours: 96,
          escalateTo: 'admin',
        },
      ],
      priority: 5,
      isActive: true,
    },
  ];

  const mockRuleRepo = {
    findActive: async () => mockRules,
    findById: async () => null,
    findAll: async () => [],
    create: async () => ({}) as any,
    update: async () => {},
    delete: async () => {},
  };
  const mockRecordRepo = {
    findByReportId: async () => [],
    findPendingOverdue: async () => [],
    create: async (r: any) => r,
    updateResult: async () => {},
    markReminderSent: async () => {},
    markEscalated: async () => {},
  };

  const engine = new ApprovalEngine(mockRuleRepo, mockRecordRepo);

  it('matches low amount with matching category', async () => {
    const rule = await engine.matchRule(300, ['c_office']);
    expect(rule?.id).toBe('r1');
  });

  it('matches standard rule for mid-range amount', async () => {
    const rule = await engine.matchRule(1000, ['c_training']);
    expect(rule?.id).toBe('r2');
  });

  it('returns null when no rule matches', async () => {
    const rule = await engine.matchRule(-1, []);
    expect(rule).toBeNull();
  });
});
