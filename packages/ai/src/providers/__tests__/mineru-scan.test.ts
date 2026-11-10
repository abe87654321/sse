import { MinerUProvider } from '../mineru-provider';
import { buildImageOnlyPdf, makeJpeg } from '../../services/__tests__/fixtures';

describe('MinerUProvider — scan-like documents', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('renders and trims a PDF without a text layer before uploading it', async () => {
    const requests: any[] = [];
    global.fetch = jest.fn().mockImplementation(async (url: string, init: any) => {
      requests.push({ url, init });
      if (String(url).includes('file-urls/batch')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            code: 0,
            data: { batch_id: 'batch-1', file_urls: ['https://oss.example/put'] },
          }),
        } as any;
      }
      return { ok: false, status: 500 } as any;
    }) as any;

    const jpeg = makeJpeg(200, 200);
    const pdf = buildImageOnlyPdf(jpeg, 200, 200);
    const provider = new MinerUProvider({ endpoint: 'https://mineru.net', apiKey: 'token' });

    await provider.parseInvoice(pdf, 'scan.pdf').catch(() => undefined);

    const batchRequest = requests.find((r) => String(r.url).includes('file-urls/batch'));
    expect(batchRequest).toBeDefined();
    const body = JSON.parse(batchRequest.init.body);
    // 扫描件没有文本层，应改为上传裁掉白边后的图片
    expect(body.files[0].name).toBe('scan.png');
  }, 30000);

  it('uploads a PDF that has a text layer unchanged', async () => {
    const requests: any[] = [];
    global.fetch = jest.fn().mockImplementation(async (url: string, init: any) => {
      requests.push({ url, init });
      if (String(url).includes('file-urls/batch')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ code: 0, data: { batch_id: 'b', file_urls: ['https://oss.example/put'] } }),
        } as any;
      }
      return { ok: false, status: 500 } as any;
    }) as any;

    const digitalPdf = Buffer.from('%PDF-1.7\n1 0 obj\n<< /Type /Page >>\nendobj\ntrailer\n%%EOF');
    const provider = new MinerUProvider({ endpoint: 'https://mineru.net', apiKey: 'token' });

    await provider.parseInvoice(digitalPdf, 'invoice.pdf').catch(() => undefined);

    const batchRequest = requests.find((r) => String(r.url).includes('file-urls/batch'));
    expect(batchRequest).toBeDefined();
    const body = JSON.parse(batchRequest.init.body);
    expect(body.files[0].name).toBe('invoice.pdf');
  }, 30000);
});
