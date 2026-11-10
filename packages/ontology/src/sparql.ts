import type { Store } from 'n3';

export interface SparqlOptions {
  maxResults?: number;
  maxPatterns?: number;
  maxQueryLength?: number;
}

const DEFAULTS = {
  maxResults: 1000,
  maxPatterns: 20,
  maxQueryLength: 20_000,
};

/**
 * Minimal SELECT-only SPARQL executor over the in-memory N3 store.
 *
 * Guards keep agent-driven queries bounded: query length, graph-pattern count,
 * and a hard result cap (honouring a smaller explicit LIMIT). Never writes to
 * stdout — the MCP stdio transport uses stdout for JSON-RPC.
 */
export function executeSparql(
  store: Store,
  sparql: string,
  options: SparqlOptions = {},
): Array<Record<string, string>> {
  if (typeof sparql !== 'string') throw new Error('SPARQL 查询必须为字符串');

  const maxQueryLength = options.maxQueryLength ?? DEFAULTS.maxQueryLength;
  if (sparql.length > maxQueryLength) {
    throw new Error(`SPARQL 查询过长（上限 ${maxQueryLength} 字符）`);
  }

  const selectMatch = sparql.match(/SELECT\s+(.+?)\s+WHERE\s*\{(.+?)\}/is);
  if (!selectMatch) throw new Error('仅支持 SELECT ?var WHERE { ?s ?p ?o } 格式');

  const vars = selectMatch[1].trim().split(/\s+/).filter(v => v.startsWith('?'));
  const whereContent = selectMatch[2].trim();
  const tokens = whereContent.split(/\s+/).filter(Boolean);
  const patterns: Array<{ subject: string; predicate: string; object: string }> = [];
  for (let i = 0; i + 2 < tokens.length; i += 3) {
    if (tokens[i + 1] === '.') { i -= 2; continue; }
    patterns.push({ subject: tokens[i], predicate: tokens[i + 1], object: tokens[i + 2] });
  }

  const maxPatterns = options.maxPatterns ?? DEFAULTS.maxPatterns;
  if (patterns.length > maxPatterns) {
    throw new Error(`SPARQL 图模式过多（上限 ${maxPatterns}）`);
  }

  const limitMatch = sparql.match(/\bLIMIT\s+(\d+)/i);
  const requestedLimit = limitMatch ? parseInt(limitMatch[1], 10) : undefined;
  const maxResults = options.maxResults ?? DEFAULTS.maxResults;
  const effectiveLimit = Math.max(0, Math.min(maxResults, requestedLimit ?? maxResults));

  const results: Array<Record<string, string>> = [];
  for (const quad of store.getQuads(null, null, null, null)) {
    if (results.length >= effectiveLimit) break;

    const binding: Record<string, string> = {};
    let match = true;
    for (const pat of patterns) {
      const s = pat.subject.startsWith('?') ? (binding[pat.subject] || quad.subject.value) : pat.subject;
      const p = pat.predicate.startsWith('?') ? (binding[pat.predicate] || quad.predicate.value) : pat.predicate;
      const o = pat.object.startsWith('?') ? (binding[pat.object] || quad.object.value) : pat.object;
      if (pat.subject.startsWith('?')) binding[pat.subject] = quad.subject.value;
      if (pat.predicate.startsWith('?')) binding[pat.predicate] = quad.predicate.value;
      if (pat.object.startsWith('?')) binding[pat.object] = quad.object.value;
      if (!matchTerm(quad.subject.value, s) || !matchTerm(quad.predicate.value, p) || !matchTerm(quad.object.value, o)) {
        match = false;
        break;
      }
    }
    if (match) {
      const row: Record<string, string> = {};
      for (const v of vars) { row[v] = binding[v] || ''; }
      results.push(row);
    }
  }
  return results;
}

function matchTerm(value: string, pattern: string): boolean {
  return value === pattern || value.endsWith('#' + pattern) || value.endsWith('/' + pattern);
}
