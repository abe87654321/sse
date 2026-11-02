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
