export function reminderMessage(
  reportTitle: string,
  approverName: string,
): { sms: string; email: { subject: string; body: string } } {
  return {
    sms: `【报销提醒】${approverName}您好，有一笔报销"${reportTitle}"等待您审批，请及时处理。`,
    email: {
      subject: `报销审批提醒 - ${reportTitle}`,
      body: `<p>${approverName}您好，</p><p>报销单"${reportTitle}"等待您审批，请登录系统处理。</p>`,
    },
  };
}
