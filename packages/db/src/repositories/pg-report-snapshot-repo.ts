import type {
  ExpenseReport,
  PaymentReceipt,
  ReportSnapshot,
  ReportSnapshotDetail,
} from '@sse/shared';
import type {
  IReportSnapshotRepo,
  SnapshotCaptureInput,
  SnapshotDataItem,
  SnapshotInvoiceInput,
  SnapshotItemInput,
  SnapshotQuery,
} from '@sse/core';
import { buildReportSnapshotPayload } from '@sse/core';
import { pool } from '../connection';
import type { Queryable } from '../transaction';

const SNAPSHOT_COLUMNS = `id, report_id, snapshot_type, schema_version, approval_record_id,
  step, actor_type, actor_id, actor_role, content_hash, legacy, created_at`;

function mapSnapshot(row: any): ReportSnapshot {
  return {
    id: row.id,
    reportId: row.report_id,
    snapshotType: row.snapshot_type,
    schemaVersion: Number(row.schema_version),
    approvalRecordId: row.approval_record_id ?? undefined,
    step: row.step ?? undefined,
    actorType: row.actor_type,
    actorId: row.actor_id ?? undefined,
    actorRole: row.actor_role ?? undefined,
    contentHash: row.content_hash,
    legacy: row.legacy === true,
    createdAt: row.created_at,
  };
}

function mapDetail(row: any): ReportSnapshotDetail {
  return {
    ...mapSnapshot(row),
    payload: row.payload,
    hashValid: row.hash_valid === true,
  };
}

function mapReport(row: any): ExpenseReport {
  return {
    id: row.id,
    serialNo: row.serial_no,
    userId: row.user_id,
    applicantName: row.applicant_name ?? undefined,
    title: row.title,
    totalAmount: Number(row.total_amount),
    status: row.status,
    currentStep: row.current_step,
    submittedAt: row.submitted_at ?? undefined,
    completedAt: row.completed_at ?? undefined,
    description: row.description ?? undefined,
    paidAt: row.paid_at ?? undefined,
    paidBy: row.paid_by ?? undefined,
    paymentRef: row.payment_ref ?? undefined,
    paymentComment: row.payment_comment ?? undefined,
    paymentUpdatedAt: row.payment_updated_at ?? undefined,
    paymentUpdatedBy: row.payment_updated_by ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapItem(row: any): SnapshotItemInput {
  return {
    id: row.id,
    reportId: row.report_id,
    categoryId: row.category_id,
    amount: Number(row.amount),
    expenseDate: row.expense_date,
    description: row.description ?? '',
  };
}

function mapInvoice(row: any): SnapshotInvoiceInput {
  return {
    id: row.invoice_id,
    fileName: row.file_name,
    fileFormat: row.file_format,
    fileSize: Number(row.file_size),
    checksum: row.checksum,
    invoiceNo: row.invoice_no ?? null,
    verificationStatus: row.verification_status ?? 'pending',
    verificationResult: row.verification_result ?? null,
    verifiedAt: row.verified_at ?? null,
    uploadedAt: row.uploaded_at ?? null,
  };
}

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
    verificationStatus: row.verification_status ?? 'pending',
    verificationResult: row.verification_result ?? undefined,
    verifiedAt: row.verified_at ?? undefined,
  };
}

export class PgReportSnapshotRepo implements IReportSnapshotRepo {
  async capture(
    input: SnapshotCaptureInput,
    db: Queryable = pool
  ): Promise<ReportSnapshot> {
    const reportRes = await db.query(
      `SELECT er.*, u.name AS applicant_name, d.name AS applicant_department
         FROM expense_reports er
         JOIN users u ON u.id = er.user_id
         JOIN departments d ON d.id = u.department_id
        WHERE er.id = $1`,
      [input.reportId]
    );
    const reportRow = reportRes.rows[0];
    if (!reportRow) {
      throw new Error(`report not found for snapshot: ${input.reportId}`);
    }

    const itemRes = await db.query(
      `SELECT ei.*, ec.name AS category_name,
              i.id AS invoice_id, i.file_name, i.file_format, i.file_size, i.checksum,
              i.invoice_no, i.verification_status, i.verification_result,
              i.verified_at, i.uploaded_at
         FROM expense_items ei
         JOIN expense_categories ec ON ec.id = ei.category_id
         LEFT JOIN invoices i ON i.item_id = ei.id
        WHERE ei.report_id = $1
        ORDER BY ei.expense_date, ei.id, i.uploaded_at`,
      [input.reportId]
    );

    const recordRes = await db.query(
      `SELECT ar.*, au.name AS approver_name
         FROM approval_records ar
         LEFT JOIN users au ON au.id = ar.approver_id
        WHERE ar.report_id = $1
        ORDER BY ar.step ASC, ar.step_started_at ASC`,
      [input.reportId]
    );

    const receiptRes = await db.query(
      'SELECT * FROM payment_receipts WHERE report_id = $1',
      [input.reportId]
    );

    let paidByName: string | null = null;
    if (reportRow.paid_by) {
      const paidByRes = await db.query('SELECT name FROM users WHERE id = $1', [
        reportRow.paid_by,
      ]);
      paidByName = paidByRes.rows[0]?.name ?? null;
    }

    const itemMap = new Map<string, SnapshotDataItem>();
    for (const row of itemRes.rows) {
      let entry = itemMap.get(row.id);
      if (!entry) {
        entry = {
          item: mapItem(row),
          categoryName: row.category_name ?? null,
          invoices: [],
        };
        itemMap.set(row.id, entry);
      }
      if (row.invoice_id) {
        entry.invoices.push(mapInvoice(row));
      }
    }

    const payload = buildReportSnapshotPayload({
      snapshotType: input.snapshotType,
      report: mapReport(reportRow),
      applicantDepartment: reportRow.applicant_department ?? null,
      items: [...itemMap.values()],
      approvalRecords: recordRes.rows.map((row: any) => ({
        id: row.id,
        step: row.step,
        approverId: row.approver_id,
        approverName: row.approver_name ?? null,
        result: row.result,
        comment: row.comment ?? null,
        stepStartedAt: row.step_started_at,
        approvedAt: row.approved_at,
        verificationAcknowledged: row.verification_acknowledged === true,
      })),
      rule: input.rule ?? null,
      action: input.action ?? null,
      paymentReceipt: receiptRes.rows[0] ? mapReceipt(receiptRes.rows[0]) : null,
      paidByName,
    });

    const { rows } = await db.query(
      `INSERT INTO report_snapshots
         (report_id, snapshot_type, schema_version, approval_record_id, step,
          actor_type, actor_id, actor_role, payload, content_hash, legacy)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb,
               encode(sha256(convert_to(($9::jsonb)::text, 'UTF8')), 'hex'), $10)
       RETURNING ${SNAPSHOT_COLUMNS}`,
      [
        input.reportId,
        input.snapshotType,
        1,
        input.action?.recordId ?? null,
        input.action?.step ?? null,
        input.actor.type,
        input.actor.id ?? null,
        input.actor.role ?? null,
        JSON.stringify(payload),
        false,
      ]
    );

    return mapSnapshot(rows[0]);
  }

  async findByReportId(
    reportId: string,
    db: Queryable = pool
  ): Promise<ReportSnapshot[]> {
    const { rows } = await db.query(
      `SELECT ${SNAPSHOT_COLUMNS}
         FROM report_snapshots
        WHERE report_id = $1
        ORDER BY created_at DESC, id DESC`,
      [reportId]
    );
    return rows.map(mapSnapshot);
  }

  async findDetailById(
    id: string,
    db: Queryable = pool
  ): Promise<ReportSnapshotDetail | null> {
    const { rows } = await db.query(
      `SELECT *, (content_hash = encode(sha256(convert_to(payload::text, 'UTF8')), 'hex')) AS hash_valid
         FROM report_snapshots
        WHERE id = $1`,
      [id]
    );
    return rows.length === 0 ? null : mapDetail(rows[0]);
  }

  async findDetailByReport(
    reportId: string,
    snapshotId: string,
    db: Queryable = pool
  ): Promise<ReportSnapshotDetail | null> {
    const { rows } = await db.query(
      `SELECT *, (content_hash = encode(sha256(convert_to(payload::text, 'UTF8')), 'hex')) AS hash_valid
         FROM report_snapshots
        WHERE id = $1 AND report_id = $2`,
      [snapshotId, reportId]
    );
    return rows.length === 0 ? null : mapDetail(rows[0]);
  }

  async query(
    filter: SnapshotQuery,
    db: Queryable = pool
  ): Promise<{ items: ReportSnapshot[]; total: number }> {
    const conditions: string[] = [];
    const values: any[] = [];
    let idx = 1;

    if (filter.reportId) {
      conditions.push(`report_id = $${idx++}`);
      values.push(filter.reportId);
    }
    if (filter.snapshotType) {
      conditions.push(`snapshot_type = $${idx++}`);
      values.push(filter.snapshotType);
    }
    if (filter.legacy !== undefined) {
      conditions.push(`legacy = $${idx++}`);
      values.push(filter.legacy);
    }
    if (filter.from) {
      conditions.push(`created_at >= $${idx++}`);
      values.push(filter.from);
    }
    if (filter.to) {
      conditions.push(`created_at <= $${idx++}`);
      values.push(filter.to);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const limit = Math.min(Math.max(filter.limit ?? 50, 1), 200);
    const offset = Math.max(filter.offset ?? 0, 0);

    const [countRes, listRes] = await Promise.all([
      db.query(`SELECT COUNT(*)::int AS count FROM report_snapshots ${where}`, values),
      db.query(
        `SELECT ${SNAPSHOT_COLUMNS}
           FROM report_snapshots
          ${where}
          ORDER BY created_at DESC, id DESC
          LIMIT $${idx++} OFFSET $${idx++}`,
        [...values, limit, offset]
      ),
    ]);

    return {
      items: listRes.rows.map(mapSnapshot),
      total: Number(countRes.rows[0]?.count ?? 0),
    };
  }
}
