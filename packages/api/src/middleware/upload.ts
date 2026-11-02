import multer from 'multer';
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
    const ext = file.originalname.split('.').pop()?.toLowerCase();
    if (ext === 'pdf' || ext === 'ofd' || ext === 'png' || ext === 'jpg' || ext === 'jpeg') {
      cb(null, true);
    } else {
      cb(new Error('仅支持 PDF、OFD、PNG、JPG 格式的样例文件'));
    }
  },
});
