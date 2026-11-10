import type { Response } from 'express';

const CONTENT_TYPES: Record<string, string> = {
  pdf: 'application/pdf',
  ofd: 'application/ofd',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  txt: 'text/plain',
  csv: 'text/csv',
};

export function contentTypeForFile(fileName?: string): string {
  const ext = (fileName || '').split('.').pop()?.toLowerCase() || '';
  return CONTENT_TYPES[ext] || 'application/octet-stream';
}

function encodeRfc5987(value: string): string {
  return encodeURIComponent(value).replace(
    /['()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

export function attachmentHeaders(fileName?: string, contentType?: string): Record<string, string> {
  const safeName = (fileName || 'download').replace(/[\r\n"\\]/g, '');
  const asciiFallback = safeName.replace(/[^\x20-\x7e]/g, '_');
  return {
    'Content-Type': contentType || contentTypeForFile(safeName),
    'Content-Disposition': `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encodeRfc5987(safeName)}`,
    'Cache-Control': 'private, no-store',
  };
}

export function sendAttachment(res: Response, buffer: Buffer, fileName?: string): void {
  const headers = attachmentHeaders(fileName);
  res.setHeader('Content-Type', headers['Content-Type']);
  res.setHeader('Content-Disposition', headers['Content-Disposition']);
  res.setHeader('Cache-Control', headers['Cache-Control']);
  res.setHeader('Content-Length', buffer.length);
  res.send(buffer);
}
