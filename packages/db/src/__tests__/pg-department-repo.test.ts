const mockQuery = jest.fn();

jest.mock('../connection', () => ({
  pool: { query: (...args: any[]) => mockQuery(...args) },
}));

import { PgDepartmentRepo } from '../repositories/pg-department-repo';

beforeEach(() => {
  mockQuery.mockReset();
});

describe('PgDepartmentRepo.list', () => {
  it('returns departments with user counts ordered by name', async () => {
    mockQuery.mockResolvedValue({
      rows: [{ id: 'd1', name: '未分配', is_protected: true, user_count: 3 }],
    });

    const list = await new PgDepartmentRepo().list();

    expect(list).toEqual([
      { id: 'd1', name: '未分配', userCount: 3, isProtected: true },
    ]);
    const [sql] = mockQuery.mock.calls[0];
    expect(sql).toContain('FROM departments d');
    expect(sql).toContain('u.department_id = d.id');
    expect(sql).toContain('ORDER BY d.name');
  });
});

describe('PgDepartmentRepo.create', () => {
  it('inserts a department and returns its id', async () => {
    mockQuery.mockResolvedValue({
      rows: [{ id: 'd2', name: '技术部', is_protected: false, user_count: 0 }],
    });

    const created = await new PgDepartmentRepo().create('技术部');

    expect(created).toEqual({
      id: 'd2',
      name: '技术部',
      userCount: 0,
      isProtected: false,
    });
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain('INSERT INTO departments (name)');
    expect(params).toEqual(['技术部']);
  });
});

describe('PgDepartmentRepo.rename', () => {
  it('updates only the department row and returns the new name', async () => {
    mockQuery.mockResolvedValue({
      rows: [{ id: 'd2', name: '研发部', is_protected: false, user_count: 2 }],
    });

    const renamed = await new PgDepartmentRepo().rename('d2', '研发部');

    expect(renamed?.name).toBe('研发部');
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain('UPDATE departments d SET name = $2');
    expect(params).toEqual(['d2', '研发部']);
  });
});

describe('PgDepartmentRepo.resolveOrCreate', () => {
  it('falls back to the protected unassigned department', async () => {
    mockQuery.mockResolvedValue({ rows: [{ id: 'd1' }] });

    const id = await new PgDepartmentRepo().resolveOrCreate('  ');

    expect(id).toBe('d1');
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain('ON CONFLICT (name) DO UPDATE');
    expect(params).toEqual(['未分配']);
  });

  it('creates a department for a new external name', async () => {
    mockQuery.mockResolvedValue({ rows: [{ id: 'd9' }] });

    const id = await new PgDepartmentRepo().resolveOrCreate(' 新部门 ');

    expect(id).toBe('d9');
    expect(mockQuery.mock.calls[0][1]).toEqual(['新部门']);
  });
});
