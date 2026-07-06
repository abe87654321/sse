export interface SmsProvider {
  send(phone: string, content: string): Promise<{ success: boolean }>;
}

export class DevSmsProvider implements SmsProvider {
  async send(phone: string, content: string): Promise<{ success: boolean }> {
    console.log(`[SMS] To: ${phone} | Content: ${content}`);
    return { success: true };
  }
}

export function createSmsProvider(): SmsProvider {
  const providerType = process.env.SMS_PROVIDER ?? 'dev';

  if (providerType === 'dev') {
    return new DevSmsProvider();
  }

  throw new Error(`不支持的短信服务商: ${providerType}`);
}
