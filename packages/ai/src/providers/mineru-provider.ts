import type { OcrResult } from '@sse/shared';
import type { IInvoiceOCRProvider } from '../ports/iocr-provider';
import type { AIProviderConfig } from '../ports/iai-provider';

export const MINERU_PARSER_VERSION = 3;

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
    this.baseUrl = (config.endpoint || 'https://mineru.net')
      .replace(/\/+$/, '')
      .replace(/\/api\/v4$/, '');
    this.token = (config.apiKey || process.env.MINERU_TOKEN || '').trim();
  }

  private authError(): Error {
    return new Error('MinerU 认证失败：Token 无效或已过期，请在系统管理中更新 MinerU Token');
  }

  async parseInvoice(fileBuffer: Buffer, fileName: string): Promise<OcrResult> {
    if (!this.token) {
      throw new Error('MinerU API Token 未配置');
    }

    const { batch_id } = await this.uploadFile(fileBuffer, fileName);
    const markdown = await this.pollResult(batch_id);
    return extractInvoiceDataFromMarkdown(markdown, fileName);
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

    if (res.status === 401 || res.status === 403) {
      throw this.authError();
    }
    if (!res.ok) throw new Error(`MinerU 申请上传链接失败 (${res.status})`);
    const data: any = await res.json();
    if (data.code === 'A0202' || data.code === 'A0211') throw this.authError();
    if (data.code !== 0) throw new Error(`MinerU 错误: ${data.msg}`);

    const batchId = data.data.batch_id;
    const uploadUrl = data.data.file_urls[0];

    const putRes = await fetch(uploadUrl, {
      method: 'PUT',
      body: buffer,
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
      if (data.code === 'A0202' || data.code === 'A0211') throw this.authError();
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

}

export function extractInvoiceDataFromMarkdown(markdown: string, fileName?: string): OcrResult {
  const cleaned = (markdown || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&yen;|&#165;|&#xa5;/gi, '¥')
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCharCode(parseInt(code, 16)))
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'");

  const text = cleaned.replace(/([\u4e00-\u9fa5])\s+(?=[\u4e00-\u9fa5])/g, '$1');
  const flat = text.replace(/[|*#]/g, ' ').replace(/\s+/g, ' ');

  const invoiceNo =
    findFirst(flat, [
      /(?:发票号码|发票代码|Invoice\s*No\.?)[\s:：]*([A-Za-z0-9]{8,30})/i,
    ])
    || lineValue(text, ['发票号码', '发票代码', 'InvoiceNo'])
    || invoiceNumberFromFileName(fileName);

  const invoiceDate = normalizeDate(
    findFirst(flat, [
      /(?:开票日期|Invoice\s*Date)[^0-9]{0,12}(\d{4}\s*[年./-]\s*\d{1,2}\s*[月./-]\s*\d{1,2}\s*日?)/i,
    ])
  );

  let totalAmount = parseNumber(
    findFirst(flat, [
      /(?:价税合计|价税总计)[^0-9]{0,160}?(?:小写)?[^0-9]{0,20}[¥￥]?\s*([\d,]+(?:\.\d{1,2})?)/,
      /[（(]小写[）)][^0-9]{0,10}[¥￥]?\s*([\d,]+(?:\.\d{1,2})?)/,
      /(?:价税合计|价税总计)[^¥￥]{0,120}[¥￥]\s*([\d,]+(?:\.\d{1,2})?)/,
    ])
  );

  const totalsMatch = flat.match(
    /(?:^|\s)合计\s*[¥￥]?\s*([\d,]+(?:\.\d{1,2})?)\s*[¥￥]?\s*([\d,]+(?:\.\d{1,2})?)/
  );

  const amount = totalsMatch
    ? parseNumber(totalsMatch[1])
    : parseNumber(
        findFirst(flat, [
          /(?:金额合计|合计金额)[^0-9]{0,40}[¥￥]?\s*([\d,]+(?:\.\d{1,2})?)/,
          /(?:^|\s)金额[\s:：]*[¥￥]?\s*([\d,]+(?:\.\d{1,2})?)/,
        ])
      );

  const taxAmount = totalsMatch
    ? parseNumber(totalsMatch[2])
    : parseNumber(
        findFirst(flat, [
          /(?:税额|合计税额)[^0-9]{0,30}[¥￥]?\s*([\d,]+(?:\.\d{1,2})?)/,
        ])
      );

  return {
    invoiceNo,
    amount,
    totalAmount,
    invoiceDate,
    sellerName: lineValue(text, ['销方名称', '销售方名称', '销售方', 'SellerName']),
    buyerName: lineValue(text, ['购方名称', '购买方名称', '购买方', 'BuyerName']),
    taxAmount,
    rawText: text.slice(0, 8000),
    parserVersion: MINERU_PARSER_VERSION,
    status: 'verified',
  };
}

function invoiceNumberFromFileName(fileName?: string): string | undefined {
  if (!fileName) return undefined;
  const base = fileName.replace(/\.[^.]+$/, '');
  return base.match(/\d{8,30}/)?.[0];
}

function findFirst(text: string, patterns: RegExp[]): string | undefined {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) return match[1].trim();
  }
  return undefined;
}

function lineValue(text: string, keywords: string[]): string | undefined {
  for (const keyword of keywords) {
    for (const line of text.split('\n')) {
      if (!line.includes(keyword)) continue;
      const after = line.split(keyword)[1] || '';
      const cleaned = after
        .split('|')
        .map((part) => part.replace(/[*#]/g, '').trim())
        .find((part) => part.length > 0);
      if (cleaned) return cleaned;
    }
  }
  return undefined;
}

function parseNumber(value?: string): number | undefined {
  if (!value) return undefined;
  const match = value.match(/-?\d[\d,]*(?:\.\d+)?/);
  if (!match) return undefined;
  const number = Number(match[0].replace(/,/g, ''));
  return Number.isFinite(number) ? number : undefined;
}

function normalizeDate(value?: string): string | undefined {
  if (!value) return undefined;
  const match = value.match(/(\d{4})\D+(\d{1,2})\D+(\d{1,2})/);
  if (!match) return value.trim();
  const pad = (part: string) => part.padStart(2, '0');
  return `${match[1]}-${pad(match[2])}-${pad(match[3])}`;
}
