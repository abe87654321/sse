import type { DuplicateInvoiceRef, Invoice, VerificationStatus } from '@sse/shared';
import type { IInvoiceRepo } from '@sse/core';
import { pool } from '../connection';

function mapInvoice(row: any): Invoice {
  return {
    id: row.id,
    itemId: row.item_id,
    fileName: row.file_name,
    fileFormat: row.file_format,
    fileSize: row.file_size,
    storageKey: row.storage_key,
    storageBucket: row.storage_bucket,
    checksum: row.checksum,
    invoiceNo: row.invoice_no ?? undefined,
    ocrResult: row.ocr_result ?? undefined,
    verificationStatus: row.verification_status ?? 'pending',
    verificationResult: row.verification_result ?? undefined,
    verifiedAt: row.verified_at ?? undefined,
    uploadedAt: row.uploaded_at,
  };
}

export class PgInvoiceRepo implements IInvoiceRepo {
  async findById(id: string): Promise<Invoice | null> {
    const { rows } = await pool.query('SELECT * FROM invoices WHERE id = $1', [id]);
    return rows.length === 0 ? null : mapInvoice(rows[0]);
  }

  async findByItemId(itemId: string): Promise<Invoice | null> {
    const { rows } = await pool.query('SELECT * FROM invoices WHERE item_id = $1', [itemId]);
    return rows.length === 0 ? null : mapInvoice(rows[0]);
  }

  async create(invoice: Omit<Invoice, 'id' | 'uploadedAt'>): Promise<Invoice> {
    const { rows } = await pool.query(
      `INSERT INTO invoices (item_id, file_name, file_format, file_size, storage_key, storage_bucket, checksum, ocr_result)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [
        invoice.itemId,
        invoice.fileName,
        invoice.fileFormat,
        invoice.fileSize,
        invoice.storageKey,
        invoice.storageBucket,
        invoice.checksum,
        invoice.ocrResult ? JSON.stringify(invoice.ocrResult) : null,
      ]
    );
    return mapInvoice(rows[0]);
  }

  async updateOcrResult(id: string, ocrResult: any, invoiceNo?: string): Promise<void> {
    await pool.query(
      `UPDATE invoices
          SET ocr_result = $1, invoice_no = COALESCE($2, invoice_no)
        WHERE id = $3`,
      [JSON.stringify(ocrResult), invoiceNo ?? null, id]
    );
  }

  async updateVerification(id: string, status: VerificationStatus, result: unknown): Promise<void> {
    await pool.query(
      `UPDATE invoices
          SET verification_status = $1, verification_result = $2, verified_at = NOW()
        WHERE id = $3`,
      [status, JSON.stringify(result), id]
    );
  }

  async findDuplicatesByInvoiceNo(invoiceNo: string, excludeInvoiceId: string): Promise<DuplicateInvoiceRef[]> {
    const { rows } = await pool.query(
      `SELECT i.id AS invoice_id, er.id AS report_id, er.serial_no, er.status
         FROM invoices i
         JOIN expense_items ei ON ei.id = i.item_id
         JOIN expense_reports er ON er.id = ei.report_id
        WHERE i.invoice_no = $1
          AND i.id <> $2
        ORDER BY i.uploaded_at DESC
        LIMIT 10`,
      [invoiceNo, excludeInvoiceId]
    );

    return rows.map((row: any) => ({
      invoiceId: row.invoice_id,
      reportId: row.report_id,
      serialNo: row.serial_no,
      status: row.status,
    }));
  }
}
