const mockQuery = jest.fn();
const mockDeptFindByName = jest.fn();
const mockDeptCreate = jest.fn();

jest.mock('@sse/db', () => ({
  UNASSIGNED_DEPARTMENT: '未分配',
  pool: { query: (...args: any[]) => mockQuery(...args) },
  PgDepartmentRepo: jest.fn().mockImplementation(() => ({
    findByName: (...args: any[]) => mockDeptFindByName(...args),
    create: (...args: any[]) => mockDeptCreate(...args),
  })),
}));

import { IdentityBridge } from '../identity-bridge';
import { AppError } from '../../middleware/error';

beforeEach(() => {
  process.env.AUDIT_EVENTS = '0';
  mockQuery.mockReset();
  mockQuery.mockResolvedValue({ rows: [] });
  mockDeptFindByName.mockReset();
  mockDeptFindByName.mockResolvedValue(null);
  mockDeptCreate.mockReset();
  mockDeptCreate.mockImplementation(async (name: string) => ({
    id: `dept-${name}`,
    name,
    userCount: 0,
    isProtected: false,
  }));
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  (console.error as jest.Mock).mockRestore();
});

describe('IdentityBridge role enforcement', () => {
  it('rejects SCIM admin provisioning before writing a user', async () => {
    await expect(
      new IdentityBridge().syncFromScim(
        { userName: 'ext-admin', 'urn:sse:role': 'admin' },
        'scim'
      )
    ).rejects.toMatchObject({ code: 'ROLE_NOT_ALLOWED' });

    const writes = mockQuery.mock.calls.map(([sql]) => String(sql));
    expect(writes.some((sql) => sql.startsWith('INSERT INTO users'))).toBe(false);
    expect(writes.some((sql) => sql.startsWith('UPDATE users'))).toBe(false);
  });

  it('keeps a privileged local role when SCIM sends employee', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ local_user_id: 'user-1', role: 'finance' }] })
      .mockResolvedValue({ rows: [] });

    const result = await new IdentityBridge().syncFromScim(
      { userName: 'ext-finance', 'urn:sse:role': 'employee' },
      'scim'
    );

    expect(result.role).toBe('finance');
    const updateCall = mockQuery.mock.calls.find(([sql]) =>
      String(sql).startsWith('UPDATE users SET name=')
    );
    expect(updateCall?.[1]?.[4]).toBe('finance');
  });

  it('auto-creates an unknown department during SCIM provisioning', async () => {
    mockQuery.mockImplementation(async (sql: string) =>
      String(sql).startsWith('INSERT INTO users')
        ? { rows: [{ id: 'user-new' }] }
        : { rows: [] }
    );

    await new IdentityBridge().syncFromScim(
      { userName: 'ext-dept', 'urn:sse:department': '市场部' },
      'scim'
    );

    expect(mockDeptCreate).toHaveBeenCalledWith('市场部');
    const insert = mockQuery.mock.calls.find(([sql]) =>
      String(sql).startsWith('INSERT INTO users')
    );
    expect(insert?.[0]).toContain('department_id');
  });

  it('reuses an existing department instead of creating a duplicate', async () => {
    mockQuery.mockImplementation(async (sql: string) =>
      String(sql).startsWith('INSERT INTO users')
        ? { rows: [{ id: 'user-new' }] }
        : { rows: [] }
    );
    mockDeptFindByName.mockResolvedValue({
      id: 'dept-existing',
      name: '技术部',
      userCount: 1,
      isProtected: false,
    });

    await new IdentityBridge().syncFromScim(
      { userName: 'ext-existing', 'urn:sse:department': '技术部' },
      'scim'
    );

    expect(mockDeptCreate).not.toHaveBeenCalled();
    const insert = mockQuery.mock.calls.find(([sql]) =>
      String(sql).startsWith('INSERT INTO users')
    );
    expect(insert?.[1]?.[3]).toBe('dept-existing');
  });

  it('rejects MDM provisioning without user data', async () => {
    await expect(
      new IdentityBridge().syncFromMdmEvent({ userId: 'mdm-1', event: 'created' })
    ).rejects.toBeInstanceOf(AppError);
  });

  it('rejects MDM admin provisioning', async () => {
    await expect(
      new IdentityBridge().syncFromMdmEvent({
        userId: 'mdm-admin',
        event: 'created',
        data: {
          name: 'Admin',
          phone: '13900000000',
          department: 'IT',
          role: 'admin',
          status: 'active',
        },
      })
    ).rejects.toMatchObject({ code: 'ROLE_NOT_ALLOWED' });
  });
});
