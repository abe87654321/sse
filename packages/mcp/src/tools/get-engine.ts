import { OntologyEngine } from "@sse/ontology";
import { createDefaultAiConfig, normalizeAiConfig, type AiConfig } from "@sse/ai";
import { readFileSync, existsSync } from "fs";
import { join } from "path";

const CONFIG_PATH = join(process.cwd(), "ai-config.json");

export function getEngine(): OntologyEngine {
  let config: AiConfig;
  try {
    config = existsSync(CONFIG_PATH)
      ? normalizeAiConfig(JSON.parse(readFileSync(CONFIG_PATH, "utf-8")))
      : createDefaultAiConfig();
  } catch {
    config = createDefaultAiConfig();
  }
  return new OntologyEngine(
    config.fillEngine.endpoint,
    config.fillEngine.model,
    undefined,
    config.fillEngine.apiKey,
  );
}
