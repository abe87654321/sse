import type { PaymentReceiptVerification } from '@sse/shared';
import { shouldReOcr, verifyPaymentReceipt } from '@sse/core';
import { MINERU_PARSER_VERSION } from '@sse/ai';
import {
  PgExpenseRepo,
  PgPaymentReceiptRepo,
  PgVerificationHistoryRepo,
  pool,
  withTransaction,
} from '@sse/db';
import { createOCREngine } from './ai-engines';
import { MinioStorage } from '../storage/minio-storage';

const receiptRepo = new PgPaymentReceiptRepo();
const expenseRepo = new PgExpenseRepo();
let historyRepo: PgVerificationHistoryRepo | undefined;
function getHistoryRepo(): PgVerificationHistoryRepo {
  if (!historyRepo) historyRepo = new PgVerificationHistoryRepo();
  return historyRepo;
}
const minio = new MinioStorage();

export type ReceiptVerificationContext = {
  actor?: { type: 'user' | 'system'; id?: string | null; role?: string | null };
  cause?: 'manual' | 'force_ocr' | 'system';
};

export function queuePaymentReceiptVerification(receiptId: string): void {
  setImmediate(() => {
    runPaymentReceiptVerification(receiptId, false, {
      actor: { type: 'system' },
      cause: 'system',
    }).catch((err) => {
      console.error(`[PaymentReceipt] 异步核对失败 ${receiptId}:`, err);
    });
  });
}

export async function runPaymentReceiptVerification(
  receiptId: string,
  forceOcr = false,
  context: ReceiptVerificationContext = {}
): Promise<PaymentReceiptVerification | null> {
  const receipt = await receiptRepo.findById(receiptId);
  if (!receipt) return null;

  const report = await expenseRepo.findById(receipt.reportId);
  if (!report) throw new Error('报销单不存在');

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

  return withTransaction(pool, async (client) => {
    const { rows: locked } = await client.query(
      'SELECT * FROM payment_receipts WHERE id = $1 FOR UPDATE',
      [receiptId]
    );
    if (locked.length === 0) return null;
    const lockedReceipt = locked[0];

    const effectiveOcr =
      lockedReceipt.checksum === receipt.checksum ? ocr : (lockedReceipt.ocr_result ?? null);
    const duplicates = await receiptRepo.findByChecksum(
      lockedReceipt.checksum,
      lockedReceipt.id
    );
    const result = verifyPaymentReceipt({
      reportTotal: report.totalAmount,
      paidAt: report.paidAt ?? null,
      ocrResult: effectiveOcr,
      ocrError: lockedReceipt.checksum === receipt.checksum ? ocrError : undefined,
      duplicateReceipts: duplicates,
    });

    await receiptRepo.updateVerification(
      lockedReceipt.id,
      result.status,
      result,
      effectiveOcr,
      client
    );

    const historyStatus = result.status === 'pending' ? 'unverified' : result.status;
    await getHistoryRepo().recordRun(
      {
        reportId: receipt.reportId,
        kind: 'payment_receipt',
        eventType: 'verify',
        cause: context.cause ?? (forceOcr ? 'force_ocr' : 'manual'),
        actor: context.actor ?? { type: 'system' },
        status: historyStatus,
        summary: {
          status: historyStatus,
          checkedAt: result.checkedAt,
          summary: result.summary,
          checks: result.checks,
        },
        checkedAt: result.checkedAt,
        items: [
          {
            subjectId: lockedReceipt.id,
            itemId: null,
            fileName: lockedReceipt.file_name,
            status: historyStatus,
            result,
          },
        ],
      },
      client
    );

    return result;
  });
}

export async function processPendingPaymentReceipts(limit = 5): Promise<void> {
  const pending = await receiptRepo.findPending(limit);
  for (const receipt of pending) {
    try {
      await runPaymentReceiptVerification(receipt.id, false, {
        actor: { type: 'system' },
        cause: 'system',
      });
    } catch (err) {
      console.error(`[PaymentReceipt] 处理待核对回单失败 ${receipt.id}:`, err);
    }
  }
}
