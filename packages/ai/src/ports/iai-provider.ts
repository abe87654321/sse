import type { ExpenseItem } from '@sse/shared';
import type { OcrResult } from '@sse/shared';

export interface AIProviderConfig {
  endpoint: string;
  modelName?: string;
  apiKey?: string;
  maxTokens?: number;
}

export interface IAIProvider {
  analyzeImage(imageBase64: string, prompt: string, mimeType?: string): Promise<string>;
  analyzeText(text: string, prompt: string): Promise<string>;
}

export interface ParsedExpenseItem {
  categoryName: string;
  amount: number;
  expenseDate: string;
  description: string;
}

export interface IInvoiceOCREngine {
  parseInvoice(fileBuffer: Buffer, fileName: string): Promise<OcrResult>;
}

export interface ISmartFillEngine {
  parseFromImage(imageBase64: string): Promise<ParsedExpenseItem[]>;
  parseFromText(text: string): Promise<ParsedExpenseItem[]>;
}
