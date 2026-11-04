import { buildSmsTemplateParams, resolveSmsTemplateCode } from '../channels/sms-template';

describe('resolveSmsTemplateCode', () => {
  it('prefers the per-event template', () => {
    expect(
      resolveSmsTemplateCode('paid', {
        ALIYUN_SMS_TEMPLATE_PAID: 'SMS_PAID',
        ALIYUN_SMS_TEMPLATE_CODE: 'SMS_FALLBACK',
      } as any)
    ).toBe('SMS_PAID');
  });

  it('falls back to the generic template', () => {
    expect(
      resolveSmsTemplateCode('paid', { ALIYUN_SMS_TEMPLATE_CODE: 'SMS_FALLBACK' } as any)
    ).toBe('SMS_FALLBACK');
  });

  it('returns undefined when nothing is configured', () => {
    expect(resolveSmsTemplateCode('paid', {} as any)).toBeUndefined();
  });
});

describe('buildSmsTemplateParams', () => {
  it('serializes params', () => {
    expect(buildSmsTemplateParams({ code: 'RE-1' })).toBe('{"code":"RE-1"}');
  });

  it('returns undefined for empty params', () => {
    expect(buildSmsTemplateParams({})).toBeUndefined();
    expect(buildSmsTemplateParams()).toBeUndefined();
  });
});
