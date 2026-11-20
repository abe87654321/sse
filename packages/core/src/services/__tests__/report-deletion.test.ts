import { ReportStatus } from '@sse/shared';
import { evaluateReportDeletion } from '../report-deletion';

const base = {
  status: ReportStatus.DRAFT,
  actorRole: 'employee',
  actorId: 'user-1',
  ownerId: 'user-1',
  hasAuditRecords: false,
};

describe('evaluateReportDeletion', () => {
  it('allows an owner to delete a draft without audit records', () => {
    expect(evaluateReportDeletion(base)).toEqual({ allowed: true });
  });

  it('allows an admin to delete a draft without audit records', () => {
    expect(
      evaluateReportDeletion({ ...base, actorRole: 'admin', actorId: 'admin-1' })
    ).toEqual({ allowed: true });
  });

  it.each([
    ReportStatus.PENDING,
    ReportStatus.APPROVED,
    ReportStatus.REJECTED,
    ReportStatus.PAID,
  ])('blocks physical deletion of a %s report', (status) => {
    const decision = evaluateReportDeletion({ ...base, status });
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) expect(decision.code).toBe('REPORT_LOCKED');
  });

  it('blocks deletion of a draft that already has audit records', () => {
    const decision = evaluateReportDeletion({ ...base, hasAuditRecords: true });
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) expect(decision.code).toBe('REPORT_LOCKED');
  });

  it('rejects an unrelated employee before checking the report status', () => {
    const decision = evaluateReportDeletion({
      ...base,
      actorId: 'other-user',
      status: ReportStatus.APPROVED,
    });
    expect(decision).toEqual({
      allowed: false,
      code: 'FORBIDDEN',
      message: '无权删除此报销单',
    });
  });

  it('keeps audit evidence explicit in the locked message', () => {
    const decision = evaluateReportDeletion({ ...base, status: ReportStatus.APPROVED });
    if (decision.allowed) throw new Error('expected deletion to be blocked');
    expect(decision.message).toContain('审计');
  });
});
