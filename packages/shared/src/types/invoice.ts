export type OcrResult = {
  invoiceNo?: string;
  amount?: number;
  taxAmount?: number;
  totalAmount?: number;
  invoiceDate?: Date;
  sellerName?: string;
  buyerName?: string;
  status: string;
};

export type Invoice = {
  id: string;
  itemId: string;
  fileName: string;
  fileFormat: string;
  fileSize: number;
  storageKey: string;
  storageBucket: string;
  checksum: string;
  ocrResult?: OcrResult;
  uploadedAt: Date;
};
