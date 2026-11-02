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

export function classifyEngineError(error: any, context?: { status?: number }): EngineErrorInfo {
  const status = context?.status;
  const message = String(error?.message || error || '未知错误');
  const lower = message.toLowerCase();
  let code: EngineErrorCode = 'UNKNOWN';

  if (
    status === 401 || status === 403
    || /401|403|unauthorized|forbidden|认证|token|api key|a0202|a0211/.test(lower)
  ) {
    code = 'AUTH';
  } else if (
    error?.name === 'AbortError'
    || /timeout|timed out|abort|超时/.test(lower)
  ) {
    code = 'TIMEOUT';
  } else if (
    status === 404
    || /enotfound|econnrefused|eai_again|not found|连接|地址|network/.test(lower)
  ) {
    code = 'ADDRESS';
  } else if (/no result|未识别|未解析|empty/.test(lower)) {
    code = 'NO_RESULT';
  } else if (/json|parse|format|格式/.test(lower)) {
    code = 'FORMAT';
  }

  return { code, message, suggestion: SUGGESTIONS[code], status };
}
