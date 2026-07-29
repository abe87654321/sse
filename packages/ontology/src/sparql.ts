import type { Store } from 'n3';

export function executeSparql(store: Store, sparql: string): Array<Record<string, string>> {
  const results: Array<Record<string, string>> = [];
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

  for (const quad of store) {
    const binding: Record<string, string> = {};
    let match = true;
    for (const pat of patterns) {
      const s = pat.subject.startsWith('?') ? (binding[pat.subject] || quad.subject.value) : pat.subject;
      const p = pat.predicate.startsWith('?') ? (binding[pat.predicate] || quad.predicate.value) : pat.predicate;
      const o = pat.object.startsWith('?') ? (binding[pat.object] || quad.object.value) : pat.object;
      if (pat.subject.startsWith('?')) binding[pat.subject] = quad.subject.value;
      if (pat.predicate.startsWith('?')) binding[pat.predicate] = quad.predicate.value;
      if (pat.object.startsWith('?')) binding[pat.object] = quad.object.value;
      if (!matchTerm(quad.subject.value, s) || !matchTerm(quad.predicate.value, p) || !matchTerm(quad.object.value, o)) { match = false; break; }
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
