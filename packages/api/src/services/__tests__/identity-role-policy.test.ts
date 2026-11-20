import { resolveProvisionedRole } from '../identity-role-policy';

const noEnv = {} as NodeJS.ProcessEnv;

describe('resolveProvisionedRole', () => {
  it('defaults new external users to employee', () => {
    expect(resolveProvisionedRole({ source: 'scim', requestedRole: undefined }, noEnv)).toEqual({
      allowed: true,
      role: 'employee',
      preserved: false,
    });
  });

  it('rejects admin provisioning from SCIM even if requested explicitly', () => {
    const result = resolveProvisionedRole(
      { source: 'scim', requestedRole: 'admin' },
      noEnv
    );
    expect(result.allowed).toBe(false);
    if (!result.allowed) expect(result.code).toBe('ROLE_NOT_ALLOWED');
  });

  it('rejects admin even when a role map points to admin', () => {
    const env = { SCIM_ROLE_MAP: 'superuser=admin' } as NodeJS.ProcessEnv;
    const result = resolveProvisionedRole(
      { source: 'scim', requestedRole: 'superuser' },
      env
    );
    expect(result.allowed).toBe(false);
  });

  it('maps external roles through the source-specific map', () => {
    const env = {
      SCIM_ROLE_MAP: 'staff=employee,manager=dept_approver',
      SCIM_ALLOWED_ROLES: 'employee,dept_approver',
    } as NodeJS.ProcessEnv;
    expect(
      resolveProvisionedRole({ source: 'scim', requestedRole: 'manager' }, env)
    ).toEqual({ allowed: true, role: 'dept_approver', preserved: false });
  });

  it('uses SCIM_ALLOWED_ROLES and MDM_ALLOWED_ROLES independently', () => {
    const env = {
      SCIM_ALLOWED_ROLES: 'employee,dept_approver',
      MDM_ALLOWED_ROLES: 'employee',
    } as NodeJS.ProcessEnv;

    expect(
      resolveProvisionedRole({ source: 'scim', requestedRole: 'dept_approver' }, env)
    ).toEqual({ allowed: true, role: 'dept_approver', preserved: false });
    expect(
      resolveProvisionedRole({ source: 'mdm', requestedRole: 'dept_approver' }, env)
    ).toEqual(
      expect.objectContaining({ allowed: false, code: 'ROLE_NOT_ALLOWED' })
    );
  });

  it('rejects unknown role names', () => {
    const env = { SCIM_ALLOWED_ROLES: 'employee,root' } as NodeJS.ProcessEnv;
    expect(
      resolveProvisionedRole({ source: 'scim', requestedRole: 'root' }, env)
    ).toEqual(expect.objectContaining({ allowed: false, code: 'INVALID_ROLE' }));
  });

  it('never lets external provisioning demote a privileged local user', () => {
    expect(
      resolveProvisionedRole(
        { source: 'scim', requestedRole: 'employee', currentRole: 'finance' },
        noEnv
      )
    ).toEqual({ allowed: true, role: 'finance', preserved: true });

    expect(
      resolveProvisionedRole(
        { source: 'mdm', requestedRole: 'employee', currentRole: 'admin' },
        noEnv
      )
    ).toEqual({ allowed: true, role: 'admin', preserved: true });
  });
});
