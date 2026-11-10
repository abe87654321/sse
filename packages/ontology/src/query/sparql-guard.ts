import { Generator, Parser } from 'sparqljs';

const parser = new Parser();
const generator = new Generator();

function walk(node: unknown, visit: (n: any) => void): void {
  if (!node || typeof node !== 'object') return;
  visit(node as any);
  for (const value of Object.values(node as any)) {
    if (Array.isArray(value)) value.forEach((item) => walk(item, visit));
    else walk(value, visit);
  }
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
  const limit = Math.floor(Number(max));
  if (!Number.isFinite(limit) || limit <= 0) return query;

  // Parse the real AST instead of regex-scanning raw text: comments and string
  // literals can otherwise spoof or hide an outer LIMIT clause.
  const ast: any = parser.parse(query);
  if (ast.type !== 'query' || String(ast.queryType).toUpperCase() !== 'SELECT') {
    return query;
  }

  const current = typeof ast.limit === 'number' ? ast.limit : undefined;
  ast.limit = current === undefined ? limit : Math.min(current, limit);
  return generator.stringify(ast);
}
