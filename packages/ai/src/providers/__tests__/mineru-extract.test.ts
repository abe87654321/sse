import { extractInvoiceDataFromMarkdown } from '../mineru-provider';

describe('extractInvoiceDataFromMarkdown', () => {
  it('extracts amounts from a markdown table with 价税合计 and 小写', () => {
    const markdown = `
| 发票号码 | 25362000000115126055 | 开票日期 | 2025年11月06日 |
| 购买方名称 | 某某公司 | 销售方名称 | 某酒店 |
| 合计 | ¥566.04 | ¥33.96 |
| 价税合计（大写） | 陆佰元整 | （小写）¥600.00 |
`;

    const result = extractInvoiceDataFromMarkdown(markdown);

    expect(result.invoiceNo).toBe('25362000000115126055');
    expect(result.parserVersion).toBe(3);
    expect(result.totalAmount).toBe(600);
    expect(result.amount).toBe(566.04);
    expect(result.taxAmount).toBe(33.96);
    expect(result.invoiceDate).toBe('2025-11-06');
  });

  it('extracts amounts that contain currency symbols and thousands separators', () => {
    const markdown = `
发票号码：12345678
金额：¥1,234.56
税额：￥145.44
价税合计：￥1,400.00
`;

    const result = extractInvoiceDataFromMarkdown(markdown);

    expect(result.amount).toBe(1234.56);
    expect(result.taxAmount).toBe(145.44);
    expect(result.totalAmount).toBe(1400);
  });

  it('ignores HTML table attributes such as colspan when extracting amounts', () => {
    const markdown = `<table><tr><td>发票号码</td><td>26957000000284554466</td></tr>
<tr><td colspan="7">合计</td><td>¥670.80</td><td>¥84.05</td></tr>
<tr><td colspan="3">价税合计(大写)</td><td colspan="4">捌佰伍拾肆元捌角伍分</td><td colspan="3">(小写)¥754.85</td></tr></table>`;

    const result = extractInvoiceDataFromMarkdown(markdown);

    expect(result.invoiceNo).toBe('26957000000284554466');
    expect(result.amount).toBe(670.8);
    expect(result.taxAmount).toBe(84.05);
    expect(result.totalAmount).toBe(754.85);
  });

  it('handles Chinese labels that are split by spaces in the markdown', () => {
    const markdown = `
发 票 号 码: 12345678
合 计 ¥100.00 ¥13.00
价 税 合 计（大写）壹佰壹拾叁元整（小写）¥113.00
`;

    const result = extractInvoiceDataFromMarkdown(markdown);

    expect(result.invoiceNo).toBe('12345678');
    expect(result.amount).toBe(100);
    expect(result.taxAmount).toBe(13);
    expect(result.totalAmount).toBe(113);
  });

  it('falls back to the file name when the invoice number is missing', () => {
    const result = extractInvoiceDataFromMarkdown('开票日期: 2026-11-02', '26957000000284554466.pdf');

    expect(result.invoiceNo).toBe('26957000000284554466');
  });

  it('keeps invoice number and date even when the amount is missing', () => {
    const markdown = '发票号码: 87654321\n开票日期: 2026/08/01\n';

    const result = extractInvoiceDataFromMarkdown(markdown);

    expect(result.invoiceNo).toBe('87654321');
    expect(result.invoiceDate).toBe('2026-08-01');
    expect(result.totalAmount).toBeUndefined();
  });
});

describe('extractInvoiceDataFromMarkdown — bank payment receipts', () => {
  it('extracts the reference number, date and amount from a bank receipt', () => {
    const markdown = `
回单编号：578B5E0088694
交易日期：2026-11-02
付款金额：¥3,650.79
`;

    const result = extractInvoiceDataFromMarkdown(markdown);

    expect(result.invoiceNo).toBe('578B5E0088694');
    expect(result.invoiceDate).toBe('2026-11-02');
    expect(result.totalAmount).toBe(3650.79);
    expect(result.amount).toBe(3650.79);
  });

  it('extracts the amount from a receipt rendered as an HTML table', () => {
    const markdown = `<table><tr><td>回单编号</td><td>578B5E0088694</td></tr>
<tr><td>交易日期</td><td>2026年11月02日</td></tr>
<tr><td>付款金额</td><td>3650.79</td></tr></table>`;

    const result = extractInvoiceDataFromMarkdown(markdown);

    expect(result.invoiceNo).toBe('578B5E0088694');
    expect(result.invoiceDate).toBe('2026-11-02');
    expect(result.totalAmount).toBe(3650.79);
  });

  it('recognises alternative bank receipt amount labels', () => {
    expect(extractInvoiceDataFromMarkdown('交易金额：1234.50').totalAmount).toBe(1234.5);
    expect(extractInvoiceDataFromMarkdown('汇出金额：88.00').totalAmount).toBe(88);
    expect(extractInvoiceDataFromMarkdown('付款金额（小写）¥2,000.00').totalAmount).toBe(2000);
  });

  it('recognises alternative bank receipt date labels', () => {
    expect(extractInvoiceDataFromMarkdown('记账日期 2026-11-03').invoiceDate).toBe('2026-11-03');
    expect(extractInvoiceDataFromMarkdown('回单日期：2026/11/04').invoiceDate).toBe('2026-11-04');
  });

  it('recognises alternative bank receipt reference labels', () => {
    expect(extractInvoiceDataFromMarkdown('流水号：889900112233').invoiceNo).toBe('889900112233');
    expect(extractInvoiceDataFromMarkdown('凭证号：556677889900').invoiceNo).toBe('556677889900');
  });

  it('does not treat a receipt amount as a tax invoice total', () => {
    const markdown = '价税合计：¥100.00\n付款金额：¥90.00\n';

    const result = extractInvoiceDataFromMarkdown(markdown);

    expect(result.totalAmount).toBe(100);
  });
});
