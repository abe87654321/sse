import type { IAIProvider, AIProviderConfig } from '../ports';
import { resolveChatUrl } from '../utils/endpoint';

export class LocalProvider implements IAIProvider {
  private config: AIProviderConfig;
  private chatUrl: string;

  constructor(config: AIProviderConfig) {
    this.config = {
      endpoint: config.endpoint || 'http://localhost:11434',
      modelName: config.modelName || 'llama3.2-vision',
      apiKey: config.apiKey,
      maxTokens: config.maxTokens,
      timeoutMs: config.timeoutMs,
    };
    this.chatUrl = resolveChatUrl(this.config.endpoint);
  }

  async analyzeImage(imageBase64: string, prompt: string, mimeType?: string): Promise<string> {
    return this.callModel(prompt, imageBase64, mimeType);
  }

  async analyzeText(text: string, prompt: string): Promise<string> {
    return this.callModel(`${prompt}\n\n内容：\n${text}`);
  }

  private async callModel(userPrompt: string, imageBase64?: string, mimeType?: string): Promise<string> {
    const messages: any[] = [{ role: 'user', content: userPrompt }];

    if (imageBase64) {
      const mime = mimeType || 'image/jpeg';
      messages[0].content = [
        { type: 'text', text: userPrompt },
        { type: 'image_url', image_url: { url: `data:${mime};base64,${imageBase64}` } },
      ];
    }

    const maxTokens = this.config.maxTokens || 4096;
    const timeoutMs = this.config.timeoutMs ?? 120000;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetch(this.chatUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(this.config.apiKey ? { Authorization: `Bearer ${this.config.apiKey}` } : {}),
        },
        body: JSON.stringify({
          model: this.config.modelName,
          messages,
          temperature: 0.1,
          max_tokens: maxTokens,
        }),
        signal: controller.signal,
      });

      if (!res.ok) {
        const err = await res.text();
        throw new Error(`AI provider error ${res.status}: ${err}`);
      }

      const data: any = await res.json();
      return data.choices?.[0]?.message?.content || '';
    } catch (e: any) {
      if (e?.name === 'AbortError') {
        throw new Error(`AI 请求超时（${Math.round(timeoutMs / 1000)}s），请检查端点与模型是否可用`);
      }
      throw e;
    } finally {
      clearTimeout(timer);
    }
  }
}
