import type { Store } from 'n3';

export function executeSparql(store: Store, sparql: string): Array<Record<string, string>> {
  const results: Array<Record<string, string>> = [];
  const selectMatch = sparql.match(/SELECT\s+(.+?)\s+WHERE\s*\{(.+?)\}/is);
  if (!selectMatch) throw new Error('仅支持 SELECT ?var WHERE { ?s ?p ?o } 格式');

  const vars = selectMatch[1].trim().split(/\s+/).filter(v => v.startsWith('?'));
  const patterns = selectMatch[2].trim().split('.').map(p => p.trim()).filter(Boolean).map(p => {
    const parts = p.split(/\s+/);
    return { subject: parts[0], predicate: parts[1], object: parts.slice(2).join(' ') };
  });

  for (const quad of store) {
    const binding: Record<string, string> = {};
    let match = true;
    for (const pat of patterns) {
      const s = pat.subject.startsWith('?') ? binding[pat.subject] || quad.subject.value : pat.subject;
      const p = pat.predicate.startsWith('?') ? binding[pat.predicate] || quad.predicate.value : pat.predicate;
      const o = pat.object.startsWith('?') ? binding[pat.object] || quad.object.value : pat.object;
      if (pat.subject.startsWith('?')) binding[pat.subject] = quad.subject.value;
      if (pat.predicate.startsWith('?')) binding[pat.predicate] = quad.predicate.value;
      if (pat.object.startsWith('?')) binding[pat.object] = quad.object.value;
      if (s !== quad.subject.value || p !== quad.predicate.value || o !== quad.object.value) { match = false; break; }
    }
    if (match) {
      const row: Record<string, string> = {};
      for (const v of vars) { row[v] = binding[v] || ''; }
      results.push(row);
    }
  }
  return results;
}
