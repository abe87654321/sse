import { classifyModel, effectiveTags, MODEL_TAGS } from '../model-tagger';

describe('classifyModel', () => {
  it('uses OpenRouter modalities, pricing and supported parameters', () => {
    const tags = classifyModel({
      id: 'google/gemini-2.0-flash',
      source: 'openrouter',
      metadata: {
        architecture: { input_modalities: ['text', 'image'] },
        pricing: { prompt: '0', completion: '0' },
        supported_parameters: ['tools', 'tool_choice'],
      },
    });
    expect(tags).toContain('视觉');
    expect(tags).toContain('免费');
    expect(tags).toContain('工具');
  });

  it('uses Ollama capabilities and details', () => {
    expect(classifyModel({
      id: 'llava:7b',
      source: 'ollama',
      metadata: { capabilities: ['vision', 'tools'], details: { family: 'llava' } },
    })).toEqual(expect.arrayContaining(['视觉', '工具']));
  });

  it('falls back to name heuristics', () => {
    expect(classifyModel({ id: 'deepseek-r1:8b' })).toContain('推理');
    expect(classifyModel({ id: 'bge-reranker-v2-m3' })).toEqual(['重排']);
    expect(classifyModel({ id: 'nomic-embed-text' })).toContain('嵌入');
    expect(classifyModel({ id: 'qwen2.5-vl:7b' })).toEqual(expect.arrayContaining(['视觉', '工具']));
  });

  it('returns no tags for unknown models', () => {
    expect(classifyModel({ id: 'totally-unknown-model' })).toEqual([]);
  });

  it('returns tags in stable order', () => {
    const tags = classifyModel({ id: 'qwen2.5-vl:7b' });
    expect(tags).toEqual(MODEL_TAGS.filter(tag => tags.includes(tag)));
  });
});

describe('effectiveTags', () => {
  it('manual tags override auto tags', () => {
    expect(effectiveTags({ autoTags: ['推理'], manualTags: ['视觉', '免费'] }))
      .toEqual(['视觉', '免费']);
  });

  it('falls back to auto tags when manual tags are empty', () => {
    expect(effectiveTags({ autoTags: ['推理'], manualTags: [] })).toEqual(['推理']);
  });
});
