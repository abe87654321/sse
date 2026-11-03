import { UserRole } from '@sse/shared';
import type { GraphNode, OntologyGraph } from './owl-store';

export interface GraphScope {
  role: string;
  userId: string;
  department?: string;
}

const FULL_ACCESS_ROLES = new Set<string>([UserRole.ADMIN, UserRole.FINANCE]);

function normalize(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function decode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function belongsToDepartment(node: GraphNode, department: string): boolean {
  const dept = normalize(department);
  if (!dept) return false;

  const properties = node.properties || {};
  if (normalize(properties.department) === dept || normalize(properties.name) === dept) {
    return true;
  }

  const label = normalize(decode(node.label || ''));
  if (label === dept || label === `dept/${dept}`) return true;

  const id = normalize(decode(node.id || ''));
  return id.endsWith(`/dept/${dept}`) || id.endsWith(`/${dept}`);
}

function expandHops(graph: OntologyGraph, keep: Set<string>, hops: number): void {
  for (let hop = 0; hop < hops; hop++) {
    for (const edge of graph.edges) {
      if (keep.has(edge.from)) keep.add(edge.to);
      if (keep.has(edge.to)) keep.add(edge.from);
    }
  }
}

export function scopeGraphForUser(graph: OntologyGraph, scope: GraphScope): OntologyGraph {
  if (FULL_ACCESS_ROLES.has(scope.role)) return graph;

  const keep = new Set<string>();

  if (scope.role === UserRole.DEPT_APPROVER) {
    if (!normalize(scope.department)) return { nodes: [], edges: [] };
    for (const node of graph.nodes) {
      if (belongsToDepartment(node, scope.department!)) keep.add(node.id);
    }
    expandHops(graph, keep, 1);
  } else if (scope.role === UserRole.EMPLOYEE) {
    if (!normalize(scope.userId)) return { nodes: [], edges: [] };
    const own = graph.nodes.find(node => {
      const propertyUserId = normalize(node.properties?.userId);
      return (propertyUserId !== '' && propertyUserId === normalize(scope.userId))
        || node.id.includes(scope.userId);
    });
    if (!own) return { nodes: [], edges: [] };
    keep.add(own.id);
    expandHops(graph, keep, 2);
  } else {
    return { nodes: [], edges: [] };
  }

  return {
    nodes: graph.nodes.filter(node => keep.has(node.id)),
    edges: graph.edges.filter(edge => keep.has(edge.from) && keep.has(edge.to)),
  };
}
