import { OntologyEngine } from "@sse/ontology";
import { createDefaultAiConfig, normalizeAiConfig, type AiConfig } from "@sse/ai";
import { readFileSync, existsSync } from "fs";
import { join } from "path";

const CONFIG_PATH = join(process.cwd(), "ai-config.json");

let engine: OntologyEngine | undefined;
let loading: Promise<void> | null = null;
let loaded = false;

function loadConfig(): AiConfig {
  try {
    return existsSync(CONFIG_PATH)
      ? normalizeAiConfig(JSON.parse(readFileSync(CONFIG_PATH, "utf-8")))
      : createDefaultAiConfig();
  } catch {
    return createDefaultAiConfig();
  }
}

export function getEngine(): OntologyEngine {
  if (!engine) {
    const config = loadConfig();
    engine = new OntologyEngine(
      config.fillEngine.endpoint,
      config.fillEngine.model,
      undefined,
      config.fillEngine.apiKey,
    );
  }
  return engine;
}

/**
 * Returns the shared ontology engine with the latest persisted graph loaded.
 *
 * The API process saves a graph snapshot to `ontology_snapshots`; a freshly
 * constructed engine has an empty in-memory store, which used to make
 * query_ontology / get_entity_network / query_sparql return nothing here.
 */
export async function ensureOntologyLoaded(): Promise<OntologyEngine> {
  const instance = getEngine();
  if (loaded) return instance;
  if (!loading) {
    loading = instance.store
      .loadFromDb()
      .catch(() => {
        // No snapshot yet, or the table is unavailable. Keep the empty graph
        // instead of failing every ontology call.
      })
      .then(() => {
        loaded = true;
        loading = null;
      });
  }
  await loading;
  return instance;
}
