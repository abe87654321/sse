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
