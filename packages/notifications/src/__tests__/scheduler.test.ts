import { ApprovalReminderScheduler } from '../scheduler';

function harness() {
  const sent: any[] = [];
  const marked: string[] = [];
  const approvalRecordRepo = {
    async findPendingOverdue() {
      return [
        {
          id: 'ar1',
          reportId: 'r1',
          approverId: 'dept_approver',
          step: 1,
          result: 'pending',
          reminderSentAt: null,
        },
      ];
    },
    async markReminderSent(id: string) { marked.push(`reminder:${id}`); },
    async markEscalated(id: string) { marked.push(`escalated:${id}`); },
  };
  const userRepo = {
    async findById(id: string) {
      if (id === 'r1') return { id: 'u1', department: '技术部' };
      return { id, name: '李四', phone: '138', email: 'l@example.com' };
    },
    async findByRole(role: string) {
      return role === 'dept_approver'
        ? [{ id: 'u-approver', name: '李四', phone: '138', email: 'l@example.com' }]
        : [];
    },
  };
  const expenseRepo = {
    async findById() { return { id: 'r1', title: '差旅', userId: 'u1' }; },
  };
  const engine = {
    async send(...args: any[]) { sent.push(args); },
  };
  const scheduler = new ApprovalReminderScheduler(
    approvalRecordRepo as any,
    userRepo as any,
    expenseRepo as any,
    engine as any,
  );
  return { scheduler, sent, marked };
}

describe('ApprovalReminderScheduler', () => {
  it('sends reminders to the approver user id, not the approval record id', async () => {
    const { scheduler, sent, marked } = harness();

    await scheduler.tick();

    expect(sent[0][0]).toBe('u-approver');
    expect(sent[0][1]).toBe('approval_reminder');
    expect(sent[0][4]).toEqual(['sms', 'email']);
    expect(sent[0][5].emailBody).toContain('李四');
    expect(marked).toEqual(['reminder:ar1']);
  });

  it('escalates once a reminder was already sent', async () => {
    const { scheduler, sent, marked } = harness();
    (scheduler as any).approvalRecordRepo.findPendingOverdue = async () => [
      {
        id: 'ar2', reportId: 'r1', approverId: 'dept_approver', step: 1,
        result: 'pending', reminderSentAt: new Date(),
      },
    ];

    await scheduler.tick();

    expect(sent[0][1]).toBe('escalation');
    expect(marked).toEqual(['escalated:ar2']);
  });
});
