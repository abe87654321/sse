const mockQuery = jest.fn();

jest.mock('@sse/db', () => ({
  pool: { query: (...args: any[]) => mockQuery(...args) },
}));

import { IdentityBridge } from '../identity-bridge';
import { AppError } from '../../middleware/error';

beforeEach(() => {
  mockQuery.mockReset();
  mockQuery.mockResolvedValue({ rows: [] });
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
