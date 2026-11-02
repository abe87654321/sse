import multer from 'multer';
import type { Request, Response, NextFunction } from 'express';
import { InvoiceFormat } from '@sse/shared';

const storage = multer.memoryStorage();

export const uploadInvoice = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ext = file.originalname.split('.').pop()?.toLowerCase();
    if (ext === InvoiceFormat.PDF || ext === InvoiceFormat.OFD) {
      cb(null, true);
    } else {
      cb(new Error('仅支持 PDF 和 OFD 格式的发票文件'));
    }
  },
});

export const uploadAvatar = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ext = file.originalname.split('.').pop()?.toLowerCase();
    if (ext === 'png' || ext === 'jpg' || ext === 'jpeg') {
      cb(null, true);
    } else {
      cb(new Error('仅支持 PNG 和 JPG 格式的图片'));
    }
  },
});

export const uploadPaymentReceipt = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ext = file.originalname.split('.').pop()?.toLowerCase();
    if (ext === 'pdf' || ext === 'png' || ext === 'jpg' || ext === 'jpeg') {
      cb(null, true);
    } else {
      cb(new Error('仅支持 PDF、PNG、JPG 格式的打款回单'));
    }
  },
});

export const uploadEngineSample = multer({
  storage,
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const dot = file.originalname.lastIndexOf('.');
    const ext = dot >= 0 ? file.originalname.slice(dot + 1).toLowerCase() : '';
    if (ext === 'pdf' || ext === 'ofd' || ext === 'png' || ext === 'jpg' || ext === 'jpeg') {
      cb(null, true);
    } else {
      const error: any = new Error('仅支持 PDF、OFD、PNG、JPG 格式的样例文件');
      error.status = 400;
      error.code = 'INVALID_FILE_TYPE';
      cb(error);
    }
  },
});

export function uploadErrorHandler(
  err: any,
  _req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (err?.code === 'LIMIT_FILE_SIZE') {
    res.status(413).json({
      error: { code: 'FILE_TOO_LARGE', message: '样例文件不能超过 20MB' },
    });
    return;
  }
  if (typeof err?.code === 'string' && err.code.startsWith('LIMIT_')) {
    res.status(400).json({ error: { code: err.code, message: '上传文件不符合要求' } });
    return;
  }
  next(err);
}

export function hasValidSampleSignature(buffer: Buffer, ext: string): boolean {
  const normalized = String(ext || '').toLowerCase();
  if (normalized === 'pdf') return buffer.subarray(0, 1024).includes(Buffer.from('%PDF-'));
  if (normalized === 'png') {
    return buffer.length >= 8
      && buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47
      && buffer[4] === 0x0d && buffer[5] === 0x0a && buffer[6] === 0x1a && buffer[7] === 0x0a;
  }
  if (normalized === 'jpg' || normalized === 'jpeg') {
    return buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  }
  if (normalized === 'ofd') {
    return buffer.length >= 4
      && buffer[0] === 0x50 && buffer[1] === 0x4b;
  }
  return false;
}
