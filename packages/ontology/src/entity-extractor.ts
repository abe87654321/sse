import { LocalProvider } from '@sse/ai';
import type { ExpenseExtraction } from './types';

export interface GraphExtraction {
  entities: Array<{ uri: string; type: string; properties: Record<string, string> }>;
  relations: Array<{ from: string; to: string; predicate: string }>;
}

export class EntityExtractor {
  private provider: LocalProvider;

  constructor(endpoint: string, model: string) {
    this.provider = new LocalProvider({ endpoint, modelName: model });
  }

  async analyzeText(text: string, prompt: string): Promise<string> {
    return this.provider.analyzeText(text, prompt);
  }

  async extractFromText(text: string): Promise<ExpenseExtraction> {
    const prompt = `你是一个报销信息提取助手。从以下自然语言中提取报销相关信息，以JSON格式返回。
不要添加JSON之外的任何内容。

输入: "${text}"

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
    } catch { /* fall through */ }
    return {};
  }

  async extractFromInvoice(ocrText: string): Promise<ExpenseExtraction> {
    const prompt = `你是一个发票信息提取助手。从以下发票OCR识别结果中提取报销信息，以JSON格式返回。

OCR结果: "${ocrText}"

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
    } catch { /* fall through */ }
    return {};
  }

  async extractGraph(text: string): Promise<GraphExtraction> {
    const prompt = `你是一个知识图谱提取助手。从以下自然语言描述中提取本体实体和关系，以JSON格式返回。
不要添加JSON之外的任何内容。

本体类型可用: Person, Department, Company, Report, DraftReport, PendingReport, ApprovedReport, ExpenseItem, Invoice, ApprovalRule, Approver

可用关系: belongsTo, submittedBy, containsItem, hasInvoice, approvedBy, governedBy, partOf, manages

输入: "${text}"

返回格式:
{
  "entities": [
    { "uri": "简短英文ID", "type": "类型名", "properties": { "属性名": "属性值", ... } }
  ],
  "relations": [
    { "from": "来源实体URI", "to": "目标实体URI", "predicate": "关系名" }
  ]
}

注意:
1. uri 使用简短英文ID（如 person/alice, report/RE001, item/001）
2. 每个实体至少要有 type 和一个识别属性
3. 关系必须连接两个已有实体的 uri
4. 如果描述提到了组织或部门也要提取`;

    let result: string;
    try {
      result = await this.provider.analyzeText(text, prompt);
    } catch (err: any) {
      throw new Error(`AI 模型调用失败: ${err.message || '请检查 Ollama 服务是否启动，以及 ai-config.json 中的端点配置是否正确'}`);
    }

    try {
      const jsonMatch = result.match(/\{[\s\S]*\}/);
      if (jsonMatch) return JSON.parse(jsonMatch[0]);
    } catch { /* fall through */ }

    throw new Error(`AI 返回格式异常，未能提取到有效 JSON: ${result.substring(0, 200)}`);
  }
}
