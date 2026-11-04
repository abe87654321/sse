import type { IApprovalRecordRepo, IUserRepo, IExpenseRepo } from '@sse/core';
import { NotificationTriggerType } from '@sse/shared';
import type { NotificationEngine } from './notification-engine';
import { reminderMessage } from './templates/reminder';
import { escalationMessage } from './templates/escalation';

export class ApprovalReminderScheduler {
  private intervalId: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private approvalRecordRepo: IApprovalRecordRepo,
    private userRepo: IUserRepo,
    private expenseRepo: IExpenseRepo,
    private notificationEngine: NotificationEngine,
  ) {}

  start(): void {
    this.intervalId = setInterval(() => this.tick(), 15 * 60 * 1000);
    this.tick().catch((err) => console.error('[Scheduler] 启动扫描失败:', err));
  }

  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const overdueRecords = await this.approvalRecordRepo.findPendingOverdue();

      for (const record of overdueRecords) {
        if (record.escalatedAt) continue;

        try {
          const report = await this.expenseRepo.findById(record.reportId);
          if (!report) continue;

          const approvers = await this.findApproversForRecord(record, report);
          if (approvers.length === 0) continue;

          const isEscalation = record.reminderSentAt != null;
          const triggerType = isEscalation
            ? NotificationTriggerType.ESCALATION
            : NotificationTriggerType.APPROVAL_REMINDER;

          let sentAny = false;
          for (const approver of approvers) {
            const messages = isEscalation
              ? escalationMessage(report.title, approver.name)
              : reminderMessage(report.title, approver.name);

            try {
              const log = await this.notificationEngine.send(
                approver.id,
                triggerType,
                messages.email.subject,
                messages.sms,
                ['sms', 'email'],
                {
                  emailBody: messages.email.body,
                  sms: {
                    templateKey: isEscalation ? 'escalation' : 'reminder',
                    params: { code: report.serialNo },
                  },
                },
              );
              if (log) sentAny = true;
            } catch (err) {
              console.error(`[Scheduler] 发送提醒给 ${approver.id} 失败:`, err);
            }
          }

          if (!sentAny) continue;

          if (isEscalation) {
            await this.approvalRecordRepo.markEscalated(record.id);
          } else {
            await this.approvalRecordRepo.markReminderSent(record.id);
          }
        } catch (err) {
          console.error(`[Scheduler] 处理审批记录 ${record.id} 失败:`, err);
        }
      }
    } finally {
      this.running = false;
    }
  }

  private async findApproversForRecord(record: any, report: any): Promise<any[]> {
    const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (uuidPattern.test(record.approverId)) {
      const user = await this.userRepo.findById(record.approverId);
      if (user) return [user];
    }

    const reporter = await this.userRepo.findById(report.userId);
    const department = reporter?.department;

    return this.userRepo.findByRole(record.approverId, department);
  }
}
