import type { IAIProvider, ISmartFillEngine, ParsedExpenseItem } from '../ports';
import { buildFillPrompt } from '../prompts';

export class SmartFillEngine implements ISmartFillEngine {
  constructor(private provider: IAIProvider) {}

  async parseFromImage(imageBase64: string): Promise<ParsedExpenseItem[]> {
    const prompt = buildFillPrompt();
    const result = await this.provider.analyzeImage(imageBase64, prompt);
    return this.parseResult(result);
  }

  async parseFromText(text: string): Promise<ParsedExpenseItem[]> {
    const prompt = buildFillPrompt();
    const result = await this.provider.analyzeText(text, prompt);
    return this.parseResult(result);
  }

  private parseResult(raw: string): ParsedExpenseItem[] {
    try {
      const jsonMatch = raw.match(/\[[\s\S]*\]/);
      if (!jsonMatch) return [];
      const items = JSON.parse(jsonMatch[0]);
      if (!Array.isArray(items)) return [];
      return items.map((item: any) => ({
        categoryName: item.categoryName || '其他',
        amount: Number(item.amount) || 0,
        expenseDate: item.expenseDate || new Date().toISOString().slice(0, 10),
        description: item.description || '',
      }));
    } catch {
      return [];
    }
  }
}
