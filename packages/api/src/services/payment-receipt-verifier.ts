import type { PaymentReceiptVerification } from '@sse/shared';
import { shouldReOcr, verifyPaymentReceipt } from '@sse/core';
import { MINERU_PARSER_VERSION } from '@sse/ai';
import { PgExpenseRepo, PgPaymentReceiptRepo } from '@sse/db';
import { createOCREngine } from './ai-engines';
import { MinioStorage } from '../storage/minio-storage';

const receiptRepo = new PgPaymentReceiptRepo();
const expenseRepo = new PgExpenseRepo();
const minio = new MinioStorage();

export function queuePaymentReceiptVerification(receiptId: string): void {
  setImmediate(() => {
    runPaymentReceiptVerification(receiptId).catch((err) => {
      console.error(`[PaymentReceipt] 异步核对失败 ${receiptId}:`, err);
    });
  });
}

export async function runPaymentReceiptVerification(
  receiptId: string,
  forceOcr = false
): Promise<PaymentReceiptVerification | null> {
  const receipt = await receiptRepo.findById(receiptId);
  if (!receipt) return null;

  const report = await expenseRepo.findById(receipt.reportId);
  if (!report) throw new Error('报销单不存在');

  const duplicates = await receiptRepo.findByChecksum(receipt.checksum, receipt.id);

  let ocr = receipt.ocrResult ?? null;
  let ocrError: string | undefined;

  if (shouldReOcr(ocr, forceOcr, MINERU_PARSER_VERSION)) {
    const engine = createOCREngine();
    if (!engine) {
      ocr = null;
      ocrError = '发票 OCR 引擎未启用';
    } else {
      try {
        const buffer = await minio.getObject(receipt.storageKey, receipt.storageBucket);
        ocr = await engine.parseInvoice(buffer, receipt.fileName);
      } catch (err: any) {
        ocr = null;
        ocrError = err?.message || '回单识别失败';
      }
    }
  }

  const result = verifyPaymentReceipt({
    reportTotal: report.totalAmount,
    paidAt: report.paidAt ?? null,
    ocrResult: ocr,
    ocrError,
    duplicateReceipts: duplicates,
  });

  await receiptRepo.updateVerification(receipt.id, result.status, result, ocr);
  return result;
}

export async function processPendingPaymentReceipts(limit = 5): Promise<void> {
  const pending = await receiptRepo.findPending(limit);
  for (const receipt of pending) {
    try {
      await runPaymentReceiptVerification(receipt.id);
    } catch (err) {
      console.error(`[PaymentReceipt] 处理待核对回单失败 ${receipt.id}:`, err);
    }
  }
}
