export function escalationMessage(
  reportTitle: string,
  approverName: string,
): { sms: string; email: { subject: string; body: string } } {
  return {
    sms: `【报销催办】${approverName}您好，报销单"${reportTitle}"已超过24小时未审批，请尽快处理。`,
    email: {
      subject: `报销催办提醒 - ${reportTitle}`,
      body: `<p>${approverName}您好，</p><p>报销单"${reportTitle}"已超过24小时未审批，请尽快登录系统处理。</p>`,
    },
  };
}
