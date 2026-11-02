import { classifyEngineError } from '../engine-error';

describe('classifyEngineError', () => {
  it('classifies auth errors', () => {
    expect(classifyEngineError(new Error('401 unauthorized'), { status: 401 }).code).toBe('AUTH');
    expect(classifyEngineError(new Error('MinerU A0202')).code).toBe('AUTH');
  });

  it('classifies address errors', () => {
    expect(classifyEngineError(new Error('connect ECONNREFUSED 127.0.0.1:11434')).code).toBe('ADDRESS');
    expect(classifyEngineError(new Error('HTTP 404'), { status: 404 }).code).toBe('ADDRESS');
  });

  it('classifies timeouts', () => {
    const error = new Error('aborted');
    error.name = 'AbortError';
    expect(classifyEngineError(error).code).toBe('TIMEOUT');
    expect(classifyEngineError(new Error('请求超时')).code).toBe('TIMEOUT');
  });

  it('classifies empty results and format errors', () => {
    expect(classifyEngineError(new Error('未识别到发票信息')).code).toBe('NO_RESULT');
    expect(classifyEngineError(new Error('返回格式异常 JSON parse failed')).code).toBe('FORMAT');
  });

  it('falls back to unknown with a suggestion', () => {
    const result = classifyEngineError(new Error('boom'));
    expect(result.code).toBe('UNKNOWN');
    expect(result.suggestion.length).toBeGreaterThan(0);
  });

  it('does not treat ports, elapsed times or token counts as auth', () => {
    expect(classifyEngineError(new Error('connect ECONNREFUSED 127.0.0.1:4030')).code).toBe('ADDRESS');
    expect(classifyEngineError(new Error('timed out after 4015ms')).code).toBe('TIMEOUT');
    expect(classifyEngineError(new Error('max tokens exceeded')).code).toBe('UNKNOWN');
  });

  it('reads status from the error itself', () => {
    const error: any = new Error('AI provider error 404');
    error.status = 404;
    expect(classifyEngineError(error).code).toBe('ADDRESS');

    const authError: any = new Error('request failed');
    authError.status = 401;
    expect(classifyEngineError(authError).code).toBe('AUTH');
  });

  it('matches credential phrases in Chinese and English', () => {
    expect(classifyEngineError(new Error('MinerU Token 无效')).code).toBe('AUTH');
    expect(classifyEngineError(new Error('token expired')).code).toBe('AUTH');
  });
});
