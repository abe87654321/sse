import { ApprovalEngine, NoApproverError } from '../approval-engine';
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

describe('ApprovalEngine approver resolution', () => {
  const rule: ApprovalRule = {
    id: 'r1',
    name: 'Two step',
    minAmount: 0,
    maxAmount: 10000,
    categoryIds: [],
    approvalChain: [
      { step: 1, role: 'dept_approver', label: '部门审批' },
      { step: 2, role: 'finance', label: '财务审批' },
    ],
    priority: 1,
    isActive: true,
  };

  const ruleRepo = {
    findActive: async () => [rule],
    findById: async () => rule,
    findAll: async () => [rule],
    create: async () => ({}) as any,
    update: async () => {},
    delete: async () => {},
  };

  function recordRepo() {
    return {
      findByReportId: async () => [],
      findPendingOverdue: async () => [],
      create: async (r: any) => ({ ...r, id: 'ar-1' }),
      updateResult: async () => {},
      markReminderSent: async () => {},
      markEscalated: async () => {},
    };
  }

  it('stores a real user id for a role-based first step', async () => {
    const userRepo = {
      findById: async () => null,
      findByRole: async (role: string, department?: string) =>
        role === 'dept_approver' && department === 'tech'
          ? [{ id: 'dept-1' } as any]
          : [],
    };
    const engine = new ApprovalEngine(ruleRepo, recordRepo());

    const record = await engine.startApproval('report-1', rule, userRepo as any, 'tech');

    expect(record.approverId).toBe('dept-1');
  });

  it('does not apply the applicant department to finance steps', async () => {
    const calls: Array<[string, string | undefined]> = [];
    const userRepo = {
      findById: async () => null,
      findByRole: async (role: string, department?: string) => {
        calls.push([role, department]);
        return role === 'finance' ? [{ id: 'fin-1' } as any] : [];
      },
    };
    const engine = new ApprovalEngine(ruleRepo, recordRepo());

    const record = await engine.createNextStep('report-1', rule, 1, userRepo as any, 'tech');

    expect(record?.approverId).toBe('fin-1');
    expect(calls).toContainEqual(['finance', undefined]);
  });

  it('fails instead of writing a role string when no approver exists', async () => {
    const userRepo = {
      findById: async () => null,
      findByRole: async () => [],
    };
    const engine = new ApprovalEngine(ruleRepo, recordRepo());

    await expect(
      engine.startApproval('report-1', rule, userRepo as any, 'tech')
    ).rejects.toBeInstanceOf(NoApproverError);
  });
});

describe('ApprovalEngine transaction client forwarding', () => {
  const rule: ApprovalRule = {
    id: 'r1',
    name: 'Two step',
    minAmount: 0,
    maxAmount: 10000,
    categoryIds: [],
    approvalChain: [
      { step: 1, role: 'dept_approver', label: '部门审批' },
      { step: 2, role: 'finance', label: '财务审批' },
    ],
    priority: 1,
    isActive: true,
  };

  const ruleRepo = {
    findActive: async () => [rule],
    findById: async () => rule,
    findAll: async () => [rule],
    create: async () => ({}) as any,
    update: async () => {},
    delete: async () => {},
  };

  it('forwards the transaction client to record creation', async () => {
    const db = { query: jest.fn() };
    const create = jest.fn(async (record: any) => ({ ...record, id: 'ar-1' }));
    const recordRepo = {
      findByReportId: async () => [],
      findPendingOverdue: async () => [],
      create,
      updateResult: jest.fn(),
      markReminderSent: async () => {},
      markEscalated: async () => {},
    };
    const userRepo = {
      findById: async () => null,
      findByRole: async (role: string) =>
        role === 'dept_approver' ? [{ id: 'dept-1' } as any] : [],
    };
    const engine = new ApprovalEngine(ruleRepo, recordRepo);

    await engine.startApproval('report-1', rule, userRepo as any, 'tech', db as any);

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ reportId: 'report-1' }),
      db
    );
  });

  it('forwards the transaction client to record updates', async () => {
    const db = { query: jest.fn() };
    const updateResult = jest.fn(async () => {});
    const recordRepo = {
      findByReportId: async () => [
        {
          id: 'ar-1',
          step: 1,
          result: 'pending',
          reportId: 'report-1',
          approverId: 'd1',
          stepStartedAt: new Date(),
        },
      ],
      findPendingOverdue: async () => [],
      create: jest.fn(),
      updateResult,
      markReminderSent: async () => {},
      markEscalated: async () => {},
    };
    const engine = new ApprovalEngine(ruleRepo, recordRepo);

    await engine.approveStep('report-1', 1, 'approved', '同意', db as any);

    expect(updateResult).toHaveBeenCalledWith('ar-1', 'approved', '同意', db);
  });
});
