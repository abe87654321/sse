import {
  BROADCAST_SMS_BODY_MAX,
  BROADCAST_SMS_TITLE_MAX,
  broadcastSmsMessage,
  buildBroadcastSmsParams,
  buildSmsTemplateParams,
  resolveSmsTemplateCode,
} from '../channels/sms-template';

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

describe('buildBroadcastSmsParams', () => {
  it('keeps short title and body unchanged', () => {
    expect(buildBroadcastSmsParams('系统公告', '本月报销截止日变更')).toEqual({
      title: '系统公告',
      body: '本月报销截止日变更',
    });
  });

  it('collapses whitespace', () => {
    expect(buildBroadcastSmsParams('  标题\n换行   空格  ', '正文\r\n内容')).toEqual({
      title: '标题 换行 空格',
      body: '正文 内容',
    });
  });

  it('clips title and body to the Aliyun variable limits', () => {
    const params = buildBroadcastSmsParams('标'.repeat(50), '正'.repeat(120));

    expect(params.title).toHaveLength(BROADCAST_SMS_TITLE_MAX);
    expect(params.title).toBe(`${'标'.repeat(BROADCAST_SMS_TITLE_MAX - 1)}…`);
    expect(params.body).toHaveLength(BROADCAST_SMS_BODY_MAX);
    expect(params.body).toBe(`${'正'.repeat(BROADCAST_SMS_BODY_MAX - 1)}…`);
  });
});

describe('broadcastSmsMessage', () => {
  it('sends title/body params when a dedicated broadcast template is configured', () => {
    expect(
      broadcastSmsMessage('系统公告', '正文内容', {
        ALIYUN_SMS_TEMPLATE_BROADCAST: 'SMS_BROADCAST',
      } as any),
    ).toEqual({
      templateKey: 'broadcast',
      params: { title: '系统公告', body: '正文内容' },
    });
  });

  it('omits params when only the generic template is available', () => {
    expect(
      broadcastSmsMessage('系统公告', '正文内容', {
        ALIYUN_SMS_TEMPLATE_CODE: 'SMS_FALLBACK',
      } as any),
    ).toEqual({ templateKey: 'broadcast' });
  });
});
