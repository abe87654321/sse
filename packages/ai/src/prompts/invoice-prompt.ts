export const INVOICE_OCR_PROMPT = `你是一个专业的发票识别助手。请从图片中提取发票信息，以 JSON 格式返回。

需要提取的字段：
- invoice_no: 发票号码
- amount: 不含税金额（数字）
- tax_amount: 税额（数字）
- total_amount: 价税合计（数字）
- invoice_date: 开票日期 (YYYY-MM-DD)
- seller_name: 销方名称
- buyer_name: 购方名称

如果某个字段无法识别，值设为 null。

只返回 JSON，不要加任何解释。`;

export function buildInvoicePrompt(): string {
  return INVOICE_OCR_PROMPT;
}
