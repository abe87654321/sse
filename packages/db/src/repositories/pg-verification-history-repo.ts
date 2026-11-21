import { randomUUID } from 'crypto';
import type {
  VerificationHistoryResponse,
  VerificationRun,
  VerificationRunItem,
} from '@sse/shared';
import type {
  InvalidateInvoiceReportInput,
  InvalidateReceiptInput,
  IVerificationHistoryRepo,
  RecordVerificationRunInput,
  VerificationHistoryQuery,
} from '@sse/core';
import { pool } from '../connection';
import type { Queryable } from '../transaction';

const RUN_COLUMNS = `id, report_id, kind, event_type, cause, reason, actor_type, actor_id,
  actor_role, status, summary, content_hash, legacy, checked_at, created_at`;
const ITEM_COLUMNS = `id, run_id, report_id, kind, subject_id, item_id, file_name,
  status, result, content_hash, created_at`;

function mapRun(row: any): VerificationRun {
  return {
    id: row.id,
    reportId: row.report_id,
    kind: row.kind,
    eventType: row.event_type,
    cause: row.cause,
    reason: row.reason ?? undefined,
    actorType: row.actor_type,
    actorId: row.actor_id ?? undefined,
    actorRole: row.actor_role ?? undefined,
    status: row.status,
    summary: row.summary,
    contentHash: row.content_hash,
    hashValid: row.hash_valid === true,
    legacy: row.legacy === true,
    checkedAt: row.checked_at,
    createdAt: row.created_at,
    items: [],
  };
}

function mapItem(row: any): VerificationRunItem {
  return {
    id: row.id,
    runId: row.run_id,
    reportId: row.report_id,
    kind: row.kind,
    subjectId: row.subject_id,
    itemId: row.item_id ?? undefined,
    fileName: row.file_name ?? undefined,
    status: row.status,
    result: row.result,
    hashValid: row.hash_valid === true,
    createdAt: row.created_at,
  };
}

function clampLimit(limit?: number): number {
  if (!limit || Number.isNaN(limit)) return 20;
  return Math.min(Math.max(Math.trunc(limit), 1), 100);
}

function clampOffset(offset?: number): number {
  if (!offset || Number.isNaN(offset)) return 0;
  return Math.max(Math.trunc(offset), 0);
}

export class PgVerificationHistoryRepo implements IVerificationHistoryRepo {
  async recordRun(
    input: RecordVerificationRunInput,
    db: Queryable = pool
  ): Promise<VerificationRun> {
    const runId = randomUUID();
    const checkedAt = input.checkedAt ?? new Date().toISOString();
    const { rows } = await db.query(
      `INSERT INTO verification_runs (
         id, report_id, kind, event_type, cause, reason, actor_type, actor_id,
         actor_role, status, summary, content_hash, legacy, checked_at, created_at
       ) VALUES (
         $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11,
         encode(sha256(convert_to($11::jsonb::text, 'UTF8')), 'hex'),
         $12, $13, NOW()
       )
       RETURNING ${RUN_COLUMNS}`,
      [
        runId,
        input.reportId,
        input.kind,
        input.eventType,
        input.cause,
        input.reason ?? null,
        input.actor.type,
        input.actor.id ?? null,
        input.actor.role ?? null,
        input.status,
        JSON.stringify(input.summary),
        input.legacy === true,
        checkedAt,
      ]
    );

    const run = mapRun(rows[0]);
    for (const item of input.items) {
      const { rows: itemRows } = await db.query(
        `INSERT INTO verification_run_items (
           id, run_id, report_id, kind, subject_id, item_id, file_name, status,
           result, content_hash, created_at
         ) VALUES (
           $1, $2, $3, $4, $5, $6, $7, $8, $9,
           encode(sha256(convert_to($9::jsonb::text, 'UTF8')), 'hex'),
           NOW()
         )
         RETURNING ${ITEM_COLUMNS}`,
        [
          randomUUID(),
          run.id,
          input.reportId,
          input.kind,
          item.subjectId,
          item.itemId ?? null,
          item.fileName ?? null,
          item.status,
          JSON.stringify(item.result),
        ]
      );
      run.items.push(mapItem(itemRows[0]));
    }

    return run;
  }

  async invalidateInvoiceReport(
    input: InvalidateInvoiceReportInput,
    db: Queryable = pool
  ): Promise<{ runId: string; affected: number } | null> {
    const { rows } = await db.query(
      `SELECT
         i.id,
         i.item_id,
         i.file_name,
         i.verification_status,
         i.verification_result,
         i.verified_at,
         prev.run_id AS previous_run_id
       FROM invoices i
       JOIN expense_items ei ON ei.id = i.item_id
       LEFT JOIN LATERAL (
         SELECT vri.run_id
           FROM verification_run_items vri
           JOIN verification_runs vr ON vr.id = vri.run_id
          WHERE vri.subject_id = i.id
            AND vr.event_type = 'verify'
          ORDER BY vri.created_at DESC, vri.id DESC
          LIMIT 1
       ) prev ON true
      WHERE ei.report_id = $1
        AND (i.verification_result IS NOT NULL OR i.verification_status <> 'pending')
      FOR UPDATE OF i`,
      [input.reportId]
    );

    if (rows.length === 0) return null;

    const run = await this.recordRun(
      {
        reportId: input.reportId,
        kind: 'invoice',
        eventType: 'invalidate',
        cause: input.cause,
        reason: input.reason ?? null,
        actor: input.actor,
        status: 'invalidated',
        summary: {
          status: 'invalidated',
          affected: rows.length,
          note: input.reason ?? undefined,
        },
        items: rows.map((row: any) => ({
          subjectId: row.id,
          itemId: row.item_id,
          fileName: row.file_name,
          status: 'invalidated',
          result: {
            event: 'invalidated',
            previousStatus: row.verification_status,
            previousVerifiedAt: row.verified_at,
            previousRunId: row.previous_run_id ?? null,
          },
        })),
      },
      db
    );

    await db.query(
      `UPDATE invoices
          SET verification_status = 'pending',
              verification_result = NULL,
              verified_at = NULL
        WHERE id = ANY($1)`,
      [rows.map((row: any) => row.id)]
    );

    return { runId: run.id, affected: rows.length };
  }

  async invalidateReceipt(
    input: InvalidateReceiptInput,
    db: Queryable = pool
  ): Promise<{ runId: string; affected: number } | null> {
    const { rows } = await db.query(
      `SELECT
         pr.id,
         pr.report_id,
         pr.file_name,
         pr.verification_status,
         pr.verification_result,
         pr.verified_at,
         prev.run_id AS previous_run_id
       FROM payment_receipts pr
       LEFT JOIN LATERAL (
         SELECT vri.run_id
           FROM verification_run_items vri
           JOIN verification_runs vr ON vr.id = vri.run_id
          WHERE vri.subject_id = pr.id
            AND vr.event_type = 'verify'
          ORDER BY vri.created_at DESC, vri.id DESC
          LIMIT 1
       ) prev ON true
      WHERE pr.id = $1
        AND pr.report_id = $2
        AND (pr.verification_result IS NOT NULL OR pr.verification_status <> 'pending')
      FOR UPDATE OF pr`,
      [input.receiptId, input.reportId]
    );

    if (rows.length === 0) return null;

    const row = rows[0];
    const run = await this.recordRun(
      {
        reportId: input.reportId,
        kind: 'payment_receipt',
        eventType: 'invalidate',
        cause: input.cause,
        reason: input.reason ?? null,
        actor: input.actor,
        status: 'invalidated',
        summary: {
          status: 'invalidated',
          affected: 1,
          note: input.reason ?? undefined,
        },
        items: [
          {
            subjectId: row.id,
            itemId: null,
            fileName: row.file_name,
            status: 'invalidated',
            result: {
              event: 'invalidated',
              previousStatus: row.verification_status,
              previousVerifiedAt: row.verified_at,
              previousRunId: row.previous_run_id ?? null,
            },
          },
        ],
      },
      db
    );

    await db.query(
      `UPDATE payment_receipts
          SET verification_status = 'pending',
              verification_result = NULL,
              verified_at = NULL
        WHERE id = $1`,
      [row.id]
    );

    return { runId: run.id, affected: 1 };
  }

  async findRunsByReport(
    query: VerificationHistoryQuery,
    db: Queryable = pool
  ): Promise<VerificationHistoryResponse> {
    const limit = clampLimit(query.limit);
    const offset = clampOffset(query.offset);
    const values: any[] = [query.reportId];
    let where = 'WHERE report_id = $1';
    if (query.kind) {
      values.push(query.kind);
      where += ` AND kind = $${values.length}`;
    }

    const countResult = await db.query(
      `SELECT COUNT(*)::int AS count FROM verification_runs ${where}`,
      values
    );
    const total = Number(countResult.rows[0]?.count ?? 0);

    const listValues = [...values, limit, offset];
    const { rows } = await db.query(
      `SELECT ${RUN_COLUMNS},
              (content_hash = encode(sha256(convert_to(summary::text, 'UTF8')), 'hex')) AS hash_valid
         FROM verification_runs
         ${where}
        ORDER BY checked_at DESC, id DESC
        LIMIT $${listValues.length - 1}
       OFFSET $${listValues.length}`,
      listValues
    );

    const runs = rows.map(mapRun);
    if (runs.length > 0) {
      const { rows: itemRows } = await db.query(
        `SELECT ${ITEM_COLUMNS},
                (content_hash = encode(sha256(convert_to(result::text, 'UTF8')), 'hex')) AS hash_valid
           FROM verification_run_items
          WHERE run_id = ANY($1)
          ORDER BY created_at ASC, id ASC`,
        [runs.map((run) => run.id)]
      );
      const byRun = new Map<string, VerificationRunItem[]>();
      for (const row of itemRows) {
        const item = mapItem(row);
        const list = byRun.get(item.runId) ?? [];
        list.push(item);
        byRun.set(item.runId, list);
      }
      for (const run of runs) {
        run.items = byRun.get(run.id) ?? [];
      }
    }

    return { items: runs, total, limit, offset };
  }

  async findLatestVerifyRunId(
    subjectId: string,
    db: Queryable = pool
  ): Promise<string | null> {
    const { rows } = await db.query(
      `SELECT vri.run_id
         FROM verification_run_items vri
         JOIN verification_runs vr ON vr.id = vri.run_id
        WHERE vri.subject_id = $1
          AND vr.event_type = 'verify'
        ORDER BY vri.created_at DESC, vri.id DESC
        LIMIT 1`,
      [subjectId]
    );
    return rows[0]?.run_id ?? null;
  }
}
