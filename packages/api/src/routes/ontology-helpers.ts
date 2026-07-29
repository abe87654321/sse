import { OntologyEngine } from '@sse/ontology';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

const CONFIG_PATH = join(process.cwd(), 'ai-config.json');

function loadAiConfig() {
  const defaults = {
    fillEngine: {
      endpoint: process.env.AI_ENDPOINT || 'http://localhost:11434/v1/chat/completions',
      model: process.env.AI_MODEL || 'llama3.2-vision',
    },
  };
  try {
    if (existsSync(CONFIG_PATH)) {
      const saved = JSON.parse(readFileSync(CONFIG_PATH, 'utf-8'));
      return { ...defaults, fillEngine: { ...defaults.fillEngine, ...(saved.fillEngine || {}) } };
    }
  } catch { /* use defaults */ }
  return defaults;
}

let engine: OntologyEngine;

export function getEngine(): OntologyEngine {
  if (!engine) {
    const cfg = loadAiConfig();
    engine = new OntologyEngine(cfg.fillEngine.endpoint, cfg.fillEngine.model);
  }
  return engine;
}
