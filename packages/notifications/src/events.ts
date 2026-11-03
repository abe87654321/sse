import { NotificationTriggerType } from '@sse/shared';
import { escapeHtml } from './utils/html';

export type NotificationMessage = {
  type: NotificationTriggerType;
  title: string;
  body: string;
  channels: ('sms' | 'email')[];
  emailBody?: string;
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
    channels: ['sms', 'email'],
    emailBody: `<p>你的报销单 ${escapeHtml(report.serialNo)}「${escapeHtml(report.title)}」被驳回：${escapeHtml(comment)}</p>`,
  };
}

export function paymentPaidMessage(report: { serialNo: string; title: string }): NotificationMessage {
  return {
    type: NotificationTriggerType.PAID,
    title: '报销款已支付',
    body: `你的报销单 ${report.serialNo}「${report.title}」已完成打款。`,
    channels: ['sms', 'email'],
  };
}

export function welcomeMessage(user: { name: string }): NotificationMessage {
  return {
    type: NotificationTriggerType.WELCOME,
    title: '欢迎加入 SSE',
    body: `${user.name}，你的账号已创建，请登录系统完善个人信息。`,
    channels: ['email'],
    emailBody: `<p>${escapeHtml(user.name)}，你的账号已创建，请登录系统完善个人信息。</p>`,
  };
}
