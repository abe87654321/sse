import type { IAIProvider, AIProviderConfig } from '../ports';

export class CloudProvider implements IAIProvider {
  private config: AIProviderConfig;

  constructor(config: AIProviderConfig) {
    this.config = {
      endpoint: config.endpoint || 'https://api.openai.com/v1/chat/completions',
      modelName: config.modelName || 'gpt-4o',
      apiKey: config.apiKey || process.env.OPENAI_API_KEY || '',
    };
  }

  async analyzeImage(imageBase64: string, prompt: string): Promise<string> {
    return this.callModel(prompt, imageBase64);
  }

  async analyzeText(text: string, prompt: string): Promise<string> {
    return this.callModel(`${prompt}\n\n内容：\n${text}`);
  }

  private async callModel(userPrompt: string, imageBase64?: string): Promise<string> {
    const messages: any[] = [];

    if (imageBase64) {
      messages.push({
        role: 'user',
        content: [
          { type: 'text', text: userPrompt },
          { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${imageBase64}` } },
        ],
      });
    } else {
      messages.push({ role: 'user', content: userPrompt });
    }

    const res = await fetch(this.config.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.config.apiKey}`,
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
