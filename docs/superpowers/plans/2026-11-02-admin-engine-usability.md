# 系统管理引擎设置可用性优化 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把智能填单/发票 OCR 的配置从「手写完整接口路径」改为「根地址 + 密钥 + 一键检测 + 模型清单选择」，并让 OCR 测试结果可观测、可复现。

**Architecture:** 地址归一化、模型分类、配置合并、错误分类、历史截断等纯逻辑放进 `@sse/ai` 并做单元测试；API 层只负责 HTTP、文件读取和路由编排；前端抽出 `ModelPickerDialog.vue` 与 `EngineTestPanel.vue`，`Admin.vue` 只做状态编排。

**Tech Stack:** TypeScript、Node.js 18 fetch、Jest + ts-jest、Express、Vue 3 `<script setup>`、pnpm workspace。

---

## 文件结构

### 新增

| 文件 | 职责 |
|---|---|
| `packages/ai/src/utils/endpoint.ts` | 地址校验、根地址归一化、models/chat/tags URL 推导 |
| `packages/ai/src/utils/model-tagger.ts` | 模型标签分类与手动标签覆盖 |
| `packages/ai/src/utils/engine-error.ts` | 引擎错误分类与修复建议 |
| `packages/ai/src/utils/test-history.ts` | 历史条目脱敏、原始文本截断、条数上限 |
| `packages/ai/src/config/ai-config.ts` | AI 配置类型、默认值、归一化、脱敏、补丁应用 |
| `packages/ai/src/config/model-catalog.ts` | 模型清单合并、选中切换、当前模型回退 |
| `packages/api/src/services/ai-engine-probe.ts` | 拉模型列表、最小对话、连通检测 |
| `packages/api/src/services/ai-test-history.ts` | `ai-test-history.json` 读写与清空 |
| `packages/web/src/components/ModelPickerDialog.vue` | 模型搜索/分类/刷新/+−/手动标签对话框 |
| `packages/web/src/components/EngineTestPanel.vue` | OCR 测试结果、样例上传、历史记录面板 |
| `packages/web/src/utils/endpoint.ts` | 前端地址归一化，用于按地址查找已缓存模型清单 |

### 修改

| 文件 | 改动 |
|---|---|
| `packages/ai/src/index.ts` | 导出新增工具与类型 |
| `packages/ai/src/providers/local-provider.ts` | 支持根地址、透传 apiKey |
| `packages/ai/src/providers/__tests__/local-provider.test.ts` | 增加根地址与密钥测试 |
| `packages/api/src/services/ai-engines.ts` | 使用新配置类型、密钥透传 |
| `packages/api/src/routes/admin.ts` | 新检测/模型/测试/历史接口 |
| `packages/api/src/middleware/upload.ts` | 增加 20MB 样例上传中间件 |
| `packages/api/src/index.ts` | 本体引擎透传 apiKey |
| `packages/api/src/routes/ontology-helpers.ts` | 使用统一配置并透传 apiKey |
| `packages/mcp/src/tools/get-engine.ts` | 透传 apiKey |
| `packages/ontology/src/entity-extractor.ts` | 构造函数接收 apiKey |
| `packages/ontology/src/nlp-generator.ts` | 构造函数接收 apiKey |
| `packages/ontology/src/index.ts` | `OntologyEngine` 接收 apiKey |
| `packages/web/src/pages/Admin.vue` | 接入新字段、对话框、测试面板 |
| `.gitignore` | 忽略 `ai-test-history.json` |

---

### Task 1: 地址归一化工具

**Files:**
- Create: `packages/ai/src/utils/endpoint.ts`
- Test: `packages/ai/src/utils/__tests__/endpoint.test.ts`
- Modify: `packages/ai/src/index.ts`

- [ ] **Step 1: 写失败测试**

```ts
// packages/ai/src/utils/__tests__/endpoint.test.ts
import {
  buildChatUrl,
  buildModelsUrl,
  buildOllamaTagsUrl,
  deriveApiBase,
  isHttpUrl,
  normalizeServiceBase,
  resolveChatUrl,
} from '../endpoint';

describe('endpoint utils', () => {
  it('normalizes a service root', () => {
    expect(normalizeServiceBase('http://192.168.3.117:11434/')).toBe('http://192.168.3.117:11434');
  });

  it('strips /v1 and /chat/completions from old full URLs', () => {
    expect(normalizeServiceBase('http://192.168.3.117:11434/v1')).toBe('http://192.168.3.117:11434');
    expect(normalizeServiceBase('http://192.168.3.117:11434/v1/chat/completions'))
      .toBe('http://192.168.3.117:11434');
    expect(normalizeServiceBase('https://openrouter.ai/api/v1'))
      .toBe('https://openrouter.ai/api');
  });

  it('derives OpenAI-compatible URLs from a service base', () => {
    expect(deriveApiBase('http://192.168.3.117:11434')).toBe('http://192.168.3.117:11434/v1');
    expect(buildModelsUrl('http://192.168.3.117:11434')).toBe('http://192.168.3.117:11434/v1/models');
    expect(buildChatUrl('http://192.168.3.117:11434')).toBe('http://192.168.3.117:11434/v1/chat/completions');
    expect(buildModelsUrl('https://openrouter.ai/api')).toBe('https://openrouter.ai/api/v1/models');
    expect(buildOllamaTagsUrl('http://192.168.3.117:11434')).toBe('http://192.168.3.117:11434/api/tags');
  });

  it('keeps a full chat URL untouched for LocalProvider compatibility', () => {
    expect(resolveChatUrl('http://host:11434/v1/chat/completions'))
      .toBe('http://host:11434/v1/chat/completions');
    expect(resolveChatUrl('http://host:11434')).toBe('http://host:11434/v1/chat/completions');
  });

  it('validates http and https only', () => {
    expect(isHttpUrl('http://host:11434')).toBe(true);
    expect(isHttpUrl('https://host')).toBe(true);
    expect(isHttpUrl('file:///etc/passwd')).toBe(false);
    expect(isHttpUrl('')).toBe(false);
  });

  it('returns empty strings for empty input', () => {
    expect(normalizeServiceBase('')).toBe('');
    expect(deriveApiBase('')).toBe('');
    expect(buildModelsUrl('')).toBe('');
    expect(buildChatUrl('')).toBe('');
    expect(resolveChatUrl('')).toBe('');
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm --filter @sse/ai test -- endpoint.test.ts`
Expected: FAIL，提示找不到 `../endpoint`。

- [ ] **Step 3: 实现工具**

```ts
// packages/ai/src/utils/endpoint.ts
const CHAT_SUFFIX = '/chat/completions';

export function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(String(value || '').trim());
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

export function normalizeServiceBase(input: string): string {
  let value = String(input || '').trim().replace(/\/+$/, '');
  if (!value) return '';
  if (value.toLowerCase().endsWith(CHAT_SUFFIX)) {
    value = value.slice(0, -CHAT_SUFFIX.length).replace(/\/+$/, '');
  }
  if (value.toLowerCase().endsWith('/v1')) {
    value = value.slice(0, -3).replace(/\/+$/, '');
  }
  return value;
}

export function deriveApiBase(base: string): string {
  const normalized = normalizeServiceBase(base);
  if (!normalized) return '';
  return normalized.toLowerCase().endsWith('/v1') ? normalized : `${normalized}/v1`;
}

export function buildModelsUrl(base: string): string {
  const apiBase = deriveApiBase(base);
  return apiBase ? `${apiBase}/models` : '';
}

export function buildChatUrl(base: string): string {
  const apiBase = deriveApiBase(base);
  return apiBase ? `${apiBase}/chat/completions` : '';
}

export function buildOllamaTagsUrl(base: string): string {
  const normalized = normalizeServiceBase(base);
  return normalized ? `${normalized}/api/tags` : '';
}

export function resolveChatUrl(input: string): string {
  const trimmed = String(input || '').trim().replace(/\/+$/, '');
  if (!trimmed) return '';
  if (trimmed.toLowerCase().endsWith(CHAT_SUFFIX)) return trimmed;
  return buildChatUrl(trimmed);
}
```

- [ ] **Step 4: 导出并运行测试**

`packages/ai/src/index.ts` 增加：

```ts
export * from './utils/endpoint';
```

Run: `pnpm --filter @sse/ai test -- endpoint.test.ts`
Expected: PASS，6 个用例通过。

- [ ] **Step 5: 提交**

```bash
git add packages/ai/src/utils/endpoint.ts packages/ai/src/utils/__tests__/endpoint.test.ts packages/ai/src/index.ts
git commit -m "feat(ai): normalize engine service endpoints"
```

---

### Task 2: 模型标签分类

**Files:**
- Create: `packages/ai/src/utils/model-tagger.ts`
- Test: `packages/ai/src/utils/__tests__/model-tagger.test.ts`
- Modify: `packages/ai/src/index.ts`

- [ ] **Step 1: 写失败测试**

```ts
// packages/ai/src/utils/__tests__/model-tagger.test.ts
import { classifyModel, effectiveTags, MODEL_TAGS } from '../model-tagger';

describe('classifyModel', () => {
  it('uses OpenRouter modalities, pricing and supported parameters', () => {
    const tags = classifyModel({
      id: 'google/gemini-2.0-flash',
      source: 'openrouter',
      metadata: {
        architecture: { input_modalities: ['text', 'image'] },
        pricing: { prompt: '0', completion: '0' },
        supported_parameters: ['tools', 'tool_choice'],
      },
    });
    expect(tags).toContain('视觉');
    expect(tags).toContain('免费');
    expect(tags).toContain('工具');
  });

  it('uses Ollama capabilities and details', () => {
    expect(classifyModel({
      id: 'llava:7b',
      source: 'ollama',
      metadata: { capabilities: ['vision', 'tools'], details: { family: 'llava' } },
    })).toEqual(expect.arrayContaining(['视觉', '工具']));
  });

  it('falls back to name heuristics', () => {
    expect(classifyModel({ id: 'deepseek-r1:8b' })).toContain('推理');
    expect(classifyModel({ id: 'bge-reranker-v2-m3' })).toEqual(['重排']);
    expect(classifyModel({ id: 'nomic-embed-text' })).toContain('嵌入');
    expect(classifyModel({ id: 'qwen2.5-vl:7b' })).toEqual(expect.arrayContaining(['视觉', '工具']));
  });

  it('returns no tags for unknown models', () => {
    expect(classifyModel({ id: 'totally-unknown-model' })).toEqual([]);
  });

  it('returns tags in stable order', () => {
    const tags = classifyModel({ id: 'qwen2.5-vl:7b' });
    expect(tags).toEqual(MODEL_TAGS.filter(tag => tags.includes(tag)));
  });
});

describe('effectiveTags', () => {
  it('manual tags override auto tags', () => {
    expect(effectiveTags({ autoTags: ['推理'], manualTags: ['视觉', '免费'] }))
      .toEqual(['视觉', '免费']);
  });

  it('falls back to auto tags when manual tags are empty', () => {
    expect(effectiveTags({ autoTags: ['推理'], manualTags: [] })).toEqual(['推理']);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm --filter @sse/ai test -- model-tagger.test.ts`
Expected: FAIL，提示找不到 `../model-tagger`。

- [ ] **Step 3: 实现分类器**

```ts
// packages/ai/src/utils/model-tagger.ts
export type ModelTag = '推理' | '视觉' | '联网' | '免费' | '嵌入' | '重排' | '工具';

export const MODEL_TAGS: ModelTag[] = ['推理', '视觉', '联网', '免费', '嵌入', '重排', '工具'];

export interface ModelDescriptor {
  id: string;
  name?: string;
  owner?: string;
  metadata?: Record<string, any>;
  source?: 'openai' | 'ollama' | 'openrouter' | string;
}

const REASONING_PATTERNS = [
  /(^|[/:_-])r1([/:_-]|$)/i,
  /reason/i,
  /qwq/i,
  /thinking/i,
  /(^|[/:_-])o[1-4]([/:_-]|$)/i,
  /deepseek-r1/i,
  /phi-4-reasoning/i,
];

const VISION_PATTERNS = [
  /(^|[/:_-])vl([/:_-]|$)/i,
  /vision/i,
  /llava/i,
  /pixtral/i,
  /moondream/i,
  /minicpm-v/i,
  /gemma3/i,
  /glm-4v/i,
  /internvl/i,
  /cogvlm/i,
];

const EMBEDDING_PATTERNS = [
  /embed/i,
  /(^|[/:_-])bge([/:_-]|$)/i,
  /e5-/i,
  /(^|[/:_-])gte([/:_-]|$)/i,
  /nomic-embed/i,
  /jina-embed/i,
  /text-embedding/i,
];

const RERANK_PATTERNS = [
  /rerank/i,
  /bge-reranker/i,
  /jina-rerank/i,
];

const ONLINE_PATTERNS = [
  /:online/i,
  /(^|[/:_-])web([/:_-]|$)/i,
  /search/i,
  /sonar/i,
  /perplexity/i,
];

const TOOL_PATTERNS = [
  /gpt-4/i,
  /gpt-3\.5/i,
  /(^|[/:_-])o[1-4]([/:_-]|$)/i,
  /qwen2\.5/i,
  /qwen3/i,
  /llama3\.[1-9]/i,
  /mistral/i,
  /command-r/i,
  /deepseek-chat/i,
  /glm-4/i,
];

export function classifyModel(model: ModelDescriptor): ModelTag[] {
  const tags = new Set<ModelTag>();
  const meta = model.metadata || {};
  const capabilities = Array.isArray(meta.capabilities)
    ? meta.capabilities.map((value: any) => String(value).toLowerCase())
    : [];
  const modalities = Array.isArray(meta.architecture?.input_modalities)
    ? meta.architecture.input_modalities.map((value: any) => String(value).toLowerCase())
    : Array.isArray(meta.input_modalities)
      ? meta.input_modalities.map((value: any) => String(value).toLowerCase())
      : [];
  const supported = Array.isArray(meta.supported_parameters)
    ? meta.supported_parameters.map((value: any) => String(value).toLowerCase())
    : [];
  const family = String(meta.details?.family || '').toLowerCase();
  const text = `${model.id} ${model.name || ''} ${model.owner || ''} ${family}`.toLowerCase();

  if (
    [...modalities, ...capabilities].some(value => /image|video|vision/.test(value))
    || VISION_PATTERNS.some(pattern => pattern.test(text))
  ) {
    tags.add('视觉');
  }

  const promptPrice = Number(meta.pricing?.prompt);
  const completionPrice = Number(meta.pricing?.completion);
  if (
    (Number.isFinite(promptPrice) && promptPrice === 0
      && Number.isFinite(completionPrice) && completionPrice === 0)
    || /:free(\b|$)/.test(text)
    || meta.is_free === true
  ) {
    tags.add('免费');
  }

  if (
    supported.some(value => /tools|tool_choice/.test(value))
    || capabilities.includes('tools')
    || TOOL_PATTERNS.some(pattern => pattern.test(text))
  ) {
    tags.add('工具');
  }

  if (
    supported.some(value => /reason/.test(value))
    || capabilities.includes('thinking')
    || REASONING_PATTERNS.some(pattern => pattern.test(text))
  ) {
    tags.add('推理');
  }

  if (RERANK_PATTERNS.some(pattern => pattern.test(text))) {
    tags.add('重排');
  } else if (EMBEDDING_PATTERNS.some(pattern => pattern.test(text))) {
    tags.add('嵌入');
  }

  if (ONLINE_PATTERNS.some(pattern => pattern.test(text))) {
    tags.add('联网');
  }

  return MODEL_TAGS.filter(tag => tags.has(tag));
}

export function effectiveTags(model: { autoTags?: ModelTag[]; manualTags?: ModelTag[] }): ModelTag[] {
  if (Array.isArray(model.manualTags) && model.manualTags.length > 0) {
    return MODEL_TAGS.filter(tag => model.manualTags!.includes(tag));
  }
  return MODEL_TAGS.filter(tag => (model.autoTags || []).includes(tag));
}
```

- [ ] **Step 4: 导出并运行测试**

`packages/ai/src/utils/index.ts` 增加：

```ts
export * from './model-tagger';
```

Run: `pnpm --filter @sse/ai test -- model-tagger.test.ts`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add packages/ai/src/utils/model-tagger.ts packages/ai/src/utils/__tests__/model-tagger.test.ts packages/ai/src/index.ts
git commit -m "feat(ai): classify models by metadata and name"
```

---

### Task 3: 错误分类与历史脱敏

**Files:**
- Create: `packages/ai/src/utils/engine-error.ts`
- Create: `packages/ai/src/utils/test-history.ts`
- Test: `packages/ai/src/utils/__tests__/engine-error.test.ts`
- Test: `packages/ai/src/utils/__tests__/test-history.test.ts`
- Modify: `packages/ai/src/index.ts`

- [ ] **Step 1: 写失败测试**

```ts
// packages/ai/src/utils/__tests__/engine-error.test.ts
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
});
```

```ts
// packages/ai/src/utils/__tests__/test-history.test.ts
import { appendHistory, sanitizeHistoryEntry } from '../test-history';

describe('test history utils', () => {
  it('truncates raw text and removes secrets', () => {
    const entry: any = {
      id: '1',
      createdAt: '2026-11-02T00:00:00.000Z',
      type: 'ocr',
      success: true,
      elapsedMs: 10,
      rawText: 'x'.repeat(6000),
      apiKey: 'secret',
      token: 'secret',
    };
    const safe = sanitizeHistoryEntry(entry);
    expect(safe.rawText).toHaveLength(5000);
    expect((safe as any).apiKey).toBeUndefined();
    expect((safe as any).token).toBeUndefined();
  });

  it('keeps newest entries first and enforces the limit', () => {
    const entries = Array.from({ length: 55 }, (_, index) => ({
      id: String(index),
      createdAt: '2026-11-02T00:00:00.000Z',
      type: 'fill' as const,
      success: true,
      elapsedMs: 1,
    }));
    const next = appendHistory(entries, {
      id: 'new',
      createdAt: '2026-11-02T00:00:00.000Z',
      type: 'fill',
      success: true,
      elapsedMs: 1,
    });
    expect(next).toHaveLength(50);
    expect(next[0].id).toBe('new');
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm --filter @sse/ai test -- engine-error.test.ts`
Run: `pnpm --filter @sse/ai test -- test-history.test.ts`
Expected: FAIL，找不到模块。

- [ ] **Step 3: 实现错误分类**

```ts
// packages/ai/src/utils/engine-error.ts
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
```

- [ ] **Step 4: 实现历史脱敏**

```ts
// packages/ai/src/utils/test-history.ts
import type { EngineErrorInfo } from './engine-error';

export type EngineTestType = 'connection' | 'fill' | 'ocr';

export interface EngineTestHistoryEntry {
  id: string;
  createdAt: string;
  type: EngineTestType;
  provider?: string;
  endpoint?: string;
  success: boolean;
  elapsedMs: number;
  fields?: Record<string, any>;
  error?: EngineErrorInfo;
  rawText?: string;
}

export const MAX_HISTORY_ENTRIES = 50;
export const MAX_HISTORY_RAW_TEXT = 5000;

export function sanitizeHistoryEntry(entry: EngineTestHistoryEntry): EngineTestHistoryEntry {
  const {
    apiKey,
    token,
    mineruToken,
    visionApiKey,
    ...rest
  } = entry as any;
  const safe = JSON.parse(JSON.stringify(rest)) as EngineTestHistoryEntry;
  if (safe.rawText) {
    safe.rawText = safe.rawText.slice(0, MAX_HISTORY_RAW_TEXT);
  }
  return safe;
}

export function appendHistory(
  entries: EngineTestHistoryEntry[],
  entry: EngineTestHistoryEntry,
  limit = MAX_HISTORY_ENTRIES,
): EngineTestHistoryEntry[] {
  return [sanitizeHistoryEntry(entry), ...entries].slice(0, limit);
}
```

- [ ] **Step 5: 导出并运行测试**

`packages/ai/src/utils/index.ts` 增加：

```ts
export * from './engine-error';
export * from './test-history';
```

Run: `pnpm --filter @sse/ai test -- engine-error.test.ts`
Run: `pnpm --filter @sse/ai test -- test-history.test.ts`
Expected: PASS。

- [ ] **Step 6: 提交**

```bash
git add packages/ai/src/utils/engine-error.ts packages/ai/src/utils/test-history.ts packages/ai/src/utils/__tests__/engine-error.test.ts packages/ai/src/utils/__tests__/test-history.test.ts packages/ai/src/index.ts
git commit -m "feat(ai): classify engine errors and sanitize test history"
```

---

### Task 4: AI 配置与模型清单纯逻辑

**Files:**
- Create: `packages/ai/src/config/ai-config.ts`
- Create: `packages/ai/src/config/model-catalog.ts`
- Test: `packages/ai/src/config/__tests__/ai-config.test.ts`
- Test: `packages/ai/src/config/__tests__/model-catalog.test.ts`
- Modify: `packages/ai/src/index.ts`

- [ ] **Step 1: 写失败测试**

```ts
// packages/ai/src/config/__tests__/ai-config.test.ts
import {
  applyAiConfigPatch,
  createDefaultAiConfig,
  normalizeAiConfig,
  resolveSecretForEndpoint,
  toPublicAiConfig,
} from '../ai-config';

describe('ai config', () => {
  it('normalizes old full endpoints and keeps secrets', () => {
    const config = normalizeAiConfig({
      fillEngine: {
        endpoint: 'http://host:11434/v1/chat/completions',
        apiKey: 'k',
        model: 'qwen2.5:7b',
      },
      ocrEngine: {
        mineruEndpoint: 'https://mineru.net/',
        mineruToken: 't',
        visionEndpoint: 'http://host:11434/v1/chat/completions',
        visionApiKey: 'v',
      },
    });
    expect(config.fillEngine.endpoint).toBe('http://host:11434');
    expect(config.ocrEngine.visionEndpoint).toBe('http://host:11434');
    expect(config.fillEngine.apiKey).toBe('k');
    expect(config.ocrEngine.mineruToken).toBe('t');
    expect(config.ocrEngine.visionApiKey).toBe('v');
  });

  it('masks secrets in public config and exposes current catalog', () => {
    const config = createDefaultAiConfig({ AI_ENDPOINT: 'http://host:11434' } as any);
    config.fillEngine.apiKey = 'secret';
    config.fillEngine.catalogs['http://host:11434'] = {
      fetchedAt: '2026-11-02T00:00:00.000Z',
      source: 'openai',
      models: [],
    };
    const pub = toPublicAiConfig(config);
    expect(pub.fillEngine.apiKey).toBe('');
    expect(pub.fillEngine.apiKeySet).toBe(true);
    expect(pub.fillEngine.catalogs['http://host:11434']).toBeDefined();
    expect(pub.ocrEngine.mineruToken).toBe('');
    expect(pub.ocrEngine.visionApiKey).toBe('');
  });

  it('applies patches without overwriting a saved secret with blank input', () => {
    const config = createDefaultAiConfig({} as any);
    config.fillEngine.apiKey = 'saved';
    const next = applyAiConfigPatch(config, {
      fillEngine: { endpoint: 'http://host:11434', apiKey: '', model: 'm' },
    });
    expect(next.fillEngine.apiKey).toBe('saved');
    expect(next.fillEngine.model).toBe('m');
  });

  it('clears a secret only when asked', () => {
    const config = createDefaultAiConfig({} as any);
    config.fillEngine.apiKey = 'saved';
    const next = applyAiConfigPatch(config, { fillEngine: { clearApiKey: true } });
    expect(next.fillEngine.apiKey).toBe('');
  });

  it('reuses a saved secret only for the same endpoint', () => {
    expect(resolveSecretForEndpoint('http://host:11434', '', 'http://host:11434', 'saved'))
      .toBe('saved');
    expect(resolveSecretForEndpoint('http://other:11434', '', 'http://host:11434', 'saved'))
      .toBe('');
    expect(resolveSecretForEndpoint('http://other:11434', 'new', 'http://host:11434', 'saved'))
      .toBe('new');
  });
});
```

```ts
// packages/ai/src/config/__tests__/model-catalog.test.ts
import { mergeCatalog, resolveActiveModel } from '../model-catalog';

describe('model catalog', () => {
  it('merges fetched models and preserves selection and manual tags', () => {
    const merged = mergeCatalog(
      {
        fetchedAt: 'old',
        source: 'openai',
        models: [
          {
            id: 'a',
            name: 'a',
            autoTags: ['推理'],
            manualTags: ['免费'],
            selected: true,
            metadata: {},
          },
        ],
      },
      [{ id: 'a', name: 'a', metadata: {} }, { id: 'b', name: 'b', metadata: {} }],
      'openai',
    );
    expect(merged.models.find(model => model.id === 'a')?.selected).toBe(true);
    expect(merged.models.find(model => model.id === 'a')?.manualTags).toEqual(['免费']);
    expect(merged.models.find(model => model.id === 'b')?.selected).toBe(false);
    expect(merged.models.find(model => model.id === 'b')?.autoTags).toBeDefined();
  });

  it('keeps selected models that the endpoint no longer returns', () => {
    const merged = mergeCatalog(
      {
        fetchedAt: 'old',
        source: 'openai',
        models: [
          {
            id: 'gone',
            name: 'gone',
            autoTags: [],
            manualTags: [],
            selected: true,
            metadata: {},
          },
        ],
      },
      [],
      'openai',
    );
    expect(merged.models[0].id).toBe('gone');
    expect(merged.models[0].missing).toBe(true);
  });

  it('resolves the active model from selected entries', () => {
    const catalog = {
      fetchedAt: 'now',
      source: 'openai' as const,
      models: [
        { id: 'a', name: 'a', autoTags: [], manualTags: [], selected: true, metadata: {} },
        { id: 'b', name: 'b', autoTags: [], manualTags: [], selected: false, metadata: {} },
      ],
    };
    expect(resolveActiveModel(catalog, 'a')).toBe('a');
    expect(resolveActiveModel(catalog, 'missing')).toBe('a');
    expect(resolveActiveModel({ ...catalog, models: [catalog.models[1]] }, 'a')).toBe('');
    expect(resolveActiveModel({ ...catalog, models: [catalog.models[1]] }, '')).toBe('');
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm --filter @sse/ai test -- ai-config.test.ts`
Run: `pnpm --filter @sse/ai test -- model-catalog.test.ts`
Expected: FAIL，找不到模块。

- [ ] **Step 3: 实现配置类型与纯函数**

```ts
// packages/ai/src/config/ai-config.ts
import { MODEL_TAGS, type ModelTag } from '../utils/model-tagger';
import { normalizeServiceBase } from '../utils/endpoint';
import { resolveActiveModel } from './model-catalog';

export type OcrProvider = 'mineru' | 'paddle' | 'vision';

export interface CatalogModel {
  id: string;
  name: string;
  owner?: string;
  metadata?: Record<string, any>;
  autoTags: ModelTag[];
  manualTags: ModelTag[];
  selected: boolean;
  missing?: boolean;
}

export interface ModelCatalog {
  fetchedAt: string;
  source: 'openai' | 'ollama' | 'openrouter';
  models: CatalogModel[];
}

export interface FillEngineConfig {
  endpoint: string;
  apiKey: string;
  model: string;
  enabled: boolean;
  catalogs: Record<string, ModelCatalog>;
}

export interface OcrEngineConfig {
  provider: OcrProvider;
  mineruEndpoint: string;
  mineruToken: string;
  paddleEndpoint: string;
  visionEndpoint: string;
  visionModel: string;
  visionApiKey: string;
  enabled: boolean;
}

export interface AiConfig {
  fillEngine: FillEngineConfig;
  ocrEngine: OcrEngineConfig;
}

export interface AiConfigPatch {
  fillEngine?: {
    endpoint?: string;
    apiKey?: string;
    model?: string;
    enabled?: boolean;
    catalog?: ModelCatalog;
    clearApiKey?: boolean;
  };
  ocrEngine?: {
    provider?: OcrProvider;
    mineruEndpoint?: string;
    mineruToken?: string;
    paddleEndpoint?: string;
    visionEndpoint?: string;
    visionModel?: string;
    visionApiKey?: string;
    enabled?: boolean;
    clearVisionApiKey?: boolean;
  };
}

export interface PublicAiConfig {
  fillEngine: {
    endpoint: string;
    apiKey: '';
    apiKeySet: boolean;
    model: string;
    enabled: boolean;
    catalogs: Record<string, ModelCatalog>;
  };
  ocrEngine: Omit<OcrEngineConfig, 'mineruToken' | 'visionApiKey'> & {
    mineruToken: '';
    mineruTokenSet: boolean;
    visionApiKey: '';
    visionApiKeySet: boolean;
  };
}

export function createDefaultAiConfig(env: NodeJS.ProcessEnv = process.env): AiConfig {
  const endpoint = normalizeServiceBase(env.AI_ENDPOINT || 'http://localhost:11434');
  return {
    fillEngine: {
      endpoint,
      apiKey: '',
      model: env.AI_MODEL || 'llama3.1:8b',
      enabled: true,
      catalogs: {},
    },
    ocrEngine: {
      provider: 'mineru',
      mineruEndpoint: normalizeServiceBase(env.MINERU_ENDPOINT || 'https://mineru.net'),
      mineruToken: env.MINERU_TOKEN || '',
      paddleEndpoint: normalizeServiceBase(env.PADDLE_ENDPOINT || 'http://localhost:8899'),
      visionEndpoint: endpoint,
      visionModel: env.AI_VISION_MODEL || 'glm-ocr',
      visionApiKey: '',
      enabled: true,
    },
  };
}

function normalizeTagList(value: any): ModelTag[] {
  if (!Array.isArray(value)) return [];
  return MODEL_TAGS.filter(tag => value.includes(tag));
}

function normalizeCatalogModel(value: any): CatalogModel {
  return {
    id: String(value?.id || ''),
    name: String(value?.name || value?.id || ''),
    owner: value?.owner ? String(value.owner) : undefined,
    metadata: value?.metadata && typeof value.metadata === 'object' ? value.metadata : {},
    autoTags: normalizeTagList(value?.autoTags),
    manualTags: normalizeTagList(value?.manualTags),
    selected: value?.selected === true,
    missing: value?.missing === true ? true : undefined,
  };
}

function normalizeCatalogs(raw: any): Record<string, ModelCatalog> {
  const catalogs: Record<string, ModelCatalog> = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return catalogs;
  for (const [key, value] of Object.entries(raw)) {
    const normalizedKey = normalizeServiceBase(key);
    if (!normalizedKey || !value || typeof value !== 'object') continue;
    catalogs[normalizedKey] = {
      fetchedAt: String((value as any).fetchedAt || new Date().toISOString()),
      source: (value as any).source === 'ollama'
        ? 'ollama'
        : (value as any).source === 'openrouter'
          ? 'openrouter'
          : 'openai',
      models: Array.isArray((value as any).models)
        ? (value as any).models.map(normalizeCatalogModel).filter((model: CatalogModel) => model.id)
        : [],
    };
  }
  return catalogs;
}

function ensureActiveModelSelected(config: AiConfig): void {
  const key = normalizeServiceBase(config.fillEngine.endpoint);
  const catalog = config.fillEngine.catalogs[key];
  if (!catalog || !config.fillEngine.model) return;
  const entry = catalog.models.find(model => model.id === config.fillEngine.model);
  if (entry) entry.selected = true;
}

export function normalizeAiConfig(saved: any, env: NodeJS.ProcessEnv = process.env): AiConfig {
  const defaults = createDefaultAiConfig(env);
  const fill = saved?.fillEngine || {};
  const ocr = saved?.ocrEngine || {};
  const config: AiConfig = {
    fillEngine: {
      endpoint: normalizeServiceBase(fill.endpoint || defaults.fillEngine.endpoint),
      apiKey: typeof fill.apiKey === 'string' ? fill.apiKey : defaults.fillEngine.apiKey,
      model: typeof fill.model === 'string' ? fill.model : defaults.fillEngine.model,
      enabled: fill.enabled !== false,
      catalogs: normalizeCatalogs(fill.catalogs),
    },
    ocrEngine: {
      provider: ocr.provider === 'paddle' || ocr.provider === 'vision' ? ocr.provider : 'mineru',
      mineruEndpoint: normalizeServiceBase(ocr.mineruEndpoint || defaults.ocrEngine.mineruEndpoint),
      mineruToken: typeof ocr.mineruToken === 'string' ? ocr.mineruToken : defaults.ocrEngine.mineruToken,
      paddleEndpoint: normalizeServiceBase(ocr.paddleEndpoint || defaults.ocrEngine.paddleEndpoint),
      visionEndpoint: normalizeServiceBase(ocr.visionEndpoint || defaults.ocrEngine.visionEndpoint),
      visionModel: typeof ocr.visionModel === 'string' ? ocr.visionModel : defaults.ocrEngine.visionModel,
      visionApiKey: typeof ocr.visionApiKey === 'string' ? ocr.visionApiKey : defaults.ocrEngine.visionApiKey,
      enabled: ocr.enabled !== false,
    },
  };
  ensureActiveModelSelected(config);
  return config;
}

export function applyAiConfigPatch(config: AiConfig, patch: AiConfigPatch): AiConfig {
  const next = JSON.parse(JSON.stringify(config)) as AiConfig;
  const fill = patch.fillEngine;
  if (fill) {
    if (fill.endpoint !== undefined) next.fillEngine.endpoint = normalizeServiceBase(fill.endpoint);
    if (fill.model !== undefined) next.fillEngine.model = fill.model;
    if (fill.enabled !== undefined) next.fillEngine.enabled = fill.enabled;
    if (fill.clearApiKey) {
      next.fillEngine.apiKey = '';
    } else if (typeof fill.apiKey === 'string' && fill.apiKey.trim()) {
      next.fillEngine.apiKey = fill.apiKey.trim();
    }
    if (fill.catalog) {
      const key = normalizeServiceBase(next.fillEngine.endpoint);
      if (key) next.fillEngine.catalogs[key] = fill.catalog;
    }
  }

  const ocr = patch.ocrEngine;
  if (ocr) {
    if (ocr.provider !== undefined) {
      next.ocrEngine.provider = ['mineru', 'paddle', 'vision'].includes(ocr.provider)
        ? ocr.provider
        : next.ocrEngine.provider;
    }
    if (ocr.mineruEndpoint !== undefined) next.ocrEngine.mineruEndpoint = normalizeServiceBase(ocr.mineruEndpoint);
    if (ocr.paddleEndpoint !== undefined) next.ocrEngine.paddleEndpoint = normalizeServiceBase(ocr.paddleEndpoint);
    if (ocr.visionEndpoint !== undefined) next.ocrEngine.visionEndpoint = normalizeServiceBase(ocr.visionEndpoint);
    if (ocr.visionModel !== undefined) next.ocrEngine.visionModel = ocr.visionModel;
    if (ocr.enabled !== undefined) next.ocrEngine.enabled = ocr.enabled;
    if (typeof ocr.mineruToken === 'string' && ocr.mineruToken.trim()) {
      next.ocrEngine.mineruToken = ocr.mineruToken.trim();
    }
    if (ocr.clearVisionApiKey) {
      next.ocrEngine.visionApiKey = '';
    } else if (typeof ocr.visionApiKey === 'string' && ocr.visionApiKey.trim()) {
      next.ocrEngine.visionApiKey = ocr.visionApiKey.trim();
    }
  }

  ensureActiveModelSelected(next);
  const key = normalizeServiceBase(next.fillEngine.endpoint);
  const catalog = key ? next.fillEngine.catalogs[key] : undefined;
  if (catalog) {
    next.fillEngine.model = resolveActiveModel(catalog, next.fillEngine.model);
  }
  return next;
}

export function toPublicAiConfig(config: AiConfig): PublicAiConfig {
  return {
    fillEngine: {
      endpoint: config.fillEngine.endpoint,
      apiKey: '',
      apiKeySet: !!config.fillEngine.apiKey,
      model: config.fillEngine.model,
      enabled: config.fillEngine.enabled,
      catalogs: config.fillEngine.catalogs,
    },
    ocrEngine: {
      provider: config.ocrEngine.provider,
      mineruEndpoint: config.ocrEngine.mineruEndpoint,
      mineruToken: '',
      mineruTokenSet: !!(config.ocrEngine.mineruToken || process.env.MINERU_TOKEN),
      paddleEndpoint: config.ocrEngine.paddleEndpoint,
      visionEndpoint: config.ocrEngine.visionEndpoint,
      visionModel: config.ocrEngine.visionModel,
      visionApiKey: '',
      visionApiKeySet: !!config.ocrEngine.visionApiKey,
      enabled: config.ocrEngine.enabled,
    },
  };
}

export function resolveSecretForEndpoint(
  requestEndpoint: string,
  requestSecret: string | undefined,
  savedEndpoint: string,
  savedSecret: string,
): string {
  const provided = typeof requestSecret === 'string' ? requestSecret.trim() : '';
  if (provided) return provided;
  const same = normalizeServiceBase(requestEndpoint) === normalizeServiceBase(savedEndpoint);
  return same ? savedSecret || '' : '';
}
```

- [ ] **Step 4: 实现模型清单逻辑**

```ts
// packages/ai/src/config/model-catalog.ts
import { classifyModel } from '../utils/model-tagger';
import type { CatalogModel, ModelCatalog } from './ai-config';

export interface FetchedModel {
  id: string;
  name?: string;
  owner?: string;
  metadata?: Record<string, any>;
  source?: 'openai' | 'ollama' | 'openrouter';
}

export function mergeCatalog(
  existing: ModelCatalog | undefined,
  fetched: FetchedModel[],
  source: 'openai' | 'ollama' | 'openrouter',
): ModelCatalog {
  const oldById = new Map((existing?.models || []).map(model => [model.id, model]));
  const fetchedIds = new Set(fetched.map(model => model.id));

  const models: CatalogModel[] = fetched.map((model) => {
    const old = oldById.get(model.id);
    return {
      id: model.id,
      name: model.name || old?.name || model.id,
      owner: model.owner ?? old?.owner,
      metadata: model.metadata ?? old?.metadata ?? {},
      autoTags: classifyModel({
        id: model.id,
        name: model.name,
        owner: model.owner,
        metadata: model.metadata,
        source: model.source || source,
      }),
      manualTags: old?.manualTags || [],
      selected: old?.selected ?? false,
      missing: undefined,
    };
  });

  for (const old of existing?.models || []) {
    if (!fetchedIds.has(old.id)) {
      models.push({ ...old, missing: true });
    }
  }

  return {
    fetchedAt: new Date().toISOString(),
    source,
    models,
  };
}

export function selectedCatalogModels(catalog: ModelCatalog | null | undefined): CatalogModel[] {
  return (catalog?.models || []).filter(model => model.selected);
}

export function resolveActiveModel(catalog: ModelCatalog | null | undefined, currentModel: string): string {
  const selected = selectedCatalogModels(catalog).map(model => model.id);
  if (selected.includes(currentModel)) return currentModel;
  return selected[0] || '';
}
```

- [ ] **Step 5: 导出并运行测试**

创建 `packages/ai/src/config/index.ts`：

```ts
export * from './ai-config';
export * from './model-catalog';
```

`packages/ai/src/index.ts` 增加：

```ts
export * from './config';
```

Run: `pnpm --filter @sse/ai test -- ai-config.test.ts`
Run: `pnpm --filter @sse/ai test -- model-catalog.test.ts`
Expected: PASS。

- [ ] **Step 6: 提交**

```bash
git add packages/ai/src/config packages/ai/src/index.ts
git commit -m "feat(ai): add engine config and model catalog logic"
```

---

### Task 5: LocalProvider 支持根地址与密钥

**Files:**
- Modify: `packages/ai/src/providers/local-provider.ts`
- Test: `packages/ai/src/providers/__tests__/local-provider.test.ts`

- [ ] **Step 1: 写失败测试**

把 `local-provider.test.ts` 改为：

```ts
import { LocalProvider } from '../local-provider';

describe('LocalProvider', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('turns an aborted request into an actionable timeout message', async () => {
    const abortError = new Error('aborted');
    abortError.name = 'AbortError';
    global.fetch = jest.fn().mockRejectedValue(abortError) as any;

    const provider = new LocalProvider({
      endpoint: 'http://192.168.3.117:11434/v1/chat/completions',
      modelName: 'glm4.7-flash',
      timeoutMs: 1000,
    });

    await expect(provider.analyzeText('测试：打车50元', 'extract'))
      .rejects.toThrow(/超时/);
  });

  it('accepts a service root and appends /v1/chat/completions', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: 'ok' } }] }),
    }) as any;

    const provider = new LocalProvider({
      endpoint: 'http://192.168.3.117:11434',
      modelName: 'qwen2.5:7b',
    });

    await provider.analyzeText('hello', 'prompt');

    expect(global.fetch).toHaveBeenCalledWith(
      'http://192.168.3.117:11434/v1/chat/completions',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('sends a bearer token when apiKey is configured', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: 'ok' } }] }),
    }) as any;

    const provider = new LocalProvider({
      endpoint: 'https://api.example.com',
      modelName: 'demo',
      apiKey: 'secret',
    });

    await provider.analyzeText('hello', 'prompt');

    expect(global.fetch).toHaveBeenCalledWith(
      'https://api.example.com/v1/chat/completions',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer secret' }),
      }),
    );
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm --filter @sse/ai test -- local-provider.test.ts`
Expected: 根地址用例失败，实际请求地址仍是根地址而不是 `/v1/chat/completions`。

- [ ] **Step 3: 修改实现**

```ts
// packages/ai/src/providers/local-provider.ts
import type { IAIProvider, AIProviderConfig } from '../ports';
import { resolveChatUrl } from '../utils/endpoint';

export class LocalProvider implements IAIProvider {
  private config: AIProviderConfig;
  private chatUrl: string;

  constructor(config: AIProviderConfig) {
    this.config = {
      endpoint: config.endpoint || 'http://localhost:11434',
      modelName: config.modelName || 'llama3.2-vision',
      apiKey: config.apiKey,
      maxTokens: config.maxTokens,
      timeoutMs: config.timeoutMs,
    };
    this.chatUrl = resolveChatUrl(this.config.endpoint);
  }

  async analyzeImage(imageBase64: string, prompt: string, mimeType?: string): Promise<string> {
    return this.callModel(prompt, imageBase64, mimeType);
  }

  async analyzeText(text: string, prompt: string): Promise<string> {
    return this.callModel(`${prompt}\n\n内容：\n${text}`);
  }

  private async callModel(userPrompt: string, imageBase64?: string, mimeType?: string): Promise<string> {
    const messages: any[] = [{ role: 'user', content: userPrompt }];

    if (imageBase64) {
      const mime = mimeType || 'image/jpeg';
      messages[0].content = [
        { type: 'text', text: userPrompt },
        { type: 'image_url', image_url: { url: `data:${mime};base64,${imageBase64}` } },
      ];
    }

    const maxTokens = this.config.maxTokens || 4096;
    const timeoutMs = this.config.timeoutMs ?? 120000;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetch(this.chatUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(this.config.apiKey ? { Authorization: `Bearer ${this.config.apiKey}` } : {}),
        },
        body: JSON.stringify({
          model: this.config.modelName,
          messages,
          temperature: 0.1,
          max_tokens: maxTokens,
        }),
        signal: controller.signal,
      });

      if (!res.ok) {
        const err = await res.text();
        throw new Error(`AI provider error ${res.status}: ${err}`);
      }

      const data: any = await res.json();
      return data.choices?.[0]?.message?.content || '';
    } catch (e: any) {
      if (e?.name === 'AbortError') {
        throw new Error(`AI 请求超时（${Math.round(timeoutMs / 1000)}s），请检查端点与模型是否可用`);
      }
      throw e;
    } finally {
      clearTimeout(timer);
    }
  }
}
```

- [ ] **Step 4: 运行测试**

Run: `pnpm --filter @sse/ai test -- local-provider.test.ts`
Expected: PASS，3 个用例通过。

- [ ] **Step 5: 提交**

```bash
git add packages/ai/src/providers/local-provider.ts packages/ai/src/providers/__tests__/local-provider.test.ts
git commit -m "feat(ai): accept root endpoints and api keys in LocalProvider"
```

---

### Task 6: 配置接入与 apiKey 透传

**Files:**
- Modify: `packages/api/src/services/ai-engines.ts`
- Modify: `packages/api/src/index.ts`
- Modify: `packages/api/src/routes/ontology-helpers.ts`
- Modify: `packages/mcp/src/tools/get-engine.ts`
- Modify: `packages/ontology/src/entity-extractor.ts`
- Modify: `packages/ontology/src/nlp-generator.ts`
- Modify: `packages/ontology/src/index.ts`

- [ ] **Step 1: 修改 `ai-engines.ts`**

```ts
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import {
  InvoiceOCREngine,
  LocalProvider,
  MinerUProvider,
  PaddleProvider,
  SmartFillEngine,
  VisionOCRProvider,
  createDefaultAiConfig,
  normalizeAiConfig,
  toPublicAiConfig,
  type AiConfig,
  type OcrProvider,
} from '@sse/ai';

export type { AiConfig, OcrProvider };

export const AI_CONFIG_PATH = join(process.cwd(), 'ai-config.json');

export function loadAiConfig(): AiConfig {
  try {
    if (existsSync(AI_CONFIG_PATH)) {
      const saved = JSON.parse(readFileSync(AI_CONFIG_PATH, 'utf-8'));
      return normalizeAiConfig(saved);
    }
  } catch {
    /* use defaults */
  }
  return createDefaultAiConfig();
}

export function saveAiConfig(config: AiConfig): void {
  writeFileSync(AI_CONFIG_PATH, JSON.stringify(config, null, 2), 'utf-8');
}

export const publicAiConfig = toPublicAiConfig;

export function createOCREngine(config: AiConfig = loadAiConfig()): InvoiceOCREngine | null {
  const ocr = config.ocrEngine;
  if (!ocr.enabled) return null;

  if (ocr.provider === 'mineru') {
    return new InvoiceOCREngine(
      new MinerUProvider({
        endpoint: ocr.mineruEndpoint,
        apiKey: ocr.mineruToken || process.env.MINERU_TOKEN,
      }),
    );
  }

  if (ocr.provider === 'paddle') {
    return new InvoiceOCREngine(new PaddleProvider({ endpoint: ocr.paddleEndpoint }));
  }

  const provider = new LocalProvider({
    endpoint: ocr.visionEndpoint,
    modelName: ocr.visionModel,
    apiKey: ocr.visionApiKey,
    timeoutMs: 120000,
  });
  return new InvoiceOCREngine(new VisionOCRProvider(provider));
}

export function createFillProvider(config: AiConfig = loadAiConfig()): LocalProvider | null {
  if (!config.fillEngine.enabled) return null;
  return new LocalProvider({
    endpoint: config.fillEngine.endpoint,
    modelName: config.fillEngine.model,
    apiKey: config.fillEngine.apiKey,
    timeoutMs: 120000,
  });
}

export function getSmartFillEngine(config: AiConfig = loadAiConfig()): SmartFillEngine | null {
  const provider = createFillProvider(config);
  return provider ? new SmartFillEngine(provider) : null;
}
```

- [ ] **Step 2: 修改本体引擎构造函数**

`packages/ontology/src/entity-extractor.ts`：

```ts
constructor(endpoint: string, model: string, apiKey?: string) {
  this.provider = new LocalProvider({ endpoint, modelName: model, apiKey });
}
```

`packages/ontology/src/nlp-generator.ts`：

```ts
constructor(endpoint: string, model: string, apiKey?: string) {
  this.provider = new LocalProvider({ endpoint, modelName: model, apiKey });
}
```

`packages/ontology/src/index.ts`：

```ts
constructor(aiEndpoint: string, aiModel: string, apiBase?: string, aiApiKey?: string) {
  this.store = new OwlStore();
  this.mapper = new SemanticMapper(this.store);
  this.extractor = new EntityExtractor(aiEndpoint, aiModel, aiApiKey);
  this.reasoner = new ActionReasoner();
  this.nlp = new NlpGenerator(aiEndpoint, aiModel, aiApiKey);
  this.executor = new ActionExecutor(apiBase);
}
```

- [ ] **Step 3: 修改调用方**

`packages/api/src/index.ts` 顶部增加：

```ts
import { loadAiConfig } from './services/ai-engines';
```

同时把文件顶部的 `import { readFileSync, existsSync } from 'fs';` 改为：

```ts
import { existsSync } from 'fs';
```

`initOntology` 改为：

```ts
async function initOntology() {
  const cfg = loadAiConfig();
  const engine = new OntologyEngine(
    cfg.fillEngine.endpoint,
    cfg.fillEngine.model,
    undefined,
    cfg.fillEngine.apiKey,
  );
  try {
    await engine.store.loadFromDb();
    console.log('[Ontology] 已从数据库恢复本体');
  } catch (e: any) {
    console.log('[Ontology] 数据库无历史本体:', e.message);
  }
  try {
    const turtlePath = join(process.cwd(), 'data', 'ontology', 'sse.owl');
    if (existsSync(turtlePath)) {
      await engine.store.loadFromTurtle(turtlePath);
      console.log('[Ontology] 已从 Turtle 文件恢复本体');
    }
  } catch { /* file may not exist yet */ }
}
```

`packages/api/src/routes/ontology-helpers.ts` 改为：

```ts
import { OntologyEngine } from '@sse/ontology';
import { loadAiConfig } from '../services/ai-engines';

let engine: OntologyEngine;

export function getEngine(): OntologyEngine {
  if (!engine) {
    const cfg = loadAiConfig();
    engine = new OntologyEngine(
      cfg.fillEngine.endpoint,
      cfg.fillEngine.model,
      undefined,
      cfg.fillEngine.apiKey,
    );
  }
  return engine;
}
```

`packages/mcp/src/tools/get-engine.ts` 改为：

```ts
import { OntologyEngine } from "@sse/ontology";
import { readFileSync, existsSync } from "fs";
import { join } from "path";

const CONFIG_PATH = join(process.cwd(), "ai-config.json");

export function getEngine(): OntologyEngine {
  let endpoint = process.env.AI_ENDPOINT || "http://localhost:11434";
  let model = process.env.AI_MODEL || "llama3.2-vision";
  let apiKey = "";
  try {
    if (existsSync(CONFIG_PATH)) {
      const saved = JSON.parse(readFileSync(CONFIG_PATH, "utf-8"));
      endpoint = saved?.fillEngine?.endpoint || endpoint;
      model = saved?.fillEngine?.model || model;
      apiKey = saved?.fillEngine?.apiKey || "";
    }
  } catch { /* use defaults */ }
  return new OntologyEngine(endpoint, model, undefined, apiKey);
}
```

- [ ] **Step 4: 构建验证**

Run: `pnpm --filter @sse/ai build; if ($?) { pnpm --filter @sse/ontology build }`
Run: `pnpm --filter @sse/api build; if ($?) { pnpm --filter @sse/mcp build }`
Expected: 全部通过。

- [ ] **Step 5: 提交**

```bash
git add packages/api/src/services/ai-engines.ts packages/api/src/index.ts packages/api/src/routes/ontology-helpers.ts packages/mcp/src/tools/get-engine.ts packages/ontology/src/entity-extractor.ts packages/ontology/src/nlp-generator.ts packages/ontology/src/index.ts
git commit -m "feat(ai): wire api keys through engine config"
```

---

### Task 7: 引擎探测服务

**Files:**
- Create: `packages/api/src/services/ai-engine-probe.ts`

- [ ] **Step 1: 写实现**

```ts
// packages/api/src/services/ai-engine-probe.ts
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
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function normalizeModels(body: any, source: 'openai' | 'ollama'): ProbeModel[] {
  const raw = Array.isArray(body)
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
    return {
      models: normalizeModels(response.body, 'openai'),
      source: 'openai',
      elapsedMs: Date.now() - start,
    };
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
      model,
      error: info,
      message: info.message,
    });
    return { success: false, message: info.message, steps };
  }
}
```

- [ ] **Step 2: 构建验证**

Run: `pnpm --filter @sse/ai build; if ($?) { pnpm --filter @sse/api build }`
Expected: 通过。

- [ ] **Step 3: 提交**

```bash
git add packages/api/src/services/ai-engine-probe.ts
git commit -m "feat(api): add engine model probe and connection test"
```

---

### Task 8: 测试历史文件与上传中间件

**Files:**
- Create: `packages/api/src/services/ai-test-history.ts`
- Modify: `packages/api/src/middleware/upload.ts`

- [ ] **Step 1: 实现历史文件服务**

```ts
// packages/api/src/services/ai-test-history.ts
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { appendHistory, type EngineTestHistoryEntry } from '@sse/ai';

export const AI_TEST_HISTORY_PATH = join(process.cwd(), 'ai-test-history.json');

export function loadTestHistory(): EngineTestHistoryEntry[] {
  try {
    if (!existsSync(AI_TEST_HISTORY_PATH)) return [];
    const parsed = JSON.parse(readFileSync(AI_TEST_HISTORY_PATH, 'utf-8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function addTestHistory(entry: EngineTestHistoryEntry): EngineTestHistoryEntry[] {
  const next = appendHistory(loadTestHistory(), entry);
  writeFileSync(AI_TEST_HISTORY_PATH, JSON.stringify(next, null, 2), {
    encoding: 'utf-8',
    mode: 0o600,
  });
  return next;
}

export function clearTestHistory(): void {
  writeFileSync(AI_TEST_HISTORY_PATH, '[]', { encoding: 'utf-8', mode: 0o600 });
}

export function newHistoryEntry(
  entry: Omit<EngineTestHistoryEntry, 'id' | 'createdAt'>,
): EngineTestHistoryEntry {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    createdAt: new Date().toISOString(),
    ...entry,
  };
}
```

- [ ] **Step 2: 增加上传中间件**

`packages/api/src/middleware/upload.ts` 末尾增加：

```ts
export const uploadEngineSample = multer({
  storage,
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ext = file.originalname.split('.').pop()?.toLowerCase();
    if (ext === 'pdf' || ext === 'ofd' || ext === 'png' || ext === 'jpg' || ext === 'jpeg') {
      cb(null, true);
    } else {
      cb(new Error('仅支持 PDF、OFD、PNG、JPG 格式的样例文件'));
    }
  },
});
```

- [ ] **Step 3: 构建验证**

Run: `pnpm --filter @sse/api build`
Expected: 通过。

- [ ] **Step 4: 提交**

```bash
git add packages/api/src/services/ai-test-history.ts packages/api/src/middleware/upload.ts
git commit -m "feat(api): persist engine test history and accept samples"
```

---

### Task 9: 管理端新接口

**Files:**
- Modify: `packages/api/src/routes/admin.ts`

- [ ] **Step 1: 更新导入**

在 `admin.ts` 顶部把 `@sse/ai` 与本地服务导入补齐：

```ts
import {
  applyAiConfigPatch,
  classifyEngineError,
  mergeCatalog,
  normalizeServiceBase,
  resolveSecretForEndpoint,
  toPublicAiConfig,
  type AiConfig,
} from '@sse/ai';
import {
  createOCREngine,
  getSmartFillEngine,
  loadAiConfig,
  saveAiConfig,
} from '../services/ai-engines';
import {
  addTestHistory,
  clearTestHistory,
  loadTestHistory,
  newHistoryEntry,
} from '../services/ai-test-history';
import { fetchModelList, testConnection } from '../services/ai-engine-probe';
import { uploadEngineSample } from '../middleware/upload';
```

- [ ] **Step 2: 替换模型列表与配置接口**

删除 `RECOMMENDED_MODELS`、`ModelInfo` 和原 `/ai-models`、`/ai-config` 实现，替换为：

```ts
router.get(
  '/ai-models',
  asyncWrap(async (_req, res) => {
    const config = loadAiConfig();
    try {
      const result = await fetchModelList({
        endpoint: config.fillEngine.endpoint,
        apiKey: config.fillEngine.apiKey,
      });
      res.json({
        models: result.models.map(model => ({
          ...model,
          recommended: false,
          reason: '',
        })),
        source: result.source,
        elapsedMs: result.elapsedMs,
      });
    } catch {
      res.json({ models: [], source: 'openai', elapsedMs: 0 });
    }
  }),
);

router.post(
  '/ai-models',
  asyncWrap(async (req, res) => {
    const clientIp = req.ip || req.socket.remoteAddress || 'unknown';
    if (!checkRateLimit(clientIp)) {
      throw new AppError(429, 'RATE_LIMITED', '请求过于频繁，请稍后重试');
    }
    const saved = loadAiConfig();
    const endpoint = String(req.body?.endpoint || '');
    const apiKey = resolveSecretForEndpoint(
      endpoint,
      req.body?.apiKey,
      saved.fillEngine.endpoint,
      saved.fillEngine.apiKey,
    );
    const result = await fetchModelList({ endpoint, apiKey });
    const key = normalizeServiceBase(endpoint);
    const catalog = mergeCatalog(saved.fillEngine.catalogs[key], result.models, result.source);
    res.json({ ...result, catalog });
  }),
);

router.get(
  '/ai-config',
  asyncWrap(async (_req, res) => {
    res.json(toPublicAiConfig(loadAiConfig()));
  }),
);

router.put(
  '/ai-config',
  asyncWrap(async (req, res) => {
    const saved = loadAiConfig();
    const next = applyAiConfigPatch(saved, req.body || {});
    saveAiConfig(next);
    res.json(toPublicAiConfig(next));
  }),
);
```

- [ ] **Step 3: 增加连通检测接口**

```ts
router.post(
  '/ai-connection-test',
  asyncWrap(async (req, res) => {
    const clientIp = req.ip || req.socket.remoteAddress || 'unknown';
    if (!checkRateLimit(clientIp)) {
      throw new AppError(429, 'RATE_LIMITED', '请求过于频繁，请稍后重试');
    }

    const saved = loadAiConfig();
    const endpoint = String(req.body?.endpoint || '');
    const apiKey = resolveSecretForEndpoint(
      endpoint,
      req.body?.apiKey,
      saved.fillEngine.endpoint,
      saved.fillEngine.apiKey,
    );
    const result = await testConnection({
      endpoint,
      apiKey,
      model: req.body?.model,
    });

    const failed = result.steps.find(step => !step.ok);
    addTestHistory(newHistoryEntry({
      type: 'connection',
      endpoint: normalizeServiceBase(endpoint),
      success: result.success,
      elapsedMs: result.steps.reduce((sum, step) => sum + step.elapsedMs, 0),
      fields: { steps: result.steps },
      error: failed?.error,
    }));

    res.json(result);
  }),
);
```

- [ ] **Step 4: 增加当前配置的填单测试**

```ts
router.post(
  '/ai-test/fill',
  asyncWrap(async (req, res) => {
    const clientIp = req.ip || req.socket.remoteAddress || 'unknown';
    if (!checkRateLimit(clientIp)) {
      throw new AppError(429, 'RATE_LIMITED', '请求过于频繁，请稍后重试');
    }

    const saved = loadAiConfig();
    const endpoint = String(req.body?.endpoint || saved.fillEngine.endpoint);
    const apiKey = resolveSecretForEndpoint(
      endpoint,
      req.body?.apiKey,
      saved.fillEngine.endpoint,
      saved.fillEngine.apiKey,
    );
    const config: AiConfig = {
      ...saved,
      fillEngine: {
        ...saved.fillEngine,
        endpoint: normalizeServiceBase(endpoint),
        apiKey,
        model: String(req.body?.model || saved.fillEngine.model),
      },
    };

    const start = Date.now();
    try {
      const engine = getSmartFillEngine(config);
      if (!engine) throw new Error('智能填单引擎未启用');
      const items = await engine.parseFromText('测试：打车50元');
      const success = items.length > 0;
      const message = success
        ? `文字识别成功，解析到 ${items.length} 条费用`
        : '模型响应但未解析到结构化数据';
      addTestHistory(newHistoryEntry({
        type: 'fill',
        endpoint: config.fillEngine.endpoint,
        success,
        elapsedMs: Date.now() - start,
        fields: { itemCount: items.length },
      }));
      res.json({ success, message, elapsedMs: Date.now() - start, items });
    } catch (error: any) {
      const info = classifyEngineError(error);
      addTestHistory(newHistoryEntry({
        type: 'fill',
        endpoint: config.fillEngine.endpoint,
        success: false,
        elapsedMs: Date.now() - start,
        error: info,
      }));
      res.json({ success: false, message: info.message, elapsedMs: Date.now() - start, error: info });
    }
  }),
);
```

- [ ] **Step 5: 增加 OCR 测试接口**

```ts
router.post(
  '/ai-test/ocr',
  uploadEngineSample.single('file'),
  asyncWrap(async (req, res) => {
    const clientIp = req.ip || req.socket.remoteAddress || 'unknown';
    if (!checkRateLimit(clientIp)) {
      throw new AppError(429, 'RATE_LIMITED', '请求过于频繁，请稍后重试');
    }

    const saved = loadAiConfig();
    const requestedProvider = String(req.body?.provider || '');
    const provider = requestedProvider === 'mineru'
      || requestedProvider === 'paddle'
      || requestedProvider === 'vision'
      ? (requestedProvider as AiConfig['ocrEngine']['provider'])
      : saved.ocrEngine.provider;
    const mineruEndpoint = normalizeServiceBase(String(req.body?.mineruEndpoint || saved.ocrEngine.mineruEndpoint));
    const paddleEndpoint = normalizeServiceBase(String(req.body?.paddleEndpoint || saved.ocrEngine.paddleEndpoint));
    const visionEndpoint = normalizeServiceBase(String(req.body?.visionEndpoint || saved.ocrEngine.visionEndpoint));
    const mineruToken = resolveSecretForEndpoint(
      mineruEndpoint,
      req.body?.mineruToken,
      saved.ocrEngine.mineruEndpoint,
      saved.ocrEngine.mineruToken,
    );
    const visionApiKey = resolveSecretForEndpoint(
      visionEndpoint,
      req.body?.visionApiKey,
      saved.ocrEngine.visionEndpoint,
      saved.ocrEngine.visionApiKey,
    );

    const config: AiConfig = {
      ...saved,
      ocrEngine: {
        ...saved.ocrEngine,
        provider,
        mineruEndpoint,
        mineruToken,
        paddleEndpoint,
        visionEndpoint,
        visionModel: String(req.body?.visionModel || saved.ocrEngine.visionModel),
        visionApiKey,
      },
    };

    let buffer: Buffer;
    let fileName: string;
    if (req.file) {
      buffer = req.file.buffer;
      fileName = req.file.originalname;
    } else {
      const samplePath = join(
        process.cwd(),
        'docs',
        'dzfp_25362000000115126055_深圳市数恒纪元信息技术咨询企业（个人独资）_20251106105357.pdf',
      );
      if (!existsSync(samplePath)) {
        throw new AppError(400, 'SAMPLE_MISSING', '内置样例发票不存在，请上传样例文件');
      }
      buffer = readFileSync(samplePath);
      fileName = 'sample.pdf';
    }

    const start = Date.now();
    try {
      const engine = createOCREngine(config);
      if (!engine) throw new Error('发票 OCR 引擎未启用');
      const result = await engine.parseInvoice(buffer, fileName);
      const fields = {
        invoiceNo: result.invoiceNo,
        amount: result.amount,
        totalAmount: result.totalAmount,
        invoiceDate: result.invoiceDate,
        sellerName: result.sellerName,
        buyerName: result.buyerName,
        taxAmount: result.taxAmount,
      };
      const success = !!(fields.invoiceNo || fields.totalAmount || fields.amount);
      const error = success
        ? undefined
        : classifyEngineError(new Error('未识别到发票信息'));
      addTestHistory(newHistoryEntry({
        type: 'ocr',
        provider,
        endpoint: provider === 'mineru' ? mineruEndpoint : provider === 'paddle' ? paddleEndpoint : visionEndpoint,
        success,
        elapsedMs: Date.now() - start,
        fields,
        error,
        rawText: result.rawText,
      }));
      res.json({
        success,
        elapsedMs: Date.now() - start,
        provider,
        endpoint: provider === 'mineru' ? mineruEndpoint : provider === 'paddle' ? paddleEndpoint : visionEndpoint,
        fields,
        rawText: (result.rawText || '').slice(0, 5000),
        error: error || null,
      });
    } catch (error: any) {
      const info = classifyEngineError(error, { status: error?.status });
      addTestHistory(newHistoryEntry({
        type: 'ocr',
        provider,
        endpoint: provider === 'mineru' ? mineruEndpoint : provider === 'paddle' ? paddleEndpoint : visionEndpoint,
        success: false,
        elapsedMs: Date.now() - start,
        error: info,
      }));
      res.json({
        success: false,
        elapsedMs: Date.now() - start,
        provider,
        endpoint: provider === 'mineru' ? mineruEndpoint : provider === 'paddle' ? paddleEndpoint : visionEndpoint,
        fields: {},
        rawText: '',
        error: info,
      });
    }
  }),
);
```

- [ ] **Step 6: 增加历史接口**

```ts
router.get(
  '/ai-test-history',
  asyncWrap(async (req, res) => {
    const type = typeof req.query.type === 'string' ? req.query.type : '';
    const rawLimit = Number(req.query.limit);
    const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 50) : 10;
    const entries = loadTestHistory()
      .filter(entry => !type || entry.type === type)
      .slice(0, limit);
    res.json(entries);
  }),
);

router.delete(
  '/ai-test-history',
  asyncWrap(async (_req, res) => {
    clearTestHistory();
    res.json({ message: '测试历史已清空' });
  }),
);
```

- [ ] **Step 7: 构建验证**

Run: `pnpm --filter @sse/api build`
Expected: 通过。若报 `req.file` 类型缺失，确认已执行任务 8 的 `uploadEngineSample` 导入，并且 `@types/multer` 已在 `packages/api` devDependencies 中。

- [ ] **Step 8: 提交**

```bash
git add packages/api/src/routes/admin.ts
git commit -m "feat(api): add engine connection, model catalog and test endpoints"
```

---

### Task 10: 模型选择对话框

**Files:**
- Create: `packages/web/src/components/ModelPickerDialog.vue`

- [ ] **Step 1: 写组件**

```vue
<template>
  <Teleport to="body">
    <div v-if="open" class="modal-overlay" @click.self="close">
      <div class="modal model-picker" role="dialog" aria-modal="true" aria-label="选择模型">
        <div class="modal-header">
          <h3 class="modal-title font-heading">选择模型</h3>
          <button class="modal-close" aria-label="关闭" @click="close">×</button>
        </div>

        <div class="picker-toolbar">
          <input v-model="search" class="search-input" placeholder="搜索模型 ID 或名称" />
          <button class="refresh-btn" :disabled="loading" title="刷新模型列表" @click="refresh">
            <svg v-if="!loading" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M21 12a9 9 0 1 1-2.64-6.36" />
              <polyline points="21 3 21 9 15 9" />
            </svg>
            <span v-else class="spinner" />
          </button>
        </div>

        <div class="tabs">
          <button
            v-for="tabName in TABS"
            :key="tabName"
            class="tab"
            :class="{ active: tab === tabName }"
            @click="tab = tabName"
          >
            {{ tabName }} <span class="tab-count">{{ countFor(tabName) }}</span>
          </button>
        </div>

        <div v-if="error" class="picker-error">{{ error }}</div>

        <div class="model-list">
          <div v-for="model in filteredModels" :key="model.id" class="model-row">
            <div class="model-main">
              <div class="model-id">
                {{ model.id }}
                <span v-if="model.missing" class="missing">当前地址未返回</span>
              </div>
              <div v-if="model.name && model.name !== model.id" class="model-name">{{ model.name }}</div>
              <div class="model-tags">
                <span v-for="tag in tagsOf(model)" :key="tag" class="tag">{{ tag }}</span>
                <button class="tag-edit" @click="editingId = editingId === model.id ? '' : model.id">
                  编辑标签
                </button>
              </div>
              <div v-if="editingId === model.id" class="tag-editor">
                <label v-for="tag in TAG_OPTIONS" :key="tag" class="tag-option">
                  <input
                    type="checkbox"
                    :checked="(model.manualTags || []).includes(tag)"
                    @change="toggleManualTag(model, tag)"
                  />
                  {{ tag }}
                </label>
                <button class="restore-btn" @click="restoreAuto(model)">恢复自动</button>
              </div>
            </div>
            <button
              class="toggle-btn"
              :class="{ selected: model.selected }"
              :title="model.selected ? '从模型文本框移出' : '加入模型文本框'"
              @click="model.selected = !model.selected"
            >
              {{ model.selected ? '−' : '+' }}
            </button>
          </div>
          <div v-if="filteredModels.length === 0" class="empty-state">没有匹配的模型</div>
        </div>

        <div class="modal-footer">
          <span class="selected-count">已选 {{ selectedCount }} 个模型</span>
          <div class="footer-actions">
            <button class="btn-secondary" @click="close">取消</button>
            <button class="btn-primary" @click="confirm">确定</button>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import api from '../api/index'

const TABS = ['全部', '推理', '视觉', '联网', '免费', '嵌入', '重排', '工具'] as const
const TAG_OPTIONS = ['推理', '视觉', '联网', '免费', '嵌入', '重排', '工具'] as const

const props = defineProps<{
  open: boolean
  endpoint: string
  apiKey: string
  catalog: any | null
  activeModel: string
}>()

const emit = defineEmits<{
  (event: 'update:open', value: boolean): void
  (event: 'confirm', payload: { catalog: any; activeModel: string }): void
}>()

const draft = ref<any[]>([])
const draftSource = ref<'openai' | 'ollama' | 'openrouter'>('openai')
const active = ref('')
const search = ref('')
const tab = ref<(typeof TABS)[number]>('全部')
const loading = ref(false)
const error = ref('')
const editingId = ref('')

watch(
  () => props.open,
  (open) => {
    if (!open) return
    draft.value = JSON.parse(JSON.stringify(props.catalog?.models || []))
    draftSource.value = props.catalog?.source || 'openai'
    active.value = props.activeModel
    if (active.value && !draft.value.some(model => model.id === active.value)) {
      draft.value.unshift({
        id: active.value,
        name: active.value,
        autoTags: [],
        manualTags: [],
        selected: true,
        metadata: {},
        missing: true,
      })
    }
    search.value = ''
    tab.value = '全部'
    error.value = ''
    editingId.value = ''
    if (draft.value.length === 0 && props.endpoint) refresh()
  },
)

const selectedCount = computed(() => draft.value.filter(model => model.selected).length)

function tagsOf(model: any): string[] {
  return Array.isArray(model.manualTags) && model.manualTags.length > 0
    ? model.manualTags
    : (model.autoTags || [])
}

function countFor(tabName: string): number {
  if (tabName === '全部') return draft.value.length
  return draft.value.filter(model => tagsOf(model).includes(tabName)).length
}

const filteredModels = computed(() => {
  const keyword = search.value.trim().toLowerCase()
  return draft.value.filter((model) => {
    const matchesTab = tab.value === '全部' || tagsOf(model).includes(tab.value)
    const matchesSearch = !keyword
      || String(model.id).toLowerCase().includes(keyword)
      || String(model.name || '').toLowerCase().includes(keyword)
    return matchesTab && matchesSearch
  })
})

async function refresh() {
  if (!props.endpoint) {
    error.value = '请先填写 API 地址'
    return
  }
  loading.value = true
  error.value = ''
  try {
    const response = await api.post('/admin/ai-models', {
      endpoint: props.endpoint,
      apiKey: props.apiKey || undefined,
    }, { timeout: 30000 })
    const fetchedCatalog = response.data?.catalog
    const fetchedModels = fetchedCatalog?.models || response.data?.models || []
    draftSource.value = fetchedCatalog?.source
      || (response.data?.source === 'ollama' ? 'ollama' : 'openai')
    const existing = new Map(draft.value.map(model => [model.id, model]))
    const next = fetchedModels.map((model: any) => {
      const old = existing.get(model.id)
      return {
        ...model,
        manualTags: old?.manualTags ?? model.manualTags ?? [],
        selected: old?.selected ?? model.selected ?? false,
        missing: false,
      }
    })
    for (const old of draft.value) {
      if (!next.some((model: any) => model.id === old.id)) {
        next.push({ ...old, missing: true })
      }
    }
    draft.value = next
  } catch (e: any) {
    error.value = e?.response?.data?.message || e?.message || '获取模型列表失败'
  } finally {
    loading.value = false
  }
}

function toggleManualTag(model: any, tag: string) {
  const tags = Array.isArray(model.manualTags) ? [...model.manualTags] : []
  const index = tags.indexOf(tag)
  if (index >= 0) tags.splice(index, 1)
  else tags.push(tag)
  model.manualTags = tags
}

function restoreAuto(model: any) {
  model.manualTags = []
}

function close() {
  emit('update:open', false)
}

function confirm() {
  const selectedIds = draft.value.filter(model => model.selected).map(model => model.id)
  const activeModel = selectedIds.includes(active.value) ? active.value : (selectedIds[0] || '')
  emit('confirm', {
    catalog: {
      fetchedAt: new Date().toISOString(),
      source: draftSource.value,
      models: draft.value,
    },
    activeModel,
  })
  emit('update:open', false)
}
</script>

<style scoped>
.modal-overlay { position: fixed; inset: 0; background: rgba(45,36,32,0.4); backdrop-filter: blur(4px); display: flex; align-items: center; justify-content: center; z-index: 300; }
.modal { background: var(--bg-card); border-radius: var(--radius-lg); width: 92%; max-width: 720px; max-height: 88vh; display: flex; flex-direction: column; }
.modal-header { display: flex; align-items: center; justify-content: space-between; padding: 18px 22px; border-bottom: 1px solid var(--border-light); }
.modal-title { font-size: 1.05rem; }
.modal-close { background: none; border: none; cursor: pointer; color: var(--text-secondary); font-size: 1.3rem; line-height: 1; }
.picker-toolbar { display: flex; gap: 8px; padding: 14px 22px 0; }
.search-input { flex: 1; padding: 9px 11px; border: 1px solid var(--border); border-radius: var(--radius-sm); background: var(--bg-input); color: var(--text-primary); font-size: .875rem; }
.refresh-btn { width: 38px; border: 1px solid var(--border); border-radius: var(--radius-sm); background: var(--bg-input); color: var(--text-secondary); cursor: pointer; display: grid; place-items: center; }
.refresh-btn:disabled { opacity: .5; cursor: wait; }
.spinner { width: 14px; height: 14px; border: 2px solid var(--border); border-top-color: var(--accent-coral); border-radius: 50%; animation: spin .7s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
.tabs { display: flex; gap: 4px; overflow-x: auto; padding: 12px 22px 0; }
.tab { border: 1px solid var(--border); background: var(--bg-input); color: var(--text-secondary); border-radius: 999px; padding: 5px 10px; font-size: .78rem; cursor: pointer; white-space: nowrap; }
.tab.active { background: var(--accent-coral); border-color: var(--accent-coral); color: #fff; }
.tab-count { opacity: .75; margin-left: 2px; }
.picker-error { margin: 10px 22px 0; padding: 8px 10px; border-radius: var(--radius-sm); background: var(--accent-coral-bg); color: var(--accent-coral); font-size: .8rem; }
.model-list { flex: 1; overflow-y: auto; padding: 12px 22px; display: flex; flex-direction: column; gap: 8px; }
.model-row { display: flex; gap: 12px; align-items: flex-start; padding: 10px 12px; border: 1px solid var(--border-light); border-radius: var(--radius-sm); }
.model-main { flex: 1; min-width: 0; }
.model-id { font-size: .88rem; color: var(--text-primary); word-break: break-all; }
.model-name { font-size: .78rem; color: var(--text-muted); margin-top: 2px; }
.missing { margin-left: 6px; font-size: .72rem; color: var(--accent-coral); }
.model-tags { display: flex; flex-wrap: wrap; gap: 4px; align-items: center; margin-top: 5px; }
.tag { font-size: .7rem; padding: 1px 7px; border-radius: 999px; background: var(--accent-mint-bg); color: #2b7a3d; }
.tag-edit { border: none; background: none; color: var(--text-muted); font-size: .72rem; cursor: pointer; text-decoration: underline; }
.tag-editor { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 8px; padding: 8px; background: var(--bg-input); border-radius: var(--radius-sm); }
.tag-option { display: flex; align-items: center; gap: 4px; font-size: .78rem; color: var(--text-secondary); }
.restore-btn { border: none; background: none; color: var(--accent-coral); font-size: .75rem; cursor: pointer; }
.toggle-btn { width: 34px; height: 34px; flex: 0 0 auto; border-radius: 50%; border: 1px solid var(--border); background: var(--bg-input); color: var(--text-primary); font-size: 1.2rem; line-height: 1; cursor: pointer; }
.toggle-btn.selected { background: var(--accent-coral); border-color: var(--accent-coral); color: #fff; }
.modal-footer { display: flex; align-items: center; justify-content: space-between; padding: 14px 22px; border-top: 1px solid var(--border-light); }
.selected-count { font-size: .82rem; color: var(--text-secondary); }
.footer-actions { display: flex; gap: 8px; }
.empty-state { text-align: center; color: var(--text-muted); padding: 28px 0; font-size: .85rem; }
</style>
```

- [ ] **Step 2: 构建验证**

Run: `pnpm --filter @sse/web build`
Expected: 通过。组件尚未被引用也可以构建。

- [ ] **Step 3: 提交**

```bash
git add packages/web/src/components/ModelPickerDialog.vue
git commit -m "feat(web): add model picker dialog"
```

---

### Task 11: OCR 测试结果面板

**Files:**
- Create: `packages/web/src/components/EngineTestPanel.vue`

- [ ] **Step 1: 写组件**

```vue
<template>
  <div class="engine-test-panel">
    <div class="test-controls">
      <label class="file-picker">
        <input ref="fileInput" type="file" accept=".pdf,.ofd,.png,.jpg,.jpeg" @change="chooseFile" />
        <span>{{ file ? file.name : '选择样例发票（可选）' }}</span>
      </label>
      <button v-if="file" class="link-btn" @click="clearFile">移除</button>
      <button class="btn-secondary btn-sm" :disabled="testing" @click="runTest">
        {{ testing ? '测试中...' : '开始测试' }}
      </button>
    </div>

    <div v-if="result" class="result-card" :class="{ success: result.success, fail: !result.success }">
      <div class="result-head">
        <strong>{{ result.success ? '✓ 成功' : '✗ 失败' }}</strong>
        <span>{{ result.provider || '' }} · {{ result.endpoint || '' }}</span>
        <span>{{ formatElapsed(result.elapsedMs) }}</span>
      </div>
      <div v-if="result.fields && hasFields" class="field-grid">
        <div><span>发票号</span><b>{{ result.fields.invoiceNo || '-' }}</b></div>
        <div><span>金额</span><b>{{ money(result.fields.totalAmount || result.fields.amount) }}</b></div>
        <div><span>税额</span><b>{{ money(result.fields.taxAmount) }}</b></div>
        <div><span>日期</span><b>{{ result.fields.invoiceDate || '-' }}</b></div>
        <div><span>销方</span><b>{{ result.fields.sellerName || '-' }}</b></div>
        <div><span>购方</span><b>{{ result.fields.buyerName || '-' }}</b></div>
      </div>
      <div v-if="result.error" class="error-box">
        <b>{{ result.error.code }}：</b>{{ result.error.message }}
        <div class="suggestion">建议：{{ result.error.suggestion }}</div>
      </div>
      <div v-if="result.rawText" class="raw-text">
        <button class="link-btn" @click="showRaw = !showRaw">{{ showRaw ? '收起原始文本' : '展开原始文本' }}</button>
        <pre v-if="showRaw">{{ result.rawText }}</pre>
      </div>
    </div>

    <div class="history">
      <div class="history-head">
        <span>历史记录（最近 {{ history.length }} 条）</span>
        <button v-if="history.length" class="link-btn" @click="$emit('clear-history')">清空历史</button>
      </div>
      <div v-for="entry in history" :key="entry.id" class="history-row" :class="{ fail: !entry.success }">
        <span>{{ entry.success ? '✓' : '✗' }}</span>
        <span>{{ formatTime(entry.createdAt) }}</span>
        <span>{{ entry.provider || entry.type }}</span>
        <span>{{ formatElapsed(entry.elapsedMs) }}</span>
        <span>{{ entry.error?.code || (entry.fields?.totalAmount || entry.fields?.amount || '') }}</span>
      </div>
      <div v-if="history.length === 0" class="empty-state">暂无测试记录</div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'

const props = defineProps<{
  testing: boolean
  result: any | null
  history: any[]
}>()

const emit = defineEmits<{
  (event: 'test', payload: { file?: File }): void
  (event: 'clear-history'): void
}>()

const file = ref<File | null>(null)
const fileInput = ref<HTMLInputElement>()
const showRaw = ref(false)

const hasFields = computed(() => {
  const fields = props.result?.fields
  return !!fields && Object.values(fields).some(value => value !== undefined && value !== null && value !== '')
})

function chooseFile(event: Event) {
  const input = event.target as HTMLInputElement
  file.value = input.files?.[0] || null
}

function clearFile() {
  file.value = null
  if (fileInput.value) fileInput.value.value = ''
}

function runTest() {
  emit('test', { file: file.value || undefined })
}

function formatElapsed(value: number | undefined): string {
  if (!value) return '0ms'
  return value >= 1000 ? `${(value / 1000).toFixed(2)}s` : `${value}ms`
}

function formatTime(value: string): string {
  if (!value) return ''
  const date = new Date(value)
  return `${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

function money(value: any): string {
  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? `¥${number.toFixed(2)}` : '-'
}
</script>

<style scoped>
.engine-test-panel { margin-top: 12px; border-top: 1px dashed var(--border-light); padding-top: 12px; }
.test-controls { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.file-picker { display: inline-flex; align-items: center; border: 1px dashed var(--border); border-radius: var(--radius-sm); padding: 7px 10px; font-size: .8rem; color: var(--text-secondary); cursor: pointer; }
.file-picker input { display: none; }
.link-btn { border: none; background: none; color: var(--accent-coral); font-size: .78rem; cursor: pointer; text-decoration: underline; }
.result-card { margin-top: 10px; border-radius: var(--radius-sm); padding: 10px 12px; font-size: .82rem; background: var(--bg-input); }
.result-card.success { border-left: 3px solid #2b7a3d; }
.result-card.fail { border-left: 3px solid var(--accent-coral); }
.result-head { display: flex; gap: 10px; flex-wrap: wrap; align-items: center; }
.field-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 6px 14px; margin-top: 8px; }
.field-grid span { color: var(--text-muted); margin-right: 6px; }
.error-box { margin-top: 8px; padding: 8px 10px; border-radius: var(--radius-sm); background: var(--accent-coral-bg); color: var(--accent-coral); }
.suggestion { margin-top: 4px; color: var(--text-secondary); }
.raw-text { margin-top: 8px; }
.raw-text pre { max-height: 220px; overflow: auto; white-space: pre-wrap; word-break: break-all; background: var(--bg-card); padding: 8px; border-radius: var(--radius-sm); font-size: .75rem; }
.history { margin-top: 12px; }
.history-head { display: flex; justify-content: space-between; align-items: center; font-size: .8rem; color: var(--text-muted); margin-bottom: 6px; }
.history-row { display: grid; grid-template-columns: 18px 1fr 1fr 1fr 1fr; gap: 6px; font-size: .76rem; padding: 5px 0; border-bottom: 1px solid var(--border-light); color: var(--text-secondary); }
.history-row.fail { color: var(--accent-coral); }
.empty-state { text-align: center; color: var(--text-muted); padding: 12px 0; font-size: .8rem; }
</style>
```

- [ ] **Step 2: 构建验证**

Run: `pnpm --filter @sse/web build`
Expected: 通过。

- [ ] **Step 3: 提交**

```bash
git add packages/web/src/components/EngineTestPanel.vue
git commit -m "feat(web): add OCR engine test panel"
```

---

### Task 12: 接入 Admin 页面

**Files:**
- Create: `packages/web/src/utils/endpoint.ts`
- Modify: `packages/web/src/pages/Admin.vue`

- [ ] **Step 1: 增加前端地址归一化工具**

```ts
// packages/web/src/utils/endpoint.ts
const CHAT_SUFFIX = '/chat/completions';

export function normalizeEndpoint(input: string): string {
  let value = String(input || '').trim().replace(/\/+$/, '');
  if (!value) return '';
  if (value.toLowerCase().endsWith(CHAT_SUFFIX)) {
    value = value.slice(0, -CHAT_SUFFIX.length).replace(/\/+$/, '');
  }
  if (value.toLowerCase().endsWith('/v1')) {
    value = value.slice(0, -3).replace(/\/+$/, '');
  }
  return value;
}
```

- [ ] **Step 2: 替换两个引擎卡片模板**

把 `Admin.vue` 的 `<!-- 智能填单引擎 -->` 到 `<!-- 审批流程设计 -->` 之前的两个卡片替换为：

```vue
    <!-- 智能填单引擎 -->
    <div class="card" style="margin-bottom:20px">
      <h3 class="font-heading section-title">📝 智能填单引擎</h3>
      <div class="form-grid">
        <div class="field full">
          <label>API 地址</label>
          <input
            v-model="cfg.fillEngine.endpoint"
            placeholder="http://192.168.3.117:11434"
            @blur="loadCatalogForEndpoint"
          />
          <div class="field-hint">填写到端口或 /v1 即可，系统会自动补全接口路径</div>
        </div>
        <div class="field full">
          <label>API 密钥</label>
          <div class="key-row">
            <input
              v-model="cfg.fillEngine.apiKey"
              type="password"
              autocomplete="new-password"
              :placeholder="cfg.fillEngine.apiKeySet ? '已配置，留空则不修改' : '可选，留空表示无密钥'"
            />
            <button class="btn-secondary btn-sm" :disabled="connectionTesting" @click="testConnection">
              {{ connectionTesting ? '检测中...' : '检测' }}
            </button>
          </div>
          <div
            v-if="connectionResult"
            class="inline-result"
            :class="{ success: connectionResult.success, fail: !connectionResult.success }"
          >
            {{ connectionMessage }}
          </div>
        </div>
        <div class="field full">
          <label>模型</label>
          <div class="model-select-row">
            <select v-model="cfg.fillEngine.model">
              <option v-for="model in selectedModels" :key="model.id" :value="model.id">{{ model.id }}</option>
            </select>
            <button class="btn-secondary btn-sm" @click="showModelPicker = true">获取模型列表</button>
          </div>
          <div class="field-hint">
            已选 {{ selectedModels.length }} 个模型
            <span v-if="selectedModels.length === 0">，请先获取模型列表</span>
          </div>
        </div>
      </div>
      <div style="margin-top:12px;display:flex;gap:10px;flex-wrap:wrap;align-items:center">
        <button class="btn-primary btn-sm" @click="saveConfig" :disabled="saving">💾 保存</button>
        <button class="btn-secondary btn-sm" @click="testFill" :disabled="testing">{{ testing==='text'?'测试中...':'📝 检验文字识别' }}</button>
        <label class="toggle-label"><input type="checkbox" v-model="cfg.fillEngine.enabled" @change="saveConfig" /><span>启用</span></label>
      </div>
      <div v-if="fillTestResult" class="ai-test-result" :class="{success:fillTestResult.success,fail:!fillTestResult.success}">
        {{ fillTestResult.message }}（{{ fillTestResult.elapsedMs }}ms）
      </div>
    </div>

    <!-- 发票OCR引擎 -->
    <div class="card" style="margin-bottom:20px">
      <h3 class="font-heading section-title">🧾 发票OCR引擎</h3>
      <div class="form-grid">
        <div class="field">
          <label>引擎方案</label>
          <select v-model="cfg.ocrEngine.provider" @change="saveConfig">
            <option value="mineru">MinerU (文档智能解析)</option>
            <option value="paddle">PaddleOCR (通用OCR)</option>
            <option value="vision">视觉模型 (glm-ocr等)</option>
          </select>
        </div>
        <template v-if="cfg.ocrEngine.provider==='mineru'">
          <div class="field full"><label>MinerU 端点</label><input v-model="cfg.ocrEngine.mineruEndpoint" placeholder="https://mineru.net" /></div>
          <div class="field full">
            <label>MinerU Token</label>
            <input
              v-model="cfg.ocrEngine.mineruToken"
              type="password"
              autocomplete="new-password"
              :placeholder="cfg.ocrEngine.mineruTokenSet ? '已配置，留空则不修改' : '粘贴 MinerU API Token'"
            />
          </div>
        </template>
        <template v-else-if="cfg.ocrEngine.provider==='paddle'">
          <div class="field full"><label>PaddleOCR 端点</label><input v-model="cfg.ocrEngine.paddleEndpoint" placeholder="http://localhost:8899" /></div>
        </template>
        <template v-else>
          <div class="field"><label>视觉模型端点</label><input v-model="cfg.ocrEngine.visionEndpoint" placeholder="http://192.168.3.117:11434" /></div>
          <div class="field"><label>视觉模型名</label><input v-model="cfg.ocrEngine.visionModel" /></div>
          <div class="field full">
            <label>视觉模型 API 密钥</label>
            <input
              v-model="cfg.ocrEngine.visionApiKey"
              type="password"
              autocomplete="new-password"
              :placeholder="cfg.ocrEngine.visionApiKeySet ? '已配置，留空则不修改' : '可选'"
            />
          </div>
        </template>
      </div>
      <div style="margin-top:12px;display:flex;gap:10px;flex-wrap:wrap;align-items:center">
        <button class="btn-primary btn-sm" @click="saveConfig" :disabled="saving">💾 保存</button>
        <label class="toggle-label"><input type="checkbox" v-model="cfg.ocrEngine.enabled" @change="saveConfig" /><span>启用</span></label>
      </div>
      <EngineTestPanel
        :testing="testing==='ocr'"
        :result="ocrTestResult"
        :history="ocrHistory"
        @test="testOcr"
        @clear-history="clearOcrHistory"
      />
    </div>
```

- [ ] **Step 3: 更新脚本状态与导入**

在 `Admin.vue` 的 `<script setup>` 中增加导入：

```ts
import ModelPickerDialog from '@/components/ModelPickerDialog.vue'
import EngineTestPanel from '@/components/EngineTestPanel.vue'
import { normalizeEndpoint } from '@/utils/endpoint'
```

把 `cfg` 初始值改为：

```ts
const cfg = reactive<any>({
  fillEngine: { endpoint: '', apiKey: '', apiKeySet: false, model: '', enabled: true, catalogs: {} },
  ocrEngine: {
    provider: 'mineru',
    mineruEndpoint: '',
    mineruToken: '',
    mineruTokenSet: false,
    paddleEndpoint: '',
    visionEndpoint: '',
    visionModel: '',
    visionApiKey: '',
    visionApiKeySet: false,
    enabled: true,
  },
})
```

新增状态：

```ts
const showModelPicker = ref(false)
const connectionTesting = ref(false)
const connectionResult = ref<any>(null)
const fillTestResult = ref<any>(null)
const ocrTestResult = ref<any>(null)
const ocrHistory = ref<any[]>([])
const currentCatalog = computed(() => {
  const key = normalizeEndpoint(cfg.fillEngine.endpoint)
  return key ? (cfg.fillEngine.catalogs?.[key] || null) : null
})
const selectedModels = computed(() => {
  const models = currentCatalog.value?.models || []
  const selected = models.filter((model: any) => model.selected)
  if (cfg.fillEngine.model && !selected.some((model: any) => model.id === cfg.fillEngine.model)) {
    return [{ id: cfg.fillEngine.model, name: cfg.fillEngine.model }, ...selected]
  }
  return selected
})
const connectionMessage = computed(() => {
  if (!connectionResult.value) return ''
  const steps = connectionResult.value.steps || []
  const models = steps.find((step: any) => step.name === 'models')
  const chat = steps.find((step: any) => step.name === 'chat')
  if (connectionResult.value.success) {
    return `✓ 连接成功 · 模型 ${models?.modelCount ?? 0} 个（${models?.elapsedMs ?? 0}ms）· 对话 ${chat?.elapsedMs ?? 0}ms`
  }
  const failed = steps.find((step: any) => !step.ok)
  const label = failed?.name === 'models' ? '模型列表' : failed?.name === 'chat' ? '对话' : ''
  return `✗ ${label ? `${label}：` : ''}${failed?.message || connectionResult.value.message}`
})
```

需要 `computed` 导入：

```ts
import { ref, reactive, computed, onMounted } from 'vue'
```

- [ ] **Step 4: 更新 onMounted 与保存逻辑**

`onMounted` 改为：

```ts
onMounted(async () => {
  try {
    const [c, u] = await Promise.all([api.get('/admin/ai-config'), api.get('/admin/users')])
    Object.assign(cfg, c.data)
    users.value = u.data || []
  } catch {}
  if (!currentCatalog.value && cfg.fillEngine.endpoint) {
    refreshCatalogInBackground()
  }
  loadOcrHistory()
  try { rules.value = (await api.get('/admin/rules')).data || [] } catch {}
  try { const r = await api.get('/categories'); categoryOptions.value = r.data || [] } catch {}
})
```

`saveConfig` 改为：

```ts
async function saveConfig() {
  saving.value = true
  try {
    const payload: any = {
      fillEngine: {
        endpoint: cfg.fillEngine.endpoint,
        apiKey: cfg.fillEngine.apiKey,
        model: cfg.fillEngine.model,
        enabled: cfg.fillEngine.enabled,
      },
      ocrEngine: {
        provider: cfg.ocrEngine.provider,
        mineruEndpoint: cfg.ocrEngine.mineruEndpoint,
        mineruToken: cfg.ocrEngine.mineruToken,
        paddleEndpoint: cfg.ocrEngine.paddleEndpoint,
        visionEndpoint: cfg.ocrEngine.visionEndpoint,
        visionModel: cfg.ocrEngine.visionModel,
        visionApiKey: cfg.ocrEngine.visionApiKey,
        enabled: cfg.ocrEngine.enabled,
      },
    }
    const r = await api.put('/admin/ai-config', payload, { timeout: 30000 })
    if (r.data) Object.assign(cfg, r.data)
  } finally { saving.value = false }
}
```

- [ ] **Step 5: 增加检测、模型列表、测试与历史函数**

```ts
async function testConnection() {
  connectionTesting.value = true
  connectionResult.value = null
  try {
    const r = await api.post('/admin/ai-connection-test', {
      endpoint: cfg.fillEngine.endpoint,
      apiKey: cfg.fillEngine.apiKey || undefined,
      model: cfg.fillEngine.model || undefined,
    }, { timeout: 60000 })
    connectionResult.value = r.data
  } catch (e: any) {
    connectionResult.value = { success: false, message: e?.response?.data?.message || e?.message || '检测失败', steps: [] }
  } finally { connectionTesting.value = false }
}

async function loadCatalogForEndpoint() {
  if (!normalizeEndpoint(cfg.fillEngine.endpoint)) return
  if (!currentCatalog.value) await refreshCatalogInBackground()
}

async function refreshCatalogInBackground() {
  try {
    const r = await api.post('/admin/ai-models', {
      endpoint: cfg.fillEngine.endpoint,
      apiKey: cfg.fillEngine.apiKey || undefined,
    }, { timeout: 30000 })
    const key = normalizeEndpoint(cfg.fillEngine.endpoint)
    if (!key) return
    const nextCatalog = r.data?.catalog
    if (!nextCatalog || !Array.isArray(nextCatalog.models)) return
    if (nextCatalog.models.length === 0) return
    if (cfg.fillEngine.model && !nextCatalog.models.some((model: any) => model.id === cfg.fillEngine.model)) {
      nextCatalog.models.unshift({
        id: cfg.fillEngine.model,
        name: cfg.fillEngine.model,
        autoTags: [],
        manualTags: [],
        selected: true,
        metadata: {},
        missing: true,
      })
    }
    if (!nextCatalog.models.some((model: any) => model.selected) && nextCatalog.models[0]) {
      nextCatalog.models[0].selected = true
      cfg.fillEngine.model = nextCatalog.models[0].id
    }
    cfg.fillEngine.catalogs = { ...(cfg.fillEngine.catalogs || {}), [key]: nextCatalog }
    await api.put('/admin/ai-config', {
      fillEngine: {
        endpoint: cfg.fillEngine.endpoint,
        model: cfg.fillEngine.model,
        catalog: nextCatalog,
      },
    }, { timeout: 30000 })
  } catch { /* 后台自动获取失败时保持旧配置 */ }
}

async function onModelPickerConfirm(payload: { catalog: any; activeModel: string }) {
  const key = normalizeEndpoint(cfg.fillEngine.endpoint)
  if (key) {
    cfg.fillEngine.catalogs = { ...(cfg.fillEngine.catalogs || {}), [key]: payload.catalog }
  }
  cfg.fillEngine.model = payload.activeModel
  try {
    const r = await api.put('/admin/ai-config', {
      fillEngine: {
        endpoint: cfg.fillEngine.endpoint,
        model: payload.activeModel,
        catalog: payload.catalog,
      },
    }, { timeout: 30000 })
    if (r.data) Object.assign(cfg, r.data)
  } catch (e: any) {
    alert('保存模型列表失败: ' + (e?.response?.data?.message || e?.message || ''))
  }
}

async function testFill() {
  testing.value = 'text'
  fillTestResult.value = null
  try {
    const r = await api.post('/admin/ai-test/fill', {
      endpoint: cfg.fillEngine.endpoint,
      apiKey: cfg.fillEngine.apiKey || undefined,
      model: cfg.fillEngine.model || undefined,
    }, { timeout: 180000 })
    fillTestResult.value = r.data
  } catch (e: any) {
    fillTestResult.value = { success: false, message: e?.message || '测试失败', elapsedMs: 0 }
  } finally { testing.value = false }
}

async function testOcr(payload: { file?: File }) {
  testing.value = 'ocr'
  ocrTestResult.value = null
  const form = new FormData()
  form.append('provider', cfg.ocrEngine.provider)
  form.append('mineruEndpoint', cfg.ocrEngine.mineruEndpoint || '')
  form.append('mineruToken', cfg.ocrEngine.mineruToken || '')
  form.append('paddleEndpoint', cfg.ocrEngine.paddleEndpoint || '')
  form.append('visionEndpoint', cfg.ocrEngine.visionEndpoint || '')
  form.append('visionModel', cfg.ocrEngine.visionModel || '')
  form.append('visionApiKey', cfg.ocrEngine.visionApiKey || '')
  if (payload.file) form.append('file', payload.file)
  try {
    const r = await api.post('/admin/ai-test/ocr', form, { timeout: 180000 })
    ocrTestResult.value = r.data
    loadOcrHistory()
  } catch (e: any) {
    ocrTestResult.value = {
      success: false,
      elapsedMs: 0,
      fields: {},
      rawText: '',
      error: { code: 'UNKNOWN', message: e?.message || '测试失败', suggestion: '查看 API 日志' },
    }
  } finally { testing.value = false }
}

async function loadOcrHistory() {
  try {
    const r = await api.get('/admin/ai-test-history', { params: { type: 'ocr', limit: 10 } })
    ocrHistory.value = r.data || []
  } catch { ocrHistory.value = [] }
}

async function clearOcrHistory() {
  if (!confirm('确定清空测试历史？')) return
  try {
    await api.delete('/admin/ai-test-history')
    ocrHistory.value = []
  } catch {}
}
```

- [ ] **Step 6: 移除旧的模型与测试函数**

删除旧的 `fillModels`、`modelsLoading`、`fetchModels`、`testAI` 函数，以及不再使用的 `result`、`resultOk` 引用。`testAI` 已被 `testFill` / `testOcr` 替代；如果其他模板仍引用 `testAI`，一并替换。保留 `testing`，它仍用于两个测试按钮的禁用状态。

- [ ] **Step 7: 在模板末尾挂载对话框**

在 `Admin.vue` 根 `</div>` 之前加入：

```vue
    <ModelPickerDialog
      v-model:open="showModelPicker"
      :endpoint="cfg.fillEngine.endpoint"
      :api-key="cfg.fillEngine.apiKey"
      :catalog="currentCatalog"
      :active-model="cfg.fillEngine.model"
      @confirm="onModelPickerConfirm"
    />
```

- [ ] **Step 8: 补充样式**

在 `<style scoped>` 中增加：

```css
.field-hint { margin-top: 4px; font-size: .75rem; color: var(--text-muted); }
.key-row { display: flex; gap: 6px; }
.key-row input { flex: 1; }
.inline-result { margin-top: 6px; padding: 7px 10px; border-radius: var(--radius-sm); font-size: .8rem; }
.inline-result.success { background: var(--accent-mint-bg); color: #2b7a3d; }
.inline-result.fail { background: var(--accent-coral-bg); color: var(--accent-coral); }
```

- [ ] **Step 9: 构建验证**

Run: `pnpm --filter @sse/web build`
Expected: 通过。

- [ ] **Step 10: 提交**

```bash
git add packages/web/src/utils/endpoint.ts packages/web/src/pages/Admin.vue
git commit -m "feat(web): integrate engine usability settings"
```

---

### Task 13: 忽略历史文件与最终验证

**Files:**
- Modify: `.gitignore`

- [ ] **Step 1: 更新 `.gitignore`**

在 `ai-config.json` 后增加：

```gitignore
ai-test-history.json
```

- [ ] **Step 2: 运行完整构建与测试**

```bash
pnpm --filter @sse/ai test
pnpm --filter @sse/core test
pnpm --filter @sse/ai build
pnpm --filter @sse/ontology build
pnpm --filter @sse/db build
pnpm --filter @sse/api build
pnpm --filter @sse/mcp build
pnpm --filter @sse/web build
```

Expected: 全部通过。

- [ ] **Step 3: 更新开发过程记录**

在 `docs/2026-11-02-sse-process.md` 末尾增加「阶段二十一：系统管理引擎设置可用性优化」，记录：

```markdown
## 阶段二十一：系统管理引擎设置可用性优化

### 问题
- 智能填单要求完整 /v1/chat/completions 地址，缺少 API 密钥。
- 模型只能从固定下拉框选择，无法查看地址实际模型。
- OCR 测试结果不可观测。

### 实现
- 地址归一化：根地址、/v1、完整旧地址兼容。
- 智能填单：API 密钥、检测（模型列表 + 最小对话）、模型选择对话框（搜索/分类/刷新/+−/手动标签）。
- 配置：ai-config.json 增加 apiKey、catalogs、visionApiKey；按地址持久化。
- OCR：测试耗时/状态/字段/原始文本/失败建议/样例上传/历史记录。
- 本体、MCP、视觉 OCR 透传 apiKey。

### 验证
- @sse/ai 单元测试通过。
- ai/core/api/mcp/web 构建通过。
- 本地 Ollama 冒烟通过。
```

- [ ] **Step 4: 冒烟验证**

启动 API 和 Web 后，用管理员登录：

1. 智能填单地址填 `http://192.168.3.117:11434`，密钥留空。
2. 点「检测」：模型列表和对话两步都成功。
3. 点「获取模型列表」：对话框显示模型；搜索、分类、刷新可用。
4. 点某个模型的 `+`：模型进入模型文本框，按钮变 `−`；再点 `−`：移出，按钮变 `+`。
5. 点「确定」后刷新页面：已选模型和当前模型保留。
6. OCR 选择 MinerU，点「开始测试」：显示耗时、字段、原始文本；失败时显示错误分类和建议。
7. 上传一张样例发票测试；历史记录出现新条目；清空历史后列表为空。
8. 检查项目根目录 `ai-test-history.json` 已生成且被 git 忽略。

- [ ] **Step 5: 提交**

```bash
git add .gitignore docs/2026-11-02-sse-process.md
git commit -m "chore: ignore engine test history and record progress"
```

---

## 自审清单

- [x] 规格第 4 节地址规则由任务 1、5 覆盖。
- [x] 规格第 5 节配置结构由任务 4、6 覆盖。
- [x] 规格第 6 节检测与模型字段由任务 7、9、12 覆盖。
- [x] 规格第 7 节对话框与 `+` / `−` 由任务 10、12 覆盖。
- [x] 规格第 8 节分类规则由任务 2 覆盖。
- [x] 规格第 9 节后端接口由任务 7、8、9 覆盖。
- [x] 规格第 10 节 OCR 可观测性由任务 11、12 覆盖。
- [x] 规格第 11 节安全由任务 7（不跟随重定向、http/https）、任务 9（密钥回退）、任务 13（忽略历史）覆盖。
- [x] 规格第 12 节兼容与 apiKey 透传由任务 5、6 覆盖。
- [x] 规格第 13 节测试由各任务的 Jest 用例和任务 13 的构建/冒烟覆盖。
