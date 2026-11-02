import { MODEL_TAGS, type ModelTag } from '../utils/model-tagger';
import { normalizeServiceBase } from '../utils/endpoint';
import { resolveActiveModel } from './model-catalog';

export type OcrProvider = 'mineru' | 'paddle' | 'vision';
export type CatalogSource = 'openai' | 'ollama' | 'openrouter';

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
  source: CatalogSource;
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
    clearMineruToken?: boolean;
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

function isOcrProvider(value: any): value is OcrProvider {
  return value === 'mineru' || value === 'paddle' || value === 'vision';
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

function normalizeCatalogSource(value: any): CatalogSource {
  return value === 'ollama'
    ? 'ollama'
    : value === 'openrouter'
      ? 'openrouter'
      : 'openai';
}

function normalizeCatalog(value: any): ModelCatalog | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  if (!Array.isArray(value.models)) return null;
  return {
    fetchedAt: String(value.fetchedAt || ''),
    source: normalizeCatalogSource(value.source),
    models: value.models.map(normalizeCatalogModel).filter((model: CatalogModel) => model.id),
  };
}

function normalizeCatalogs(raw: any): Record<string, ModelCatalog> {
  const catalogs: Record<string, ModelCatalog> = Object.create(null);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return catalogs;
  for (const [key, value] of Object.entries(raw)) {
    const normalizedKey = normalizeServiceBase(key);
    if (!normalizedKey) continue;
    const catalog = normalizeCatalog(value);
    if (catalog) catalogs[normalizedKey] = catalog;
  }
  return catalogs;
}

function ensureActiveModelSelected(config: AiConfig): void {
  const key = normalizeServiceBase(config.fillEngine.endpoint);
  const catalog = config.fillEngine.catalogs[key];
  if (!catalog || !config.fillEngine.model) return;
  const entry = (catalog.models || []).find(model => model.id === config.fillEngine.model);
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
      provider: isOcrProvider(ocr.provider) ? ocr.provider : 'mineru',
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
  const key = normalizeServiceBase(config.fillEngine.endpoint);
  const catalog = key ? config.fillEngine.catalogs[key] : undefined;
  if (catalog) {
    config.fillEngine.model = resolveActiveModel(catalog, config.fillEngine.model);
  }
  return config;
}

export function applyAiConfigPatch(config: AiConfig, patch: AiConfigPatch): AiConfig {
  const next = JSON.parse(JSON.stringify(config)) as AiConfig;
  const fill = patch.fillEngine;
  if (fill) {
    const previousFillEndpoint = normalizeServiceBase(next.fillEngine.endpoint);
    if (typeof fill.endpoint === 'string') {
      next.fillEngine.endpoint = normalizeServiceBase(fill.endpoint);
    }
    if (typeof fill.model === 'string') next.fillEngine.model = fill.model;
    if (typeof fill.enabled === 'boolean') next.fillEngine.enabled = fill.enabled;

    const endpointChanged =
      normalizeServiceBase(next.fillEngine.endpoint) !== previousFillEndpoint;
    if (fill.clearApiKey) {
      next.fillEngine.apiKey = '';
    } else {
      if (endpointChanged) next.fillEngine.apiKey = '';
      if (typeof fill.apiKey === 'string' && fill.apiKey.trim()) {
        next.fillEngine.apiKey = fill.apiKey.trim();
      }
    }

    if (fill.catalog) {
      const key = normalizeServiceBase(next.fillEngine.endpoint);
      const catalog = normalizeCatalog(fill.catalog);
      if (key && catalog) next.fillEngine.catalogs[key] = catalog;
    }
  }

  const ocr = patch.ocrEngine;
  if (ocr) {
    const previousMineruEndpoint = normalizeServiceBase(next.ocrEngine.mineruEndpoint);
    const previousVisionEndpoint = normalizeServiceBase(next.ocrEngine.visionEndpoint);

    if (isOcrProvider(ocr.provider)) next.ocrEngine.provider = ocr.provider;
    if (typeof ocr.mineruEndpoint === 'string') {
      next.ocrEngine.mineruEndpoint = normalizeServiceBase(ocr.mineruEndpoint);
    }
    if (typeof ocr.paddleEndpoint === 'string') {
      next.ocrEngine.paddleEndpoint = normalizeServiceBase(ocr.paddleEndpoint);
    }
    if (typeof ocr.visionEndpoint === 'string') {
      next.ocrEngine.visionEndpoint = normalizeServiceBase(ocr.visionEndpoint);
    }
    if (typeof ocr.visionModel === 'string') next.ocrEngine.visionModel = ocr.visionModel;
    if (typeof ocr.enabled === 'boolean') next.ocrEngine.enabled = ocr.enabled;

    const mineruChanged =
      normalizeServiceBase(next.ocrEngine.mineruEndpoint) !== previousMineruEndpoint;
    const visionChanged =
      normalizeServiceBase(next.ocrEngine.visionEndpoint) !== previousVisionEndpoint;

    if (ocr.clearMineruToken) {
      next.ocrEngine.mineruToken = '';
    } else {
      if (mineruChanged) next.ocrEngine.mineruToken = '';
      if (typeof ocr.mineruToken === 'string' && ocr.mineruToken.trim()) {
        next.ocrEngine.mineruToken = ocr.mineruToken.trim();
      }
    }

    if (ocr.clearVisionApiKey) {
      next.ocrEngine.visionApiKey = '';
    } else {
      if (visionChanged) next.ocrEngine.visionApiKey = '';
      if (typeof ocr.visionApiKey === 'string' && ocr.visionApiKey.trim()) {
        next.ocrEngine.visionApiKey = ocr.visionApiKey.trim();
      }
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

export function toPublicAiConfig(
  config: AiConfig,
  env: NodeJS.ProcessEnv = process.env,
): PublicAiConfig {
  return {
    fillEngine: {
      endpoint: config.fillEngine.endpoint,
      apiKey: '',
      apiKeySet: !!config.fillEngine.apiKey,
      model: config.fillEngine.model,
      enabled: config.fillEngine.enabled,
      catalogs: JSON.parse(JSON.stringify(config.fillEngine.catalogs)),
    },
    ocrEngine: {
      provider: config.ocrEngine.provider,
      mineruEndpoint: config.ocrEngine.mineruEndpoint,
      mineruToken: '',
      mineruTokenSet: !!config.ocrEngine.mineruToken,
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
