import { VisionOCRProvider } from '../vision-ocr-provider';
import { buildImageOnlyPdf, makeJpeg } from '../../services/__tests__/fixtures';

describe('VisionOCRProvider', () => {
  it('converts a PDF into a PNG before handing it to the model', async () => {
    const calls: any[] = [];
    const provider = new VisionOCRProvider({
      analyzeImage: async (imageBase64: string, prompt: string, mimeType?: string) => {
        calls.push({ imageBase64, prompt, mimeType });
        return '{"invoice_no":"12345678","total_amount":100}';
      },
    } as any);

    const jpeg = makeJpeg(200, 200);
    const pdf = buildImageOnlyPdf(jpeg, 200, 200);
    const result = await provider.parseInvoice(pdf, 'scan.pdf');

    expect(calls).toHaveLength(1);
    expect(calls[0].mimeType).toBe('image/png');
    // PNG magic bytes
    expect(calls[0].imageBase64.startsWith('iVBORw0KGgo')).toBe(true);
    expect(result.invoiceNo).toBe('12345678');
  }, 30000);

  it('keeps a plain image as an image', async () => {
    const calls: any[] = [];
    const provider = new VisionOCRProvider({
      analyzeImage: async (imageBase64: string, prompt: string, mimeType?: string) => {
        calls.push({ imageBase64, prompt, mimeType });
        return '{"invoice_no":"87654321"}';
      },
    } as any);

    const jpeg = makeJpeg(100, 100);
    await provider.parseInvoice(jpeg, 'receipt.jpg');

    expect(calls).toHaveLength(1);
    expect(calls[0].mimeType).toBe('image/png');
  }, 30000);

  it('reports a clear error for content it cannot turn into an image', async () => {
    const provider = new VisionOCRProvider({
      analyzeImage: async () => '{}',
    } as any);

    await expect(provider.parseInvoice(Buffer.from('not an image'), 'x.bin'))
      .rejects.toThrow(/图片/);
  });

  it('maps the snake_case fields the model returns onto the result shape', async () => {
    const provider = new VisionOCRProvider({
      analyzeImage: async () => JSON.stringify({
        invoice_no: '578B5D0086434',
        amount: '19,999.00',
        tax_amount: null,
        total_amount: '19999.00',
        invoice_date: '2026-11-02',
        seller_name: '王泽昊',
        buyer_name: '深圳市数恒纪元信息技术咨询企业',
      }),
    } as any);

    const result = await provider.parseInvoice(makeJpeg(100, 100), 'receipt.jpg');

    expect(result.invoiceNo).toBe('578B5D0086434');
    expect(result.amount).toBe(19999);
    expect(result.totalAmount).toBe(19999);
    expect(result.taxAmount).toBeUndefined();
    expect(result.invoiceDate).toBe('2026-11-02');
    expect(result.sellerName).toBe('王泽昊');
    expect(result.buyerName).toBe('深圳市数恒纪元信息技术咨询企业');
  }, 30000);
});
