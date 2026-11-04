import Dysmsapi, * as $Dysmsapi from '@alicloud/dysmsapi20170525';
import { $OpenApiUtil } from '@alicloud/openapi-core';

export interface SmsProvider {
  send(phone: string, content: string): Promise<{ success: boolean }>;
}

export class DevSmsProvider implements SmsProvider {
  async send(phone: string, content: string): Promise<{ success: boolean }> {
    console.log(`[SMS] To: ${phone} | Content: ${content}`);
    return { success: true };
  }
}

export class AliyunSmsProvider implements SmsProvider {
  constructor(
    private accessKeyId: string,
    private accessKeySecret: string,
    private signName: string,
    private templateCode: string,
  ) {}

  async send(phone: string, content: string): Promise<{ success: boolean }> {
    try {
      const config = new $OpenApiUtil.Config({
        accessKeyId: this.accessKeyId,
        accessKeySecret: this.accessKeySecret,
      });
      config.endpoint = 'dysmsapi.aliyuncs.com';

      const client = new Dysmsapi(config);
      const request = new $Dysmsapi.SendSmsRequest({
        phoneNumbers: phone,
        signName: this.signName,
        templateCode: this.templateCode,
        templateParam: JSON.stringify({ content }),
      });

      const response = await client.sendSms(request);
      const ok = response.body?.code === 'OK';

      if (!ok) {
        console.error('[SMS] 阿里云返回失败:', response.body?.code, response.body?.message);
      }

      return { success: ok };
    } catch (err: any) {
      console.error('[SMS] 发送失败:', err?.message || err);
      return { success: false };
    }
  }
}

export function createSmsProvider(): SmsProvider {
  const providerType = process.env.SMS_PROVIDER ?? 'dev';

  if (providerType === 'dev' || providerType === 'log') {
    return new DevSmsProvider();
  }

  if (providerType === 'aliyun') {
    const accessKeyId = process.env.ALIYUN_ACCESS_KEY_ID || '';
    const accessKeySecret = process.env.ALIYUN_ACCESS_KEY_SECRET || '';
    const signName = process.env.ALIYUN_SMS_SIGN_NAME || '';
    const templateCode = process.env.ALIYUN_SMS_TEMPLATE_CODE || '';

    if (!accessKeyId || !accessKeySecret) {
      console.warn('[SMS] 阿里云短信配置不完整，回退到 dev 模式');
      return new DevSmsProvider();
    }

    return new AliyunSmsProvider(accessKeyId, accessKeySecret, signName, templateCode);
  }

  throw new Error(`不支持的短信服务商: ${providerType}`);
}
