import { NotificationTriggerType } from '@sse/shared';

export type NotificationMessage = {
  type: string;
  title: string;
  body: string;
  channels: ('sms' | 'email')[];
};

export function expenseApprovedMessage(report: { serialNo: string; title: string }): NotificationMessage {
  return {
    type: NotificationTriggerType.APPROVED,
    title: '报销单已通过',
    body: `你的报销单 ${report.serialNo}「${report.title}」已全部审批通过。`,
    channels: [],
  };
}

export function expenseRejectedMessage(
  report: { serialNo: string; title: string },
  comment: string,
): NotificationMessage {
  return {
    type: NotificationTriggerType.REJECTED,
    title: '报销单被驳回',
    body: `你的报销单 ${report.serialNo}「${report.title}」被驳回：${comment}`,
    channels: ['email'],
  };
}

export function paymentPaidMessage(report: { serialNo: string; title: string }): NotificationMessage {
  return {
    type: NotificationTriggerType.PAID,
    title: '报销款已支付',
    body: `你的报销单 ${report.serialNo}「${report.title}」已完成打款。`,
    channels: ['sms'],
  };
}

export function welcomeMessage(user: { name: string }): NotificationMessage {
  return {
    type: NotificationTriggerType.WELCOME,
    title: '欢迎加入 SSE',
    body: `${user.name}，你的账号已创建，请登录系统完善个人信息。`,
    channels: ['email'],
  };
}
