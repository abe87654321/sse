import {
  buildChatUrl,
  buildModelsUrl,
  buildOllamaTagsUrl,
  classifyEngineError,
  classifyModel,
  isHttpUrl,
  type EngineErrorInfo,
  type ModelTag,
} from '@sse/ai';

type FetchInit = NonNullable<Parameters<typeof fetch>[1]>;

export interface ProbeModel {
  id: string;
  name: string;
  owner?: string;
  metadata?: Record<string, any>;
  autoTags: ModelTag[];
}

export interface ModelListResult {
  models: ProbeModel[];
  source: 'openai' | 'ollama';
  elapsedMs: number;
}

export interface ProbeStep {
  name: 'models' | 'chat';
  ok: boolean;
  status?: number;
  elapsedMs: number;
  message?: string;
  modelCount?: number;
  model?: string;
  error?: EngineErrorInfo;
}

export interface ConnectionTestResult {
  success: boolean;
  message: string;
  steps: ProbeStep[];
}

export interface ProbeOptions {
  endpoint: string;
  apiKey?: string;
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 20_000;

function httpError(status: number, body: any): any {
  const message = typeof body === 'string' ? body.slice(0, 300) : JSON.stringify(body || {}).slice(0, 300);
  const error: any = new Error(`HTTP ${status}${message ? `: ${message}` : ''}`);
  error.status = status;
  return error;
}

function authHeaders(apiKey?: string): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
  };
}

async function fetchJson(
  url: string,
  init: FetchInit,
  timeoutMs: number,
): Promise<{ status: number; ok: boolean; body: any }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, redirect: 'manual', signal: controller.signal });
    if (res.status >= 300 && res.status < 400) {
      throw httpError(res.status, '重定向被拒绝');
    }
    const contentLength = Number(res.headers.get('content-length'));
    if (Number.isFinite(contentLength) && contentLength > 5_000_000) {
      throw new Error('响应体过大');
    }
    const text = await res.text();
    let body: any = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = text;
    }
    return { status: res.status, ok: res.ok, body };
  } catch (error: any) {
    if (error?.name === 'AbortError') {
      throw new Error(`请求超时（${Math.round(timeoutMs / 1000)}s）`);
    }
    const cause = error?.cause?.message || error?.cause?.code || error?.cause?.errno;
    if (cause && !String(error?.message || '').includes(String(cause))) {
      const wrapped: any = new Error(`${error?.message || '请求失败'}: ${cause}`);
      if (error?.status !== undefined) wrapped.status = error.status;
      throw wrapped;
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function normalizeModels(body: any, source: 'openai' | 'ollama'): ProbeModel[] {
  const raw: any[] = Array.isArray(body)
    ? body
    : Array.isArray(body?.data)
      ? body.data
      : Array.isArray(body?.models)
        ? body.models
        : [];

  return raw
    .map((item: any) => {
      const id = String(item?.id || item?.model || item?.name || '').trim();
      if (!id) return null;
      const name = String(item?.name || item?.id || item?.model || id);
      const owner = item?.owned_by || item?.owner || item?.details?.family;
      return {
        id,
        name,
        owner,
        metadata: item,
        autoTags: classifyModel({ id, name, owner, metadata: item, source }),
      } as ProbeModel;
    })
    .filter((model): model is ProbeModel => model !== null);
}

export async function fetchModelList(options: ProbeOptions): Promise<ModelListResult> {
  const endpoint = String(options.endpoint || '').trim();
  if (!isHttpUrl(endpoint)) {
    throw new Error('API 地址必须以 http:// 或 https:// 开头');
  }
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const start = Date.now();

  try {
    const response = await fetchJson(
      buildModelsUrl(endpoint),
      { headers: authHeaders(options.apiKey) },
      timeoutMs,
    );
    if (!response.ok) throw httpError(response.status, response.body);
    const openAiBody = response.body;
    const looksLikeOpenAi = Array.isArray(openAiBody)
      || Array.isArray(openAiBody?.data)
      || Array.isArray(openAiBody?.models);
    if (looksLikeOpenAi) {
      return {
        models: normalizeModels(openAiBody, 'openai'),
        source: 'openai',
        elapsedMs: Date.now() - start,
      };
    }
  } catch (error: any) {
    if (error?.status !== 404) throw error;
  }

  const response = await fetchJson(
    buildOllamaTagsUrl(endpoint),
    { headers: authHeaders(options.apiKey) },
    timeoutMs,
  );
  if (!response.ok) throw httpError(response.status, response.body);
  return {
    models: normalizeModels(response.body, 'ollama'),
    source: 'ollama',
    elapsedMs: Date.now() - start,
  };
}

async function testChat(
  options: ProbeOptions & { model: string },
): Promise<{ status: number; elapsedMs: number }> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const start = Date.now();
  const response = await fetchJson(
    buildChatUrl(options.endpoint),
    {
      method: 'POST',
      headers: authHeaders(options.apiKey),
      body: JSON.stringify({
        model: options.model,
        messages: [{ role: 'user', content: 'ping' }],
        max_tokens: 1,
        temperature: 0,
      }),
    },
    timeoutMs,
  );
  if (!response.ok) throw httpError(response.status, response.body);
  return { status: response.status, elapsedMs: Date.now() - start };
}

export async function testConnection(
  options: ProbeOptions & { model?: string },
): Promise<ConnectionTestResult> {
  const steps: ProbeStep[] = [];

  let modelList: ModelListResult | null = null;
  const modelStart = Date.now();
  try {
    modelList = await fetchModelList(options);
    steps.push({
      name: 'models',
      ok: true,
      elapsedMs: Date.now() - modelStart,
      modelCount: modelList.models.length,
      message: `读取到 ${modelList.models.length} 个模型`,
    });
  } catch (error: any) {
    const info = classifyEngineError(error, { status: error?.status });
    steps.push({
      name: 'models',
      ok: false,
      elapsedMs: Date.now() - modelStart,
      error: info,
      message: info.message,
    });
    return { success: false, message: info.message, steps };
  }

  if (!modelList) {
    return { success: false, message: '读取模型列表失败', steps };
  }

  const model = String(options.model || '').trim() || modelList.models[0]?.id || '';
  if (!model) {
    const info: EngineErrorInfo = {
      code: 'NO_RESULT',
      message: '未获取到可用模型',
      suggestion: '请确认地址正确，或手动填写模型 ID',
    };
    steps.push({ name: 'chat', ok: false, elapsedMs: 0, error: info, message: info.message });
    return { success: false, message: info.message, steps };
  }

  const chatStart = Date.now();
  try {
    const chat = await testChat({ ...options, model });
    steps.push({
      name: 'chat',
      ok: true,
      status: chat.status,
      elapsedMs: chat.elapsedMs,
      model,
      message: `模型 ${model} 响应正常`,
    });
    return { success: true, message: '连接成功', steps };
  } catch (error: any) {
    const info = classifyEngineError(error, { status: error?.status });
    steps.push({
      name: 'chat',
      ok: false,
      elapsedMs: Date.now() - chatStart,
      error: info,
      message: info.message,
    });
    return { success: false, message: info.message, steps };
  }
}
