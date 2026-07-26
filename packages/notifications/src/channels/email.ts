import nodemailer from 'nodemailer';

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

export class SmtpEmailProvider implements EmailProvider {
  private transporter: nodemailer.Transporter;

  constructor(host: string, port: number, user: string, pass: string) {
    this.transporter = nodemailer.createTransport({
      host,
      port,
      secure: port === 465,
      auth: { user, pass },
    });
  }

  async send(email: string, subject: string, body: string): Promise<{ success: boolean }> {
    try {
      await this.transporter.sendMail({
        from: process.env.EMAIL_FROM || process.env.EMAIL_USER,
        to: email,
        subject,
        html: body,
      });
      return { success: true };
    } catch (err: any) {
      console.error('[Email] SMTP 发送失败:', err.message);
      return { success: false };
    }
  }
}

export function createEmailProvider(): EmailProvider {
  const providerType = process.env.EMAIL_PROVIDER ?? 'dev';

  if (providerType === 'dev' || providerType === 'log') {
    return new DevEmailProvider();
  }

  if (providerType === 'smtp') {
    const host = process.env.EMAIL_HOST;
    const port = Number(process.env.EMAIL_PORT) || 465;
    const user = process.env.EMAIL_USER;
    const pass = process.env.EMAIL_PASS;

    if (!host || !user || !pass) {
      console.warn('[Email] SMTP 配置不完整，回退到 dev 模式');
      return new DevEmailProvider();
    }

    return new SmtpEmailProvider(host, port, user, pass);
  }

  throw new Error(`不支持的邮件服务商: ${providerType}`);
}
