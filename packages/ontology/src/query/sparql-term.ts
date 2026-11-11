export function sparqlString(value: string): string {
  return `"${value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t')}"`;
}

export function sparqlIri(value: string): string {
  if (!/^https:\/\/sse\.local\/[A-Za-z0-9._~:/?#@!$&'()*+,;=%-]+$/.test(value)) {
    throw new Error('invalid SSE IRI');
  }
  return `<${value}>`;
}
