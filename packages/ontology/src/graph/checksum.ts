import { createHash } from 'crypto';

/**
 * Canonicalize N-Quads for hashing: trim blank lines, sort the statements and
 * keep a single trailing newline. The same set of triples therefore produces
 * the same checksum no matter what order they were inserted/dumped in.
 */
export function canonicalNQuads(nquads: string): string {
  const lines = nquads
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0)
    .sort();
  return lines.length > 0 ? `${lines.join('\n')}\n` : '';
}

export function canonicalChecksum(nquads: string): string {
  return createHash('sha256').update(canonicalNQuads(nquads)).digest('hex');
}
