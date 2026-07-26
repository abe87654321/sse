import type { IApprovalRecordRepo, INotificationLogRepo, IUserRepo, IExpenseRepo } from '@sse/core';
import { NotificationTriggerType } from '@sse/shared';
import type { NotificationService } from './notification-service';
import { reminderMessage } from './templates/reminder';
import { escalationMessage } from './templates/escalation';

export class ApprovalReminderScheduler {
  private intervalId: NodeJS.Timeout | null = null;

  constructor(
    private approvalRecordRepo: IApprovalRecordRepo,
    private notificationLogRepo: INotificationLogRepo,
    private userRepo: IUserRepo,
    private expenseRepo: IExpenseRepo,
    private notificationService: NotificationService,
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
    const overdueRecords = await this.approvalRecordRepo.findPendingOverdue();

    for (const record of overdueRecords) {
      try {
        const report = await this.expenseRepo.findById(record.reportId);
        if (!report) continue;

        const approvers = await this.findApproversForRecord(record, report);
        if (approvers.length === 0) continue;

        const isEscalation = record.reminderSentAt != null;
        const triggerType = isEscalation
          ? NotificationTriggerType.ESCALATION
          : NotificationTriggerType.APPROVAL_REMINDER;

        for (const approver of approvers) {
          const messages = isEscalation
            ? escalationMessage(report.title, approver.name)
            : reminderMessage(report.title, approver.name);

          await this.sendSmsAndLog(record.id, record.reportId, approver.phone, messages.sms, triggerType);

          if (approver.email) {
            await this.sendEmailAndLog(
              record.id,
              record.reportId,
              approver.email,
              messages.email.subject,
              messages.email.body,
              triggerType,
            );
          }
        }

        if (isEscalation) {
          await this.approvalRecordRepo.markEscalated(record.id);
        } else {
          await this.approvalRecordRepo.markReminderSent(record.id);
        }
      } catch (err) {
        console.error(`[Scheduler] 处理审批记录 ${record.id} 失败:`, err);
      }
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

  private async sendSmsAndLog(
    recipientId: string,
    reportId: string,
    phone: string,
    content: string,
    triggerType: NotificationTriggerType,
  ): Promise<void> {
    try {
      await this.notificationService.sendSms(phone, content);
    } catch {
      // SMS_FAILED silently for now
    }

    await this.notificationLogRepo.create({
      user_id: recipientId,
      type: triggerType,
      title: '审批提醒',
      body: content,
    });
  }

  private async sendEmailAndLog(
    recipientId: string,
    reportId: string,
    email: string,
    subject: string,
    body: string,
    triggerType: NotificationTriggerType,
  ): Promise<void> {
    try {
      await this.notificationService.sendEmail(email, subject, body);
    } catch {
      // EMAIL_FAILED silently for now
    }

    await this.notificationLogRepo.create({
      user_id: recipientId,
      type: triggerType,
      title: subject,
      body,
    });
  }
}
