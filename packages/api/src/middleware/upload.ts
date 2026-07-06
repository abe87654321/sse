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
