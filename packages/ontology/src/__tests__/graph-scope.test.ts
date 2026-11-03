import { UserRole } from '@sse/shared';
import type { OntologyGraph } from '../owl-store';
import { scopeGraphForUser } from '../graph-scope';

const TECH_DEPT_ID = 'https://sse.local/dept/%E6%8A%80%E6%9C%AF%E9%83%A8';
const SALES_DEPT_ID = 'https://sse.local/dept/%E9%94%80%E5%94%AE%E9%83%A8';

function fixture(): OntologyGraph {
  return {
    nodes: [
      {
        id: 'https://sse.local/person/u1',
        label: 'person/u1',
        type: 'Person',
        properties: { name: '张三', department: '技术部' },
      },
      {
        id: 'https://sse.local/person/u2',
        label: 'person/u2',
        type: 'Person',
        properties: { name: '李四', department: '销售部' },
      },
      {
        id: TECH_DEPT_ID,
        label: 'dept/%E6%8A%80%E6%9C%AF%E9%83%A8',
        type: 'Department',
        properties: { name: '技术部' },
      },
      {
        id: SALES_DEPT_ID,
        label: 'dept/%E9%94%80%E5%94%AE%E9%83%A8',
        type: 'Department',
        properties: { name: '销售部' },
      },
      {
        id: 'https://sse.local/report/r1',
        label: 'report/r1',
        type: 'PendingReport',
        properties: { serialNo: 'RE-1' },
      },
      {
        id: 'https://sse.local/report/r2',
        label: 'report/r2',
        type: 'PendingReport',
        properties: { serialNo: 'RE-2' },
      },
    ],
    edges: [
      {
        id: 'e1',
        from: 'https://sse.local/person/u1',
        to: TECH_DEPT_ID,
        label: 'belongsTo',
      },
      {
        id: 'e2',
        from: 'https://sse.local/person/u2',
        to: SALES_DEPT_ID,
        label: 'belongsTo',
      },
      {
        id: 'e3',
        from: 'https://sse.local/report/r1',
        to: 'https://sse.local/person/u1',
        label: 'submittedBy',
      },
      {
        id: 'e4',
        from: 'https://sse.local/report/r2',
        to: 'https://sse.local/person/u2',
        label: 'submittedBy',
      },
    ],
  };
}

function ids(graph: OntologyGraph): string[] {
  return graph.nodes.map(node => node.id).sort();
}

describe('scopeGraphForUser', () => {
  it('returns the full graph for admin', () => {
    const graph = fixture();
    const scoped = scopeGraphForUser(graph, { role: UserRole.ADMIN, userId: 'u1' });

    expect(scoped.nodes).toHaveLength(6);
    expect(scoped.edges).toHaveLength(4);
  });

  it('returns the full graph for finance', () => {
    const graph = fixture();
    const scoped = scopeGraphForUser(graph, { role: UserRole.FINANCE, userId: 'u1' });

    expect(scoped.nodes).toHaveLength(6);
    expect(scoped.edges).toHaveLength(4);
  });

  it('limits an employee to their own node and two hops', () => {
    const graph = fixture();
    const scoped = scopeGraphForUser(graph, { role: UserRole.EMPLOYEE, userId: 'u1' });

    expect(ids(scoped)).toEqual(
      [
        'https://sse.local/person/u1',
        TECH_DEPT_ID,
        'https://sse.local/report/r1',
      ].sort()
    );
    expect(scoped.edges.map(edge => edge.id).sort()).toEqual(['e1', 'e3']);
  });

  it('returns an empty graph for an employee with no matching node', () => {
    const graph = fixture();
    const scoped = scopeGraphForUser(graph, { role: UserRole.EMPLOYEE, userId: 'missing' });

    expect(scoped.nodes).toEqual([]);
    expect(scoped.edges).toEqual([]);
  });

  it('limits a department approver to their department and one hop', () => {
    const graph = fixture();
    const scoped = scopeGraphForUser(graph, {
      role: UserRole.DEPT_APPROVER,
      userId: 'u1',
      department: '技术部',
    });

    expect(ids(scoped)).toEqual(
      [
        'https://sse.local/person/u1',
        TECH_DEPT_ID,
        'https://sse.local/report/r1',
      ].sort()
    );
    expect(scoped.edges.map(edge => edge.id).sort()).toEqual(['e1', 'e3']);
  });

  it('returns an empty graph for a department approver without a department', () => {
    const graph = fixture();
    const scoped = scopeGraphForUser(graph, {
      role: UserRole.DEPT_APPROVER,
      userId: 'u1',
      department: '',
    });

    expect(scoped.nodes).toEqual([]);
    expect(scoped.edges).toEqual([]);
  });

  it('returns an empty graph for an employee without a user id', () => {
    const graph = fixture();
    const scoped = scopeGraphForUser(graph, { role: UserRole.EMPLOYEE, userId: '' });

    expect(scoped.nodes).toEqual([]);
    expect(scoped.edges).toEqual([]);
  });

  it('returns an empty graph for an unknown role', () => {
    const graph = fixture();
    const scoped = scopeGraphForUser(graph, { role: 'guest', userId: 'u1' });

    expect(scoped.nodes).toEqual([]);
    expect(scoped.edges).toEqual([]);
  });
});
