import type { OcrResult } from '@sse/shared';
import type { IInvoiceOCRProvider } from '../ports/iocr-provider';
import type { AIProviderConfig } from '../ports/iai-provider';

interface MinerUTask {
  task_id: string;
  state: string;
  full_zip_url?: string;
  err_msg?: string;
}

export class MinerUProvider implements IInvoiceOCRProvider {
  private baseUrl: string;
  private token: string;

  constructor(config: AIProviderConfig) {
    this.baseUrl = config.endpoint || 'https://mineru.net';
    this.token = config.apiKey || process.env.MINERU_TOKEN || '';
  }

  async parseInvoice(fileBuffer: Buffer, fileName: string, fileUrl?: string): Promise<OcrResult> {
    if (!fileUrl) {
      return { status: 'unverified' };
    }

    if (!this.token) {
      throw new Error('MinerU API Token 未配置，请在管理后台或环境变量 MINERU_TOKEN 中设置');
    }

    const taskId = await this.submitTask(fileUrl, fileName);
    const result = await this.pollTask(taskId);
    const markdown = await this.downloadMarkdown(result);

    return this.extractInvoiceData(markdown);
  }

  private async submitTask(fileUrl: string, fileName: string): Promise<string> {
    const res = await fetch(`${this.baseUrl}/api/v4/extract/task`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.token}`,
      },
      body: JSON.stringify({
        url: fileUrl,
        model_version: 'vlm',
        is_ocr: false,
        language: 'ch',
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`MinerU 提交失败 (${res.status}): ${err}`);
    }

    const data: any = await res.json();
    if (data.code !== 0) throw new Error(`MinerU 错误: ${data.msg}`);
    return data.data.task_id;
  }

  private async pollTask(taskId: string, timeoutMs: number = 120000): Promise<MinerUTask> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const res = await fetch(`${this.baseUrl}/api/v4/extract/task/${taskId}`, {
        headers: { Authorization: `Bearer ${this.token}` },
      });
      const data: any = await res.json();
      if (data.code !== 0) throw new Error(`MinerU 查询错误: ${data.msg}`);

      const task = data.data as MinerUTask;
      if (task.state === 'done') return task;
      if (task.state === 'failed') throw new Error(`MinerU 解析失败: ${task.err_msg}`);

      await new Promise(r => setTimeout(r, 2000));
    }
    throw new Error('MinerU 解析超时');
  }

  private async downloadMarkdown(task: MinerUTask): Promise<string> {
    if (!task.full_zip_url) throw new Error('MinerU 结果链接为空');

    const res = await fetch(task.full_zip_url);
    if (!res.ok) throw new Error(`MinerU 下载失败 (${res.status})`);

    const buffer = Buffer.from(await res.arrayBuffer());
    try {
      const JSZip = require('jszip');
      const zip = await JSZip.loadAsync(buffer);
      const mdFile = zip.file('full.md') || zip.file(/\.md$/);
      if (mdFile) return mdFile.async('string');
    } catch { /* fallback: assume raw markdown */ }

    return buffer.toString('utf-8');
  }

  private extractInvoiceData(markdown: string): OcrResult {
    const text = markdown || '';
    const getVal = (keywords: string[]): string | undefined => {
      for (const kw of keywords) {
        for (const line of text.split('\n')) {
          if (line.includes(kw)) {
            const match = line.match(/[\d.]+/);
            return match ? match[0] : line.split(kw)[1]?.trim();
          }
        }
      }
      return undefined;
    };

    return {
      invoiceNo: getVal(['发票号码', '发票代码', 'InvoiceNo']),
      amount: parseOrUndef(getVal(['金额', '合计金额', 'Amount'])),
      totalAmount: parseOrUndef(getVal(['价税合计', 'TotalAmount'])),
      invoiceDate: getVal(['开票日期', 'InvoiceDate']),
      sellerName: getVal(['销方名称', '销售方', 'SellerName']),
      buyerName: getVal(['购方名称', '购买方', 'BuyerName']),
      taxAmount: parseOrUndef(getVal(['税额', 'TaxAmount'])),
      status: 'verified',
    };
  }
}

function parseOrUndef(val?: string): number | undefined {
  if (!val) return undefined;
  const n = parseFloat(val);
  return isNaN(n) ? undefined : n;
}
