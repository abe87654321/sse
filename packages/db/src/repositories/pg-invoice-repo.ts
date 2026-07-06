import type { Invoice } from '@sse/shared';
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
    ocrResult: row.ocr_result ?? undefined,
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

  async updateOcrResult(id: string, ocrResult: any): Promise<void> {
    await pool.query(
      'UPDATE invoices SET ocr_result = $1 WHERE id = $2',
      [JSON.stringify(ocrResult), id]
    );
  }
}
