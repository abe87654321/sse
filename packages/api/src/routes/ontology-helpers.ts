import { OntologyEngine } from '@sse/ontology';
import { loadAiConfig } from '../services/ai-engines';

let engine: OntologyEngine | undefined;

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

export function resetEngine(): void {
  engine = undefined;
}
