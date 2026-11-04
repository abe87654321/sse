import {
  createNotificationEngine,
  type NotificationEngine,
  type NotificationMessage,
} from '@sse/notifications';

let engine: NotificationEngine | null = null;

function getEngine(): NotificationEngine {
  if (!engine) engine = createNotificationEngine();
  return engine;
}

export async function sendNotificationSafe(
  userId: string,
  message: NotificationMessage,
): Promise<void> {
  try {
    await getEngine().send(
      userId,
      message.type,
      message.title,
      message.body,
      message.channels,
      { emailBody: message.emailBody, sms: message.sms },
    );
  } catch (err: any) {
    console.warn('[Notification] 发送失败:', err?.message || err);
  }
}
