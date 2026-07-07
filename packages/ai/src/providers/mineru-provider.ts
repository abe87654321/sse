import type { OcrResult } from '@sse/shared';
import type { IInvoiceOCRProvider } from '../ports/iocr-provider';
import type { AIProviderConfig } from '../ports/iai-provider';

interface FileUrlEntry {
  file_name: string;
  file_url: string;
  batch_id: string;
  task_id: string;
}

export class MinerUProvider implements IInvoiceOCRProvider {
  private baseUrl: string;
  private token: string;

  constructor(config: AIProviderConfig) {
    this.baseUrl = config.endpoint || 'https://mineru.net';
    this.token = config.apiKey || process.env.MINERU_TOKEN || '';
  }

  async parseInvoice(fileBuffer: Buffer, fileName: string): Promise<OcrResult> {
    if (!this.token) {
      throw new Error('MinerU API Token 未配置');
    }

    const { batch_id, task_id } = await this.uploadFile(fileBuffer, fileName);
    const markdown = await this.pollResult(batch_id);
    return this.extractInvoiceData(markdown);
  }

  private async uploadFile(buffer: Buffer, fileName: string): Promise<FileUrlEntry> {
    const res = await fetch(`${this.baseUrl}/api/v4/file-urls/batch`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.token}`,
      },
      body: JSON.stringify({
        files: [{ name: fileName, is_ocr: false }],
        model_version: 'vlm',
        language: 'ch',
        enable_table: true,
      }),
    });

    if (!res.ok) throw new Error(`MinerU 申请上传链接失败 (${res.status})`);
    const data: any = await res.json();
    if (data.code !== 0) throw new Error(`MinerU 错误: ${data.msg}`);

    const batchId = data.data.batch_id;
    const uploadUrl = data.data.file_urls[0];

    const putRes = await fetch(uploadUrl, {
      method: 'PUT',
      body: buffer,
      headers: { 'Content-Type': 'application/octet-stream' },
    });

    if (!putRes.ok) throw new Error(`MinerU 文件上传失败 (${putRes.status})`);

    return { file_name: fileName, file_url: uploadUrl, batch_id: batchId, task_id: '' };
  }

  private async pollResult(batchId: string, timeoutMs: number = 120000): Promise<string> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      await new Promise(r => setTimeout(r, 3000));

      const res = await fetch(`${this.baseUrl}/api/v4/extract-results/batch/${batchId}`, {
        headers: { Authorization: `Bearer ${this.token}` },
      });

      if (!res.ok) continue;
      const data: any = await res.json();
      if (data.code !== 0) continue;

      const results = data.data.extract_result || [];
      for (const r of results) {
        if (r.state === 'done' && r.full_zip_url) {
          return this.downloadMarkdown(r.full_zip_url);
        }
        if (r.state === 'failed') {
          throw new Error(`MinerU 解析失败: ${r.err_msg}`);
        }
      }
    }
    throw new Error('MinerU 解析超时');
  }

  private async downloadMarkdown(zipUrl: string): Promise<string> {
    const res = await fetch(zipUrl);
    if (!res.ok) throw new Error(`MinerU 下载结果失败 (${res.status})`);

    const buffer = Buffer.from(await res.arrayBuffer());
    try {
      const JSZip = require('jszip');
      const zip = await JSZip.loadAsync(buffer);
      const mdFile = zip.file('full.md') || Object.values(zip.files).find((f: any) => f.name.endsWith('.md'));
      if (mdFile) return await (mdFile as any).async('string');
    } catch { /* fallback */ }

    return buffer.toString('utf-8');
  }

  private extractInvoiceData(markdown: string): OcrResult {
    const text = markdown || '';
    const getVal = (keywords: string[]): string | undefined => {
      for (const kw of keywords) {
        for (const line of text.split('\n')) {
          if (line.includes(kw)) {
            const after = line.split(kw)[1]?.trim();
            if (after) return after.replace(/[*#|]/g, '').trim();
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
