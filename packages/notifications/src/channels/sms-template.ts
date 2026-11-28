export type SmsTemplateKey = 'reminder' | 'escalation' | 'rejected' | 'paid' | 'broadcast';

export interface SmsMessage {
  templateKey: SmsTemplateKey;
  params?: Record<string, string>;
}

export const BROADCAST_SMS_TITLE_MAX = 20;
export const BROADCAST_SMS_BODY_MAX = 60;

export function resolveSmsTemplateCode(
  key: SmsTemplateKey,
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  return env[`ALIYUN_SMS_TEMPLATE_${key.toUpperCase()}`] || env.ALIYUN_SMS_TEMPLATE_CODE || undefined;
}

export function buildSmsTemplateParams(params?: Record<string, string>): string | undefined {
  if (!params || Object.keys(params).length === 0) return undefined;
  return JSON.stringify(params);
}

function clipSmsText(value: string, max: number): string {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

export function buildBroadcastSmsParams(title: string, body: string): Record<string, string> {
  return {
    title: clipSmsText(title, BROADCAST_SMS_TITLE_MAX),
    body: clipSmsText(body, BROADCAST_SMS_BODY_MAX),
  };
}

export function broadcastSmsMessage(
  title: string,
  body: string,
  env: NodeJS.ProcessEnv = process.env,
): SmsMessage {
  const hasDedicatedTemplate = Boolean(env.ALIYUN_SMS_TEMPLATE_BROADCAST);
  return hasDedicatedTemplate
    ? { templateKey: 'broadcast', params: buildBroadcastSmsParams(title, body) }
    : { templateKey: 'broadcast' };
}
