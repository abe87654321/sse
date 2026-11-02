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
