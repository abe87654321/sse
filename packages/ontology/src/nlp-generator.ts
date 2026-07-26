import { LocalProvider } from '@sse/ai';

export class NlpGenerator {
  private provider: LocalProvider;

  constructor(endpoint: string, model: string) {
    this.provider = new LocalProvider({ endpoint, modelName: model });
  }

  async generateExplanation(reportId: string, serialNo: string, title: string, amount: number, submitter: string, approver?: string): Promise<string> {
    const dataText = `报销单: ${serialNo}
标题: ${title}
金额: ¥${amount}
提交人: ${submitter}
审批人: ${approver || '待分配'}`;
    const prompt = '你是报销系统的通知助手。用简洁的中文描述以上报销单。给出一句话描述（不超过60字）：';
    const result = await this.provider.analyzeText(dataText, prompt);
    return result.trim();
  }
}
