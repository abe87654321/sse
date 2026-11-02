import { OntologyEngine } from "@sse/ontology";
import { readFileSync, existsSync } from "fs";
import { join } from "path";

const CONFIG_PATH = join(process.cwd(), "ai-config.json");

export function getEngine(): OntologyEngine {
  let endpoint = process.env.AI_ENDPOINT || "http://localhost:11434";
  let model = process.env.AI_MODEL || "llama3.2-vision";
  let apiKey = "";
  try {
    if (existsSync(CONFIG_PATH)) {
      const saved = JSON.parse(readFileSync(CONFIG_PATH, "utf-8"));
      endpoint = saved?.fillEngine?.endpoint || endpoint;
      model = saved?.fillEngine?.model || model;
      apiKey = saved?.fillEngine?.apiKey || "";
    }
  } catch { /* use defaults */ }
  return new OntologyEngine(endpoint, model, undefined, apiKey);
}
