import { mergeCatalog, resolveActiveModel } from '../model-catalog';

describe('model catalog', () => {
  it('merges fetched models and preserves selection and manual tags', () => {
    const existing = {
      fetchedAt: 'old',
      source: 'openai' as const,
      models: [
        {
          id: 'a',
          name: 'a',
          autoTags: ['推理' as const],
          manualTags: ['免费' as const],
          selected: true,
          metadata: {},
        },
      ],
    };
    const merged = mergeCatalog(
      existing,
      [{ id: 'a', name: 'a', metadata: {} }, { id: 'b', name: 'b', metadata: {} }],
      'openai',
    );
    expect(merged.models.find(model => model.id === 'a')?.selected).toBe(true);
    expect(merged.models.find(model => model.id === 'a')?.manualTags).toEqual(['免费']);
    expect(merged.models.find(model => model.id === 'b')?.selected).toBe(false);
    expect(merged.models.find(model => model.id === 'b')?.autoTags).toBeDefined();

    merged.models.find(model => model.id === 'a')?.manualTags.push('视觉');
    expect(existing.models[0].manualTags).toEqual(['免费']);
  });

  it('keeps selected models that the endpoint no longer returns', () => {
    const merged = mergeCatalog(
      {
        fetchedAt: 'old',
        source: 'openai',
        models: [
          {
            id: 'gone',
            name: 'gone',
            autoTags: [],
            manualTags: [],
            selected: true,
            metadata: {},
          },
        ],
      },
      [],
      'openai',
    );
    expect(merged.models[0].id).toBe('gone');
    expect(merged.models[0].missing).toBe(true);
  });

  it('drops unselected models that the endpoint no longer returns', () => {
    const merged = mergeCatalog(
      {
        fetchedAt: 'old',
        source: 'openai',
        models: [
          {
            id: 'gone',
            name: 'gone',
            autoTags: [],
            manualTags: [],
            selected: false,
            metadata: {},
          },
        ],
      },
      [],
      'openai',
    );
    expect(merged.models.find(model => model.id === 'gone')).toBeUndefined();
  });

  it('resolves the active model from selected entries', () => {
    const catalog = {
      fetchedAt: 'now',
      source: 'openai' as const,
      models: [
        { id: 'a', name: 'a', autoTags: [], manualTags: [], selected: true, metadata: {} },
        { id: 'b', name: 'b', autoTags: [], manualTags: [], selected: false, metadata: {} },
      ],
    };
    expect(resolveActiveModel(catalog, 'a')).toBe('a');
    expect(resolveActiveModel(catalog, 'missing')).toBe('a');
    expect(resolveActiveModel({ ...catalog, models: [catalog.models[1]] }, 'a')).toBe('');
    expect(resolveActiveModel({ ...catalog, models: [catalog.models[1]] }, '')).toBe('');
  });
});
