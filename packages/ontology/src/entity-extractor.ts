import { LocalProvider } from '@sse/ai';
import type { ExpenseExtraction } from './types';

export class EntityExtractor {
  private provider: LocalProvider;

  constructor(endpoint: string, model: string) {
    this.provider = new LocalProvider({ endpoint, modelName: model });
  }

  async extractFromText(text: string): Promise<ExpenseExtraction> {
    const prompt = `你是一个报销信息提取助手。从以下自然语言中提取报销相关信息，以JSON格式返回。不要添加JSON之外的任何内容。

返回格式:
{
  "person": {"name": "姓名", "phone": "手机号(如有)"},
  "amount": 金额数字,
  "category": "费用类别(差旅费/住宿费/交通费/餐饮费/办公费/招待费/通讯费/培训费/其他)",
  "description": "费用描述",
  "date": "日期(YYYY-MM-DD, 如有)"
}

如果无法提取某个字段，设该字段为null。`;

    const result = await this.provider.analyzeText(text, prompt);
    try {
      const jsonMatch = result.match(/\{[\s\S]*\}/);
      if (jsonMatch) return JSON.parse(jsonMatch[0]);
    } catch {}
    return {};
  }

  async extractFromInvoice(ocrText: string): Promise<ExpenseExtraction> {
    const prompt = `你是一个发票信息提取助手。从以下发票OCR识别结果中提取报销信息，以JSON格式返回。

返回格式:
{
  "amount": 发票金额,
  "category": "费用类别",
  "description": "发票内容",
  "date": "发票日期(YYYY-MM-DD)"
}`;
    const result = await this.provider.analyzeText(ocrText, prompt);
    try {
      const jsonMatch = result.match(/\{[\s\S]*\}/);
      if (jsonMatch) return JSON.parse(jsonMatch[0]);
    } catch {}
    return {};
  }
}
