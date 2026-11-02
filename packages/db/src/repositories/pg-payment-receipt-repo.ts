import type {
  PaymentDuplicateReceiptRef,
  PaymentReceipt,
  PaymentReceiptStatus,
  PaymentReceiptVerification,
} from '@sse/shared';
import { pool } from '../connection';

export type UpsertPaymentReceiptInput = {
  reportId: string;
  fileName: string;
  fileFormat: string;
  fileSize: number;
  storageKey: string;
  storageBucket: string;
  checksum: string;
  uploadedBy?: string;
};

function mapReceipt(row: any): PaymentReceipt {
  return {
    id: row.id,
    reportId: row.report_id,
    fileName: row.file_name,
    fileFormat: row.file_format,
    fileSize: Number(row.file_size),
    storageKey: row.storage_key,
    storageBucket: row.storage_bucket,
    checksum: row.checksum,
    uploadedBy: row.uploaded_by ?? undefined,
    uploadedAt: row.uploaded_at,
    ocrResult: row.ocr_result ?? undefined,
    verificationStatus: (row.verification_status ?? 'pending') as PaymentReceiptStatus,
    verificationResult: row.verification_result ?? undefined,
    verifiedAt: row.verified_at ?? undefined,
  };
}

export class PgPaymentReceiptRepo {
  async findById(id: string): Promise<PaymentReceipt | null> {
    const { rows } = await pool.query('SELECT * FROM payment_receipts WHERE id = $1', [id]);
    return rows.length === 0 ? null : mapReceipt(rows[0]);
  }

  async findByReportId(reportId: string): Promise<PaymentReceipt | null> {
    const { rows } = await pool.query('SELECT * FROM payment_receipts WHERE report_id = $1', [reportId]);
    return rows.length === 0 ? null : mapReceipt(rows[0]);
  }

  async findByChecksum(checksum: string, excludeId?: string): Promise<PaymentDuplicateReceiptRef[]> {
    const { rows } = await pool.query(
      `SELECT pr.id AS receipt_id, pr.report_id, er.serial_no, er.status AS report_status
         FROM payment_receipts pr
         JOIN expense_reports er ON er.id = pr.report_id
        WHERE pr.checksum = $1
          AND ($2::uuid IS NULL OR pr.id <> $2)
        ORDER BY pr.uploaded_at DESC
        LIMIT 10`,
      [checksum, excludeId ?? null]
    );
    return rows.map((row: any) => ({
      receiptId: row.receipt_id,
      reportId: row.report_id,
      serialNo: row.serial_no,
      status: row.report_status,
    }));
  }

  async upsert(input: UpsertPaymentReceiptInput): Promise<PaymentReceipt> {
    const { rows } = await pool.query(
      `INSERT INTO payment_receipts
         (report_id, file_name, file_format, file_size, storage_key, storage_bucket, checksum, uploaded_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (report_id) DO UPDATE SET
         file_name = EXCLUDED.file_name,
         file_format = EXCLUDED.file_format,
         file_size = EXCLUDED.file_size,
         storage_key = EXCLUDED.storage_key,
         storage_bucket = EXCLUDED.storage_bucket,
         checksum = EXCLUDED.checksum,
         uploaded_by = EXCLUDED.uploaded_by,
         uploaded_at = NOW(),
         ocr_result = NULL,
         verification_status = 'pending',
         verification_result = NULL,
         verified_at = NULL
       RETURNING *`,
      [
        input.reportId,
        input.fileName,
        input.fileFormat,
        input.fileSize,
        input.storageKey,
        input.storageBucket,
        input.checksum,
        input.uploadedBy ?? null,
      ]
    );
    return mapReceipt(rows[0]);
  }

  async findPending(limit = 5): Promise<PaymentReceipt[]> {
    const { rows } = await pool.query(
      `SELECT * FROM payment_receipts
        WHERE verification_status = 'pending'
        ORDER BY uploaded_at ASC
        LIMIT $1`,
      [limit]
    );
    return rows.map(mapReceipt);
  }

  async updateVerification(
    id: string,
    status: PaymentReceiptStatus,
    result: PaymentReceiptVerification,
    ocrResult?: unknown
  ): Promise<void> {
    await pool.query(
      `UPDATE payment_receipts
          SET verification_status = $1,
              verification_result = $2,
              ocr_result = $3,
              verified_at = NOW()
        WHERE id = $4`,
      [status, JSON.stringify(result), ocrResult ? JSON.stringify(ocrResult) : null, id]
    );
  }
}
