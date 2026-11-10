import { getPermissions, canViewReport, canWriteReport, resolveDataScope } from '../rbac';
import { UserRole } from '@sse/shared';

describe('RBAC', () => {
  it('employee can submit but not approve', () => {
    const p = getPermissions(UserRole.EMPLOYEE);
    expect(p.canSubmit).toBe(true);
    expect(p.canApprove).toBe(false);
  });

  it('dept approver can see own department reports', () => {
    expect(canViewReport(UserRole.DEPT_APPROVER, 'tech', 'tech', 'u1', 'u2')).toBe(true);
  });

  it('dept approver cannot see other department reports', () => {
    expect(canViewReport(UserRole.DEPT_APPROVER, 'tech', 'sales', 'u1', 'u2')).toBe(false);
  });

  it('finance can see all', () => {
    expect(canViewReport(UserRole.FINANCE, 'finance', 'tech', 'u1', 'u2')).toBe(true);
  });

  it('employee can only see own', () => {
    expect(canViewReport(UserRole.EMPLOYEE, 'tech', 'tech', 'same_id', 'same_id')).toBe(true);
    expect(canViewReport(UserRole.EMPLOYEE, 'tech', 'tech', 'u1', 'u2')).toBe(false);
  });

  it('dept approver without a department cannot match a department-less owner', () => {
    expect(canViewReport(UserRole.DEPT_APPROVER, '', '', 'u1', 'u2')).toBe(false);
  });

  it('employee cannot view a report with an empty owner id', () => {
    expect(canViewReport(UserRole.EMPLOYEE, 'tech', 'tech', '', '')).toBe(false);
  });

  describe('resolveDataScope', () => {
    it('grants full scope to admin and finance', () => {
      expect(resolveDataScope({ role: UserRole.ADMIN, userId: 'u1', department: 'x' })).toEqual({ kind: 'all' });
      expect(resolveDataScope({ role: UserRole.FINANCE, userId: 'u1' })).toEqual({ kind: 'all' });
    });

    it('scopes a department approver to their department', () => {
      expect(resolveDataScope({ role: UserRole.DEPT_APPROVER, userId: 'u1', department: 'tech' }))
        .toEqual({ kind: 'department', department: 'tech' });
    });

    it('fails closed for a department approver without a department', () => {
      expect(resolveDataScope({ role: UserRole.DEPT_APPROVER, userId: 'u1', department: '' }))
        .toEqual({ kind: 'deny' });
    });

    it('scopes an employee to themselves', () => {
      expect(resolveDataScope({ role: UserRole.EMPLOYEE, userId: 'u1' }))
        .toEqual({ kind: 'self', userId: 'u1' });
    });

    it('fails closed for unknown or missing roles', () => {
      expect(resolveDataScope({ role: 'employee ', userId: 'u1' })).toEqual({ kind: 'deny' });
      expect(resolveDataScope({ role: 'unknown', userId: 'u1', department: 'tech' })).toEqual({ kind: 'deny' });
      expect(resolveDataScope({ role: '', userId: 'u1' })).toEqual({ kind: 'deny' });
    });
  });

  describe('canWriteReport', () => {
    it('allows admin and finance on any report', () => {
      expect(canWriteReport(UserRole.ADMIN, 'admin', 'owner')).toBe(true);
      expect(canWriteReport(UserRole.FINANCE, 'fin', 'owner')).toBe(true);
    });

    it('allows the owner but not another user', () => {
      expect(canWriteReport(UserRole.EMPLOYEE, 'owner', 'owner')).toBe(true);
      expect(canWriteReport(UserRole.EMPLOYEE, 'other', 'owner')).toBe(false);
    });

    it('does not let a department approver write another user\'s report', () => {
      expect(canWriteReport(UserRole.DEPT_APPROVER, 'approver', 'owner')).toBe(false);
    });
  });
});
