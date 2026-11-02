import { classifyModel } from '../utils/model-tagger';
import type { CatalogModel, ModelCatalog } from './ai-config';

export interface FetchedModel {
  id: string;
  name?: string;
  owner?: string;
  metadata?: Record<string, any>;
  source?: 'openai' | 'ollama' | 'openrouter';
}

export function mergeCatalog(
  existing: ModelCatalog | undefined,
  fetched: FetchedModel[],
  source: 'openai' | 'ollama' | 'openrouter',
): ModelCatalog {
  const oldById = new Map((existing?.models || []).map(model => [model.id, model]));
  const fetchedIds = new Set(fetched.map(model => model.id));

  const models: CatalogModel[] = fetched.map((model) => {
    const old = oldById.get(model.id);
    return {
      id: model.id,
      name: model.name || old?.name || model.id,
      owner: model.owner ?? old?.owner,
      metadata: model.metadata ?? old?.metadata ?? {},
      autoTags: classifyModel({
        id: model.id,
        name: model.name,
        owner: model.owner,
        metadata: model.metadata,
        source: model.source || source,
      }),
      manualTags: old?.manualTags || [],
      selected: old?.selected ?? false,
      missing: undefined,
    };
  });

  for (const old of existing?.models || []) {
    if (!fetchedIds.has(old.id)) {
      models.push({ ...old, missing: true });
    }
  }

  return {
    fetchedAt: new Date().toISOString(),
    source,
    models,
  };
}

export function selectedCatalogModels(catalog: ModelCatalog | null | undefined): CatalogModel[] {
  return (catalog?.models || []).filter(model => model.selected);
}

export function resolveActiveModel(catalog: ModelCatalog | null | undefined, currentModel: string): string {
  const selected = selectedCatalogModels(catalog).map(model => model.id);
  if (selected.includes(currentModel)) return currentModel;
  return selected[0] || '';
}
