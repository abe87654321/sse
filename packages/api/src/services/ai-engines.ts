import { existsSync, readFileSync, statSync, writeFileSync } from 'fs';
import { join, resolve } from 'path';
import {
  InvoiceOCREngine,
  LocalProvider,
  MinerUProvider,
  PaddleProvider,
  SmartFillEngine,
  VisionOCRProvider,
  createDefaultAiConfig,
  normalizeAiConfig,
  toPersistedAiConfig,
  toPublicAiConfig,
  type AiConfig,
  type OcrProvider,
} from '@sse/ai';

export type { AiConfig, OcrProvider };

const AI_CONFIG_FILENAME = 'ai-config.json';

/**
 * Resolve the canonical config location independent of the process cwd.
 *
 * The API is started both through `pnpm dev` (cwd = packages/api) and through
 * `node packages/api/dist/index.js` (cwd = repo root). Resolving from this
 * module keeps every launcher pointing at the same file, so a model saved in
 * system management is visible to every consumer (REST, MCP, ontology).
 */
export function resolveAiConfigPath(): string {
  const explicit = (process.env.AI_CONFIG_PATH || '').trim();
  if (explicit) return resolve(explicit);
  // src/services and dist/services are both four levels below the repo root.
  return resolve(__dirname, '..', '..', '..', '..', AI_CONFIG_FILENAME);
}

function legacyAiConfigPath(): string {
  return join(process.cwd(), AI_CONFIG_FILENAME);
}

function existingConfigPath(): string | null {
  const primary = resolveAiConfigPath();
  const legacy = legacyAiConfigPath();
  const candidates = [primary, legacy]
    .filter((path, index, all) => path && all.indexOf(path) === index)
    .filter(path => existsSync(path));
  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0];
  // Both locations exist after an upgrade: honour the most recently written
  // one so a stale copy cannot make system-management settings look ignored.
  return candidates.reduce((newest, path) =>
    statSync(path).mtimeMs >= statSync(newest).mtimeMs ? path : newest
  );
}

export function loadAiConfig(): AiConfig {
  try {
    const path = existingConfigPath();
    if (path) {
      const saved = JSON.parse(readFileSync(path, 'utf-8'));
      return normalizeAiConfig(saved);
    }
  } catch {
    /* use defaults */
  }
  return createDefaultAiConfig();
}

export function saveAiConfig(config: AiConfig): void {
  const serialized = JSON.stringify(toPersistedAiConfig(config), null, 2);
  writeFileSync(resolveAiConfigPath(), serialized, { encoding: 'utf-8', mode: 0o600 });

  // Keep a pre-existing cwd-relative file in sync so launchers that still read
  // the legacy location do not silently use stale settings.
  const legacy = legacyAiConfigPath();
  if (legacy !== resolveAiConfigPath() && existsSync(legacy)) {
    try {
      writeFileSync(legacy, serialized, { encoding: 'utf-8', mode: 0o600 });
    } catch {
      /* best effort */
    }
  }
}

export const AI_CONFIG_PATH = resolveAiConfigPath();

export const publicAiConfig = toPublicAiConfig;

export function createOCREngine(config: AiConfig = loadAiConfig()): InvoiceOCREngine | null {
  const ocr = config.ocrEngine;
  if (!ocr.enabled) return null;

  if (ocr.provider === 'mineru') {
    return new InvoiceOCREngine(
      new MinerUProvider({
        endpoint: ocr.mineruEndpoint,
        apiKey: ocr.mineruToken,
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

/**
 * Provider for screenshot recognition. Uses the vision engine configured in
 * system management; returns null when it is disabled or incomplete so the
 * caller can surface a clear "not configured" error instead of an empty result.
 */
export function createVisionFillProvider(config: AiConfig = loadAiConfig()): LocalProvider | null {
  const vision = config.visionEngine;
  if (!vision?.enabled || !vision.endpoint || !vision.model) return null;
  return new LocalProvider({
    endpoint: vision.endpoint,
    modelName: vision.model,
    apiKey: vision.apiKey,
    timeoutMs: 120000,
  });
}

export function getSmartFillVisionEngine(config: AiConfig = loadAiConfig()): SmartFillEngine | null {
  const provider = createVisionFillProvider(config);
  return provider ? new SmartFillEngine(provider) : null;
}
