export interface EmailProvider {
  send(email: string, subject: string, body: string): Promise<{ success: boolean }>;
}

export class DevEmailProvider implements EmailProvider {
  async send(email: string, subject: string, body: string): Promise<{ success: boolean }> {
    console.log(`[Email] To: ${email} | Subject: ${subject}`);
    console.log(`[Email] Body: ${body}`);
    return { success: true };
  }
}

export function createEmailProvider(): EmailProvider {
  const providerType = process.env.EMAIL_PROVIDER ?? 'dev';

  if (providerType === 'dev') {
    return new DevEmailProvider();
  }

  throw new Error(`不支持的邮件服务商: ${providerType}`);
}
