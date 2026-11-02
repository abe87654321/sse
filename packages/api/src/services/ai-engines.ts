import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import {
  InvoiceOCREngine,
  LocalProvider,
  MinerUProvider,
  PaddleProvider,
  SmartFillEngine,
  VisionOCRProvider,
} from '@sse/ai';

export type OcrProvider = 'mineru' | 'paddle' | 'vision';

export interface AiConfig {
  fillEngine: {
    endpoint: string;
    model: string;
    enabled: boolean;
  };
  ocrEngine: {
    provider: OcrProvider;
    mineruEndpoint: string;
    mineruToken: string;
    paddleEndpoint: string;
    visionEndpoint: string;
    visionModel: string;
    enabled: boolean;
  };
}

export const AI_CONFIG_PATH = join(process.cwd(), 'ai-config.json');

export function loadAiConfig(): AiConfig {
  const defaults: AiConfig = {
    fillEngine: {
      endpoint: process.env.AI_ENDPOINT || 'http://localhost:11434/v1/chat/completions',
      model: process.env.AI_MODEL || 'llama3.1:8b',
      enabled: true,
    },
    ocrEngine: {
      provider: 'mineru',
      mineruEndpoint: process.env.MINERU_ENDPOINT || 'https://mineru.net',
      mineruToken: process.env.MINERU_TOKEN || '',
      paddleEndpoint: process.env.PADDLE_ENDPOINT || 'http://localhost:8899',
      visionEndpoint: process.env.AI_ENDPOINT || 'http://localhost:11434/v1/chat/completions',
      visionModel: process.env.AI_VISION_MODEL || 'glm-ocr',
      enabled: true,
    },
  };

  try {
    if (existsSync(AI_CONFIG_PATH)) {
      const saved = JSON.parse(readFileSync(AI_CONFIG_PATH, 'utf-8'));
      return {
        ...defaults,
        ...saved,
        fillEngine: { ...defaults.fillEngine, ...(saved.fillEngine || {}) },
        ocrEngine: { ...defaults.ocrEngine, ...(saved.ocrEngine || {}) },
      };
    }
  } catch {
    /* use defaults */
  }
  return defaults;
}

export function saveAiConfig(config: AiConfig): void {
  writeFileSync(AI_CONFIG_PATH, JSON.stringify(config, null, 2), 'utf-8');
}

export function publicAiConfig(config: AiConfig) {
  const { mineruToken, ...ocrEngine } = config.ocrEngine;
  return {
    ...config,
    ocrEngine: {
      ...ocrEngine,
      mineruToken: '',
      mineruTokenSet: !!(mineruToken || process.env.MINERU_TOKEN),
    },
  };
}

export function createOCREngine(config: AiConfig = loadAiConfig()): InvoiceOCREngine | null {
  const ocr = config.ocrEngine;
  if (!ocr.enabled) return null;

  if (ocr.provider === 'mineru') {
    return new InvoiceOCREngine(
      new MinerUProvider({ endpoint: ocr.mineruEndpoint, apiKey: ocr.mineruToken || process.env.MINERU_TOKEN })
    );
  }

  if (ocr.provider === 'paddle') {
    return new InvoiceOCREngine(new PaddleProvider({ endpoint: ocr.paddleEndpoint }));
  }

  const provider = new LocalProvider({
    endpoint: ocr.visionEndpoint,
    modelName: ocr.visionModel,
    timeoutMs: 120000,
  });
  return new InvoiceOCREngine(new VisionOCRProvider(provider));
}

export function createFillProvider(config: AiConfig = loadAiConfig()): LocalProvider | null {
  if (!config.fillEngine.enabled) return null;
  return new LocalProvider({
    endpoint: config.fillEngine.endpoint,
    modelName: config.fillEngine.model,
    timeoutMs: 120000,
  });
}

export function getSmartFillEngine(config: AiConfig = loadAiConfig()): SmartFillEngine | null {
  const provider = createFillProvider(config);
  return provider ? new SmartFillEngine(provider) : null;
}
