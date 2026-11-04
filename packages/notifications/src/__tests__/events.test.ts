import { NotificationTriggerType } from '@sse/shared';
import {
  expenseApprovedMessage,
  expenseRejectedMessage,
  paymentPaidMessage,
  welcomeMessage,
} from '../events';

const report = { serialNo: 'RE-2026-001', title: '差旅报销' };
const user = { id: 'u1', name: '张三' };

describe('notification events', () => {
  it('builds an in-app only approval message', () => {
    expect(expenseApprovedMessage(report)).toEqual({
      type: NotificationTriggerType.APPROVED,
      title: '报销单已通过',
      body: '你的报销单 RE-2026-001「差旅报销」已全部审批通过。',
      channels: [],
    });
  });

  it('builds a rejection message with comment, sms and email', () => {
    expect(expenseRejectedMessage(report, '发票不符')).toEqual({
      type: NotificationTriggerType.REJECTED,
      title: '报销单被驳回',
      body: '你的报销单 RE-2026-001「差旅报销」被驳回：发票不符',
      channels: ['sms', 'email'],
      emailBody: '<p>你的报销单 RE-2026-001「差旅报销」被驳回：发票不符</p>',
      sms: { templateKey: 'rejected', params: { code: 'RE-2026-001' } },
    });
  });

  it('escapes html in the rejection email body', () => {
    const message = expenseRejectedMessage(
      { serialNo: 'RE-1', title: '<b>x</b>' },
      '<img src=x onerror=alert(1)>',
    );

    expect(message.emailBody).toContain('&lt;b&gt;x&lt;/b&gt;');
    expect(message.emailBody).toContain('&lt;img');
    expect(message.emailBody).not.toContain('<img');
    expect(message.emailBody).not.toContain('<b>');
  });

  it('does not throw for a numeric reject comment', () => {
    const message = expenseRejectedMessage({ serialNo: 'x', title: 't' }, 123 as any);
    expect(message.emailBody).toContain('123');
  });

  it('does not throw for a null reject comment', () => {
    const message = expenseRejectedMessage({ serialNo: 'x', title: 't' }, null as any);
    expect(message.emailBody).toContain('被驳回：</p>');
  });

  it('builds a paid message with sms and email', () => {
    expect(paymentPaidMessage(report)).toEqual({
      type: NotificationTriggerType.PAID,
      title: '报销款已支付',
      body: '你的报销单 RE-2026-001「差旅报销」已完成打款。',
      channels: ['sms', 'email'],
      sms: { templateKey: 'paid', params: { code: 'RE-2026-001' } },
    });
  });

  it('builds a welcome email', () => {
    expect(welcomeMessage(user)).toEqual({
      type: NotificationTriggerType.WELCOME,
      title: '欢迎加入 SSE',
      body: '张三，你的账号已创建，请登录系统完善个人信息。',
      channels: ['email'],
      emailBody: '<p>张三，你的账号已创建，请登录系统完善个人信息。</p>',
    });
  });
});
