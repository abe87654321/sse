const mockQuery = jest.fn();
const mockGetStatistics = jest.fn();

jest.mock('@sse/db', () => ({
  pool: { query: (...args: any[]) => mockQuery(...args) },
  PgExpenseRepo: jest.fn().mockImplementation(() => ({
    getStatistics: (...args: any[]) => mockGetStatistics(...args),
  })),
}));

jest.mock('../services/audit', () => ({
  auditFromRequest: jest.fn(),
}));

import express from 'express';
import type { AddressInfo } from 'net';
import type { Server } from 'http';
import { signToken } from '@sse/auth';
import { statisticsRoutes } from '../routes/statistics';
import { errorHandler } from '../middleware/error';

let url: string;
let server: Server;

beforeAll(async () => {
  jest.spyOn(console, 'error').mockImplementation(() => {});
  const app = express();
  app.use(express.json());
  app.use('/statistics', statisticsRoutes);
  app.use(errorHandler);
  await new Promise<void>((resolve) => {
    server = app.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      url = `http://127.0.0.1:${port}`;
      resolve();
    });
  });
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  (console.error as jest.Mock).mockRestore();
});

function arrangeStatisticsRepos() {
  mockGetStatistics.mockResolvedValue({
    total_amount: '100',
    total_count: '1',
    approved_count: '1',
    rejected_count: '0',
    pending_count: '0',
  });
  mockQuery
    .mockResolvedValueOnce({
      rows: [{ category: '交通', total_amount: '100', report_count: '1' }],
    })
    .mockResolvedValueOnce({
      rows: [
        {
          department: '技术部',
          total_amount: '100',
          report_count: '1',
          approved_count: '1',
        },
      ],
    })
    .mockResolvedValueOnce({
      rows: [{ month: '2026-11', total_amount: '100', report_count: '1' }],
    });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockQuery.mockReset();
  mockGetStatistics.mockReset();
  arrangeStatisticsRepos();
});

describe('statistics data scope', () => {
  it('limits employees to their own reports and applies date filters', async () => {
    const token = signToken({ userId: 'u-emp', role: 'employee', department: '技术部' });

    const response = await fetch(
      `${url}/statistics?dateFrom=2026-01-01&dateTo=2026-12-31`,
      { headers: { authorization: `Bearer ${token}` } }
    );

    expect(response.status).toBe(200);
    expect(mockGetStatistics).toHaveBeenCalledWith(
      '2026-01-01',
      '2026-12-31',
      undefined,
      'u-emp'
    );

    const [categorySql, categoryParams] = mockQuery.mock.calls[0];
    expect(categorySql).toContain('er.user_id = $1');
    expect(categorySql).not.toContain('JOIN users u');
    expect(categorySql).toContain("er.created_at < ($3::date + INTERVAL '1 day')");
    expect(categorySql).toContain('er.status = ANY($4)');
    expect(categoryParams).toEqual([
      'u-emp',
      '2026-01-01',
      '2026-12-31',
      ['approved', 'paid'],
    ]);

    const [monthlySql, monthlyParams] = mockQuery.mock.calls[2];
    expect(monthlySql).toContain('ORDER BY month DESC');
    expect(monthlySql).toContain('LIMIT 12');
    expect(monthlySql).toContain('ORDER BY month ASC');
    expect(monthlySql).toContain('er.status = ANY($4)');
    expect(monthlyParams).toEqual([
      'u-emp',
      '2026-01-01',
      '2026-12-31',
      ['approved', 'paid'],
    ]);

    const body = (await response.json()) as any;
    expect(body.scope).toBe('self');
    expect(body.scopeLabel).toBe('本人');
    expect(body.overview.totalAmount).toBe(100);
    expect(body.byCategory[0].category).toBe('交通');
  });

  it('limits department approvers to their department and ignores other department filters', async () => {
    const token = signToken({
      userId: 'u-dept',
      role: 'dept_approver',
      department: '技术部',
    });

    const response = await fetch(`${url}/statistics?department=市场部`, {
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.status).toBe(200);
    expect(mockGetStatistics).toHaveBeenCalledWith(
      undefined,
      undefined,
      '技术部',
      undefined
    );

    const [categorySql, categoryParams] = mockQuery.mock.calls[0];
    expect(categorySql).toContain('JOIN users u ON u.id = er.user_id');
    expect(categorySql).toContain('u.department_id = (SELECT id FROM departments WHERE name = $1)');
    expect(categorySql).toContain('er.status = ANY($2)');
    expect(categoryParams).toEqual(['技术部', ['approved', 'paid']]);

    const body = (await response.json()) as any;
    expect(body.scope).toBe('department');
    expect(body.scopeLabel).toBe('技术部');
  });

  it('lets finance filter all-company statistics by department', async () => {
    const token = signToken({ userId: 'u-fin', role: 'finance', department: '财务部' });

    const response = await fetch(`${url}/statistics?department=市场部`, {
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.status).toBe(200);
    expect(mockGetStatistics).toHaveBeenCalledWith(
      undefined,
      undefined,
      '市场部',
      undefined
    );

    const [categorySql, categoryParams] = mockQuery.mock.calls[0];
    expect(categorySql).toContain('u.department_id = (SELECT id FROM departments WHERE name = $1)');
    expect(categorySql).toContain('er.status = ANY($2)');
    expect(categoryParams).toEqual(['市场部', ['approved', 'paid']]);

    const body = (await response.json()) as any;
    expect(body.scope).toBe('all');
    expect(body.scopeLabel).toBe('全公司');
  });

  it('returns all-company statistics without filters for finance', async () => {
    const token = signToken({ userId: 'u-fin', role: 'finance', department: '财务部' });

    const response = await fetch(`${url}/statistics`, {
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.status).toBe(200);
    expect(mockGetStatistics).toHaveBeenCalledWith(
      undefined,
      undefined,
      undefined,
      undefined
    );

    const [categorySql, categoryParams] = mockQuery.mock.calls[0];
    expect(categorySql).not.toContain('departments WHERE name =');
    expect(categoryParams).toEqual([['approved', 'paid']]);
  });

  it('applies the same spending basis to every aggregate', async () => {
    const token = signToken({ userId: 'u-fin', role: 'finance', department: '财务部' });

    const response = await fetch(
      `${url}/statistics?dateFrom=2026-01-01&dateTo=2026-12-31`,
      { headers: { authorization: `Bearer ${token}` } }
    );

    expect(response.status).toBe(200);
    expect(mockGetStatistics).toHaveBeenCalledWith(
      '2026-01-01',
      '2026-12-31',
      undefined,
      undefined
    );

    const [categorySql, categoryParams] = mockQuery.mock.calls[0];
    expect(categorySql).toContain("COALESCE(ec.name, '未分类')");
    expect(categorySql).toContain('er.status = ANY($3)');
    expect(categoryParams).toEqual([
      '2026-01-01',
      '2026-12-31',
      ['approved', 'paid'],
    ]);

    const [deptSql, deptParams] = mockQuery.mock.calls[1];
    expect(deptSql).toContain("COALESCE(d.name, '未分配')");
    expect(deptSql).toContain('LEFT JOIN departments d ON d.id = u.department_id');
    expect(deptSql).toContain('er.status = ANY($3)');
    expect(deptParams).toEqual([
      '2026-01-01',
      '2026-12-31',
      ['approved', 'paid'],
    ]);

    const [monthlySql, monthlyParams] = mockQuery.mock.calls[2];
    expect(monthlySql).toContain("TO_CHAR(er.created_at, 'YYYY-MM')");
    expect(monthlySql).toContain('er.status = ANY($3)');
    expect(monthlyParams).toEqual([
      '2026-01-01',
      '2026-12-31',
      ['approved', 'paid'],
    ]);
  });

  it('rejects unknown roles with 403 and does not query statistics', async () => {
    const token = signToken({ userId: 'u-x', role: 'auditor', department: '技术部' });

    const response = await fetch(`${url}/statistics`, {
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.status).toBe(403);
    expect(mockGetStatistics).not.toHaveBeenCalled();
    expect(mockQuery).not.toHaveBeenCalled();
  });
});

describe('statistics export permissions', () => {
  it('keeps export restricted to finance/admin', async () => {
    const token = signToken({ userId: 'u-emp', role: 'employee', department: '技术部' });

    const response = await fetch(`${url}/statistics/export`, {
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.status).toBe(403);
    expect(mockGetStatistics).not.toHaveBeenCalled();
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('lets finance export with an optional department filter', async () => {
    const token = signToken({ userId: 'u-fin', role: 'finance', department: '财务部' });

    const response = await fetch(`${url}/statistics/export?department=市场部`, {
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.status).toBe(200);
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain('u.department_id = (SELECT id FROM departments WHERE name = $1)');
    expect(params).toEqual(['市场部']);
  });
});
