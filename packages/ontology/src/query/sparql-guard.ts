import { Parser } from 'sparqljs';

const parser = new Parser();

function walk(node: unknown, visit: (n: any) => void): void {
  if (!node || typeof node !== 'object') return;
  visit(node as any);
  for (const value of Object.values(node as any)) {
    if (Array.isArray(value)) value.forEach((item) => walk(item, visit));
    else walk(value, visit);
  }
}

function strippedQuery(query: string): string {
  return query
    .replace(/^\s*(?:PREFIX\s+\S+\s*<[^>]*>|BASE\s*<[^>]*>)\s*/gim, '')
    .trimStart();
}

export function assertReadOnlySparql(query: string): void {
  const ast: any = parser.parse(query);

  if (ast.type !== 'query') {
    throw new Error('only read queries are allowed');
  }

  const queryType = String(ast.queryType ?? '').toUpperCase();
  if (!['SELECT', 'ASK', 'CONSTRUCT', 'DESCRIBE'].includes(queryType)) {
    throw new Error('unsupported query type');
  }

  walk(ast, (node) => {
    if (node.type === 'service') throw new Error('SERVICE is not allowed');
    if (node.type === 'load') throw new Error('LOAD is not allowed');
  });
}

export function capResults(query: string, max = 1000): string {
  if (!/^SELECT\b/i.test(strippedQuery(query))) return query;

  const limit = Math.floor(Number(max));
  if (!Number.isFinite(limit) || limit <= 0) return query;

  const outerLimit = /(\bLIMIT\s+)(\d+)(\s+OFFSET\s+\d+)?\s*$/i.exec(query);
  if (outerLimit) {
    const current = parseInt(outerLimit[2], 10);
    if (current <= limit) return query;
    const start = outerLimit.index + outerLimit[1].length;
    return query.slice(0, start) + String(limit) + query.slice(start + outerLimit[2].length);
  }

  return `${query.trimEnd()}\nLIMIT ${limit}`;
}
