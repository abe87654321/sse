const mockQuery = jest.fn();

jest.mock('../connection', () => ({
  pool: {
    query: (...args: any[]) => mockQuery(...args),
    connect: jest.fn(),
  },
}));

import { PgUserRepo } from '../repositories/pg-user-repo';

beforeEach(() => {
  mockQuery.mockReset();
});

describe('PgUserRepo department reads', () => {
  it('joins departments and exposes both name and id', async () => {
    mockQuery.mockResolvedValue({
      rows: [
        {
          id: 'u1',
          name: '张三',
          phone: '13800000000',
          email: null,
          department_id: 'd1',
          department: '技术部',
          role: 'employee',
          parent_id: null,
          status: 'active',
          deleted_at: null,
          avatar_url: null,
          notify_prefs: null,
          created_at: new Date('2026-11-01T00:00:00Z'),
          updated_at: new Date('2026-11-01T00:00:00Z'),
        },
      ],
    });

    const user = await new PgUserRepo().findById('u1');

    expect(user).toMatchObject({ department: '技术部', departmentId: 'd1' });
    const [sql] = mockQuery.mock.calls[0];
    expect(sql).toContain('LEFT JOIN departments d ON d.id = u.department_id');
    expect(sql).toContain('d.name AS department');
  });

  it('finds department approvers by department name', async () => {
    mockQuery.mockResolvedValue({ rows: [] });

    await new PgUserRepo().findDeptApprovers('技术部');

    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain('d.name = $1');
    expect(sql).toContain('u.role = $2');
    expect(params).toEqual(['技术部', 'dept_approver']);
  });

  it('finds a role by name without touching the dropped text column', async () => {
    mockQuery.mockResolvedValue({ rows: [] });

    await new PgUserRepo().findByRole('dept_approver', '技术部');

    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain('d.name = $2');
    expect(sql).not.toMatch(/\bu\.department\b/);
    expect(params).toEqual(['dept_approver', '技术部']);
  });
});
