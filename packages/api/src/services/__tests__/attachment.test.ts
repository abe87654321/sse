import { attachmentHeaders, contentTypeForFile, sendAttachment } from '../attachment';

describe('contentTypeForFile', () => {
  it('maps the supported attachment types', () => {
    expect(contentTypeForFile('receipt.pdf')).toBe('application/pdf');
    expect(contentTypeForFile('receipt.PNG')).toBe('image/png');
    expect(contentTypeForFile('receipt.jpg')).toBe('image/jpeg');
    expect(contentTypeForFile('receipt.jpeg')).toBe('image/jpeg');
  });

  it('falls back to a binary stream for unknown types', () => {
    expect(contentTypeForFile('receipt.bin')).toBe('application/octet-stream');
    expect(contentTypeForFile('')).toBe('application/octet-stream');
  });
});

describe('attachmentHeaders', () => {
  it('encodes a Chinese file name with RFC 5987 and keeps an ASCII fallback', () => {
    const headers = attachmentHeaders('3650.79 回单.pdf', 'application/pdf');

    expect(headers['Content-Type']).toBe('application/pdf');
    expect(headers['Content-Disposition']).toContain("filename*=UTF-8''");
    expect(headers['Content-Disposition']).toContain('%E5%9B%9E%E5%8D%95');
    const fallback = headers['Content-Disposition'].match(/filename="([^"]*)"/)?.[1] ?? '';
    expect(fallback).toMatch(/^[\x20-\x7e]*$/);
  });

  it('keeps a plain ASCII file name readable', () => {
    const headers = attachmentHeaders('receipt.pdf', 'application/pdf');

    expect(headers['Content-Disposition']).toBe("attachment; filename=\"receipt.pdf\"; filename*=UTF-8''receipt.pdf");
  });

  it('strips characters that could inject extra response headers', () => {
    const headers = attachmentHeaders('a"\r\nX-Injected: 1.pdf', 'application/pdf');

    expect(headers['Content-Disposition']).not.toContain('\r');
    expect(headers['Content-Disposition']).not.toContain('\n');
    expect(headers['Content-Disposition']).not.toContain('"X-Injected');
    expect(headers['Content-Disposition'].match(/filename="/g)).toHaveLength(1);
  });
});

describe('sendAttachment', () => {
  it('writes the attachment headers and the file bytes', () => {
    const setHeader = jest.fn();
    const send = jest.fn();
    const res = { setHeader, send } as any;
    const buffer = Buffer.from('pdf-bytes');

    sendAttachment(res, buffer, 'receipt.pdf');

    expect(setHeader).toHaveBeenCalledWith('Content-Type', 'application/pdf');
    expect(setHeader).toHaveBeenCalledWith('Content-Length', buffer.length);
    expect(send).toHaveBeenCalledWith(buffer);
  });
});
