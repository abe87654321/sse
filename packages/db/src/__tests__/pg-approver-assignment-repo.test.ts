const mockQuery = jest.fn();
const mockClientQuery = jest.fn();
const mockRelease = jest.fn();
const mockConnect = jest.fn(async (..._args: any[]) => ({
  query: (...args: any[]) => mockClientQuery(...args),
  release: mockRelease,
}));

jest.mock('../connection', () => ({
  pool: {
    query: (...args: any[]) => mockQuery(...args),
    connect: (...args: any[]) => mockConnect(...args),
  },
}));

import {
  PgApproverAssignmentRepo,
  ApproverConflictError,
} from '../repositories/pg-approver-assignment-repo';

beforeEach(() => {
  mockQuery.mockReset();
  mockClientQuery.mockReset();
  mockRelease.mockReset();
  mockConnect.mockClear();
});

describe('PgApproverAssignmentRepo lookups', () => {
  const repo = new PgApproverAssignmentRepo();

  it('finds the approver id for a department id', async () => {
    mockQuery.mockResolvedValue({ rows: [{ user_id: 'u-1' }] });

    await expect(repo.findApproverIdForDepartment('d-1')).resolves.toBe('u-1');
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain('FROM department_approvers');
    expect(sql).toContain('WHERE department_id = $1');
    expect(params).toEqual(['d-1']);
  });

  it('returns null when a department has no approver', async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    await expect(repo.findApproverIdForDepartment('d-1')).resolves.toBeNull();
  });

  it('resolves an approver by department name', async () => {
    mockQuery.mockResolvedValue({ rows: [{ user_id: 'u-2' }] });

    await expect(repo.findApproverIdForDepartmentName('技术部')).resolves.toBe('u-2');
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain('JOIN departments d ON d.id = da.department_id');
    expect(sql).toContain('WHERE d.name = $1');
    expect(params).toEqual(['技术部']);
  });

  it('falls back to the earliest active admin', async () => {
    mockQuery.mockResolvedValue({ rows: [{ id: 'admin-1' }] });

    await expect(repo.findFallbackAdminId()).resolves.toBe('admin-1');
    const [sql] = mockQuery.mock.calls[0];
    expect(sql).toContain("role = 'admin' AND status = 'active'");
    expect(sql).toContain('ORDER BY created_at ASC');
  });

  it('lists the departments a user approves', async () => {
    mockQuery.mockResolvedValue({ rows: [{ id: 'd-1', name: '技术部' }] });

    await expect(repo.findDepartmentsForUser('u-1')).resolves.toEqual([
      { id: 'd-1', name: '技术部' },
    ]);
  });

  it('lists all department assignments', async () => {
    mockQuery.mockResolvedValue({
      rows: [
        {
          department_id: 'd-1',
          department_name: '技术部',
          user_id: 'u-1',
          user_name: '张三',
        },
      ],
    });

    await expect(repo.listAssignments()).resolves.toEqual([
      {
        departmentId: 'd-1',
        departmentName: '技术部',
        userId: 'u-1',
        userName: '张三',
      },
    ]);
  });
});

describe('PgApproverAssignmentRepo mutations', () => {
  const repo = new PgApproverAssignmentRepo();

  it('assigns a department approver with an upsert', async () => {
    mockQuery.mockResolvedValue({ rows: [] });

    await repo.assign('d-1', 'u-1', 'admin-1');

    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain('INSERT INTO department_approvers');
    expect(sql).toContain('ON CONFLICT (department_id) DO UPDATE');
    expect(params).toEqual(['d-1', 'u-1', 'admin-1']);
  });

  it('unassigns a department', async () => {
    mockQuery.mockResolvedValue({ rows: [] });

    await repo.unassign('d-1');

    expect(mockQuery.mock.calls[0][1]).toEqual(['d-1']);
  });

  it('replaces a user assignments inside a transaction and dedupes ids', async () => {
    mockClientQuery.mockResolvedValue({ rows: [] });

    await repo.replaceForUser('u-1', ['d-1', 'd-1', 'd-2'], 'admin-1');

    expect(mockConnect).toHaveBeenCalled();
    expect(mockClientQuery.mock.calls[0][0]).toBe('BEGIN');
    expect(mockClientQuery.mock.calls.at(-1)?.[0]).toBe('COMMIT');
    expect(mockRelease).toHaveBeenCalled();

    const deleteCall = mockClientQuery.mock.calls.find(([sql]) =>
      String(sql).includes('DELETE FROM department_approvers')
    );
    expect(deleteCall?.[1]?.[0]).toEqual(['d-1', 'd-2']);

    const insertCall = mockClientQuery.mock.calls.find(([sql]) =>
      String(sql).includes('INSERT INTO department_approvers')
    );
    expect(insertCall?.[1]?.[0]).toEqual(['d-1', 'd-2']);
  });

  it('rejects when another user already owns a department', async () => {
    mockClientQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ department_id: 'd-1', user_id: 'other' }] })
      .mockResolvedValueOnce({ rows: [] });

    await expect(repo.replaceForUser('u-1', ['d-1'])).rejects.toBeInstanceOf(
      ApproverConflictError
    );
    expect(mockClientQuery.mock.calls.map(([sql]) => sql)).toContain('ROLLBACK');
    expect(mockRelease).toHaveBeenCalled();
  });
});
