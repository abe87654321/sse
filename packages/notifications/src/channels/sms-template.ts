export type SmsTemplateKey = 'reminder' | 'escalation' | 'rejected' | 'paid' | 'broadcast';

export interface SmsMessage {
  templateKey: SmsTemplateKey;
  params?: Record<string, string>;
}

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
