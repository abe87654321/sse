import { ApprovalReminderScheduler } from '../scheduler';
import { reminderMessage } from '../templates/reminder';
import { escalationMessage } from '../templates/escalation';

function harness() {
  const marked: string[] = [];
  const records: any[] = [
    {
      id: 'ar1',
      reportId: 'r1',
      approverId: 'dept_approver',
      step: 1,
      result: 'pending',
      reminderSentAt: null,
    },
  ];
  const approvalRecordRepo = {
    async findPendingOverdue() {
      return records;
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
    async findById() {
      return { id: 'r1', serialNo: 'RE-1', title: '差旅', userId: 'u1' };
    },
  };
  const send = jest.fn(async (...args: any[]): Promise<any> => ({ id: `n${args[0]}` }));
  const engine = { send };
  const scheduler = new ApprovalReminderScheduler(
    approvalRecordRepo as any,
    userRepo as any,
    expenseRepo as any,
    engine as any,
  );
  return { scheduler, send, marked, records };
}

describe('ApprovalReminderScheduler', () => {
  it('sends reminders to the approver user id, not the approval record id', async () => {
    const { scheduler, send, marked } = harness();
    const messages = reminderMessage('差旅', '李四');

    await scheduler.tick();

    expect(send).toHaveBeenCalledWith(
      'u-approver',
      'approval_reminder',
      messages.email.subject,
      messages.sms,
      ['sms', 'email'],
      {
        emailBody: messages.email.body,
        sms: { templateKey: 'reminder', params: { code: 'RE-1' } },
      },
    );
    expect(marked).toEqual(['reminder:ar1']);
  });

  it('escalates once a reminder was already sent', async () => {
    const { scheduler, send, marked, records } = harness();
    records[0].reminderSentAt = new Date();
    const messages = escalationMessage('差旅', '李四');

    await scheduler.tick();

    expect(send).toHaveBeenCalledWith(
      'u-approver',
      'escalation',
      messages.email.subject,
      messages.sms,
      ['sms', 'email'],
      {
        emailBody: messages.email.body,
        sms: { templateKey: 'escalation', params: { code: 'RE-1' } },
      },
    );
    expect(marked).toEqual(['escalated:ar1']);
  });

  it('does not send or mark records that were already escalated', async () => {
    const { scheduler, send, marked, records } = harness();
    records[0].escalatedAt = new Date();

    await scheduler.tick();

    expect(send).not.toHaveBeenCalled();
    expect(marked).toEqual([]);
  });

  it('does not mark when the engine sends nothing', async () => {
    const { scheduler, send, marked } = harness();
    send.mockResolvedValue(null);

    await scheduler.tick();

    expect(send).toHaveBeenCalledTimes(1);
    expect(marked).toEqual([]);
  });

  it('marks when at least one approver send succeeds', async () => {
    const { scheduler, send, marked } = harness();
    const other = { id: 'u-approver-2', name: '王五', phone: '139', email: 'w@example.com' };
    (scheduler as any).userRepo.findByRole = async () => [
      { id: 'u-approver', name: '李四', phone: '138', email: 'l@example.com' },
      other,
    ];
    send.mockRejectedValueOnce(new Error('boom'));
    send.mockResolvedValueOnce({ id: 'n2' });

    await scheduler.tick();

    expect(send).toHaveBeenCalledTimes(2);
    expect(marked).toEqual(['reminder:ar1']);
  });
});
