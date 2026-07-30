import { OntologyEngine } from "@sse/ontology";
import { readFileSync, existsSync } from "fs";
import { join } from "path";

const CONFIG_PATH = join(process.cwd(), "ai-config.json");

export function getEngine(): OntologyEngine {
  const defaults = {
    fillEngine: {
      endpoint: process.env.AI_ENDPOINT || "http://localhost:11434/v1/chat/completions",
      model: process.env.AI_MODEL || "llama3.2-vision",
    },
  };
  let cfg = defaults;
  try {
    if (existsSync(CONFIG_PATH)) {
      const saved = JSON.parse(readFileSync(CONFIG_PATH, "utf-8"));
      cfg = { ...defaults, fillEngine: { ...defaults.fillEngine, ...(saved.fillEngine || {}) } };
    }
  } catch { /* use defaults */ }
  return new OntologyEngine(cfg.fillEngine.endpoint, cfg.fillEngine.model);
}
