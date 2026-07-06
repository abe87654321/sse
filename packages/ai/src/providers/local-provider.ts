import type { IAIProvider, AIProviderConfig } from '../ports';

export class LocalProvider implements IAIProvider {
  private config: AIProviderConfig;

  constructor(config: AIProviderConfig) {
    this.config = {
      endpoint: config.endpoint || 'http://localhost:11434/v1/chat/completions',
      modelName: config.modelName || 'llama3.2-vision',
    };
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

    const res = await fetch(`${this.config.endpoint}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(this.config.apiKey ? { Authorization: `Bearer ${this.config.apiKey}` } : {}),
      },
      body: JSON.stringify({
        model: this.config.modelName,
        messages,
        temperature: 0.1,
        max_tokens: 2000,
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`AI provider error ${res.status}: ${err}`);
    }

    const data: any = await res.json();
    return data.choices?.[0]?.message?.content || '';
  }
}
