const mockQuery = jest.fn();

jest.mock('../connection', () => ({
  pool: { query: (...args: any[]) => mockQuery(...args) },
}));

import { PgReportSnapshotRepo } from '../repositories/pg-report-snapshot-repo';

beforeEach(() => {
  mockQuery.mockReset();
});

describe('PgReportSnapshotRepo.capture', () => {
  it('loads the report, items, records and receipt, then inserts a hashed snapshot', async () => {
    mockQuery
      .mockResolvedValueOnce({
        rows: [
          {
            id: 'r1',
            serial_no: 'RE-001',
            user_id: 'u1',
            title: '差旅',
            description: null,
            total_amount: '300',
            status: 'pending',
            current_step: 1,
            submitted_at: new Date('2026-11-02T08:00:00Z'),
            completed_at: null,
            paid_at: null,
            paid_by: null,
            payment_ref: null,
            payment_comment: null,
            payment_updated_at: null,
            payment_updated_by: null,
            created_at: new Date('2026-11-01T08:00:00Z'),
            updated_at: new Date('2026-11-02T08:00:00Z'),
            applicant_name: '张三',
            applicant_department: '技术部',
          },
        ],
      })
      .mockResolvedValueOnce({
        rows: [
          {
            id: 'it1',
            report_id: 'r1',
            category_id: 'c1',
            amount: '300',
            expense_date: '2026-11-01',
            description: '高铁票',
            category_name: '交通费',
            invoice_id: 'i1',
            file_name: 'invoice.pdf',
            file_format: 'pdf',
            file_size: 1024,
            checksum: 'abc',
            invoice_no: 'NO-1',
            verification_status: 'pass',
            verification_result: { ok: true },
            verified_at: new Date('2026-11-02T09:00:00Z'),
            uploaded_at: new Date('2026-11-02T08:30:00Z'),
          },
        ],
      })
      .mockResolvedValueOnce({
        rows: [
          {
            id: 'ar1',
            report_id: 'r1',
            step: 1,
            approver_id: 'd1',
            approver_name: '李四',
            step_started_at: new Date('2026-11-02T09:30:00Z'),
            result: 'approved',
            comment: '同意',
            approved_at: new Date('2026-11-02T10:00:00Z'),
            verification_acknowledged: true,
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [
          {
            id: 's1',
            report_id: 'r1',
            snapshot_type: 'approve',
            schema_version: 1,
            approval_record_id: 'ar1',
            step: 1,
            actor_type: 'user',
            actor_id: 'd1',
            actor_role: 'dept_approver',
            content_hash: 'hash',
            legacy: false,
            created_at: new Date('2026-11-02T10:00:00Z'),
          },
        ],
      });

    const result = await new PgReportSnapshotRepo().capture({
      reportId: 'r1',
      snapshotType: 'approve',
      actor: { type: 'user', id: 'd1', role: 'dept_approver' },
      action: { recordId: 'ar1', step: 1, result: 'approved', comment: '同意' },
    });

    expect(result.id).toBe('s1');
    expect(result.snapshotType).toBe('approve');
    const insertCall = mockQuery.mock.calls[4];
    const [insertSql, insertParams] = insertCall;
    expect(insertSql).toContain('INSERT INTO report_snapshots');
    expect(insertSql).toContain('sha256');
    expect(insertParams[1]).toBe('approve');
    expect(insertParams[3]).toBe('ar1');
    const payload = JSON.parse(insertParams[8]);
    expect(payload.report.applicantDepartment).toBe('技术部');
    expect(payload.items[0].invoices[0].invoiceNo).toBe('NO-1');
    expect(payload.verification.acknowledged).toBe(true);
    expect(payload.approval.action).toEqual(
      expect.objectContaining({ recordId: 'ar1', result: 'approved' })
    );
  });
});

describe('PgReportSnapshotRepo reads', () => {
  it('maps snapshot metadata ordered by created_at and id', async () => {
    mockQuery.mockResolvedValue({
      rows: [
        {
          id: 's1',
          report_id: 'r1',
          snapshot_type: 'submit',
          schema_version: 1,
          approval_record_id: null,
          step: null,
          actor_type: 'user',
          actor_id: 'u1',
          actor_role: 'employee',
          content_hash: 'hash',
          legacy: false,
          created_at: new Date('2026-11-02T08:00:00Z'),
        },
      ],
    });

    const items = await new PgReportSnapshotRepo().findByReportId('r1');

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ id: 's1', reportId: 'r1', snapshotType: 'submit' });
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain('ORDER BY created_at DESC, id DESC');
    expect(params).toEqual(['r1']);
  });

  it('returns hashValid from the detail query', async () => {
    mockQuery.mockResolvedValue({
      rows: [
        {
          id: 's1',
          report_id: 'r1',
          snapshot_type: 'pay',
          schema_version: 1,
          actor_type: 'user',
          content_hash: 'hash',
          legacy: false,
          created_at: new Date(),
          payload: { schemaVersion: 1 },
          hash_valid: true,
        },
      ],
    });

    const detail = await new PgReportSnapshotRepo().findDetailById('s1');

    expect(detail?.hashValid).toBe(true);
    expect(detail?.payload).toEqual({ schemaVersion: 1 });
    expect(mockQuery.mock.calls[0][0]).toContain('AS hash_valid');
  });

  it('clamps admin query pagination and returns total', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ count: 3 }] })
      .mockResolvedValueOnce({ rows: [] });

    const result = await new PgReportSnapshotRepo().query({ limit: 5000, offset: -2 });

    expect(result.total).toBe(3);
    const [countSql] = mockQuery.mock.calls[0];
    expect(countSql).toContain('SELECT COUNT(*)::int AS count FROM report_snapshots');
    const [, listParams] = mockQuery.mock.calls[1];
    expect(listParams.slice(-2)).toEqual([200, 0]);
  });
});
