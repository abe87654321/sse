export type EngineErrorCode = 'AUTH' | 'ADDRESS' | 'TIMEOUT' | 'NO_RESULT' | 'FORMAT' | 'UNKNOWN';

export interface EngineErrorInfo {
  code: EngineErrorCode;
  message: string;
  suggestion: string;
  status?: number;
}

const SUGGESTIONS: Record<EngineErrorCode, string> = {
  AUTH: '检查 API 密钥或 Token 是否正确、是否过期',
  ADDRESS: '检查 API 地址、端口和路径是否正确，服务是否已启动',
  TIMEOUT: '检查服务负载，或适当延长超时时间',
  NO_RESULT: '确认文件是有效发票，或尝试更换 OCR 引擎',
  FORMAT: '检查服务返回格式是否符合预期',
  UNKNOWN: '查看原始错误信息并检查服务日志',
};

const AUTH_TEXT = /\b401\b|\b403\b|unauthorized|forbidden|认证|api key|a0202|a0211/;
const CREDENTIAL_TEXT = /\btokens?\b[^\n]{0,40}?(invalid|expired|missing|not configured|无效|过期|未配置)|令牌/;
const TIMEOUT_TEXT = /timeout|timed out|abort|超时/;
const ADDRESS_TEXT = /\b404\b|enotfound|econnrefused|eai_again|not found|连接|地址|network/;
const NO_RESULT_TEXT = /no result|未识别|未解析|empty/;
const FORMAT_TEXT = /json|parse|format|格式/;

export function classifyEngineError(error: any, context?: { status?: number }): EngineErrorInfo {
  const rawStatus = context?.status ?? error?.status ?? error?.response?.status;
  const status = rawStatus === undefined || rawStatus === null ? undefined : Number(rawStatus);
  const message = String(error?.message || error || '未知错误');
  const lower = message.toLowerCase();
  let code: EngineErrorCode = 'UNKNOWN';

  if (status === 401 || status === 403) {
    code = 'AUTH';
  } else if (status === 408) {
    code = 'TIMEOUT';
  } else if (status === 404) {
    code = 'ADDRESS';
  } else if (AUTH_TEXT.test(lower) || CREDENTIAL_TEXT.test(lower)) {
    code = 'AUTH';
  } else if (error?.name === 'AbortError' || TIMEOUT_TEXT.test(lower)) {
    code = 'TIMEOUT';
  } else if (ADDRESS_TEXT.test(lower)) {
    code = 'ADDRESS';
  } else if (NO_RESULT_TEXT.test(lower)) {
    code = 'NO_RESULT';
  } else if (FORMAT_TEXT.test(lower)) {
    code = 'FORMAT';
  }

  return { code, message, suggestion: SUGGESTIONS[code], status };
}
