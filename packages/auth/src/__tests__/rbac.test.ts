import { getPermissions, canViewReport } from '../rbac';
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
});
