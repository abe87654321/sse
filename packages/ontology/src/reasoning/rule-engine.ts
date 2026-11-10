import { GRAPH, XSD } from '../graph/namespaces';
import type { GraphStore, ProjectedQuad } from '../graph/types';

export interface RulePool {
  query(sql: string, params?: any[]): Promise<{ rows: any[] }>;
}

export interface ActiveConstructRule {
  id: string;
  construct_query: string;
}

function escapeLiteral(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t');
}

/**
 * Serialize a CONSTRUCT result quad to an N-Triples statement without losing
 * datatypes or language tags. `xsd:string` is omitted because a simple literal
 * is already an `xsd:string` in RDF 1.1; everything else (notably
 * `xsd:decimal`) is preserved verbatim.
 */
export function serializeConstructQuad(quad: ProjectedQuad): string {
  const subject = `<${quad.subject}>`;
  const predicate = `<${quad.predicate}>`;

  let object: string;
  if (quad.objectType === 'iri') {
    object = `<${quad.object}>`;
  } else {
    const literal = `"${escapeLiteral(quad.object)}"`;
    if (quad.language) {
      object = `${literal}@${quad.language}`;
    } else if (quad.datatype && quad.datatype !== `${XSD}string`) {
      object = `${literal}^^<${quad.datatype}>`;
    } else {
      object = literal;
    }
  }

  return `${subject} ${predicate} ${object} .`;
}

export class RuleEngine {
  constructor(private readonly store: GraphStore, private readonly pool: RulePool) {}

  /**
   * Recompute `urn:sse:inferred` from scratch. The inferred graph is cleared
   * before any rule runs so a rule that reads the default graph (or
   * `urn:sse:inferred` directly) can never consume conclusions left over from a
   * previous cycle. Rules run in priority order and each rule's CONSTRUCT
   * results are inserted immediately, so later rules see earlier conclusions in
   * the same cycle. A failing rule is logged to stderr and skipped; the next
   * projector tick recomputes the graph from scratch.
   */
  async materialize(): Promise<number> {
    const { rows } = await this.pool.query(
      `SELECT id, construct_query
         FROM reasoning_rules
        WHERE is_active = true AND construct_query IS NOT NULL
        ORDER BY priority ASC, id ASC`,
    );

    await this.store.update(`CLEAR SILENT GRAPH <${GRAPH.inferred}>`);

    let total = 0;
    for (const rule of rows) {
      const query = typeof rule.construct_query === 'string' ? rule.construct_query.trim() : '';
      if (query === '') continue;

      try {
        const result = await this.store.query(query);
        if (result.kind !== 'construct' || result.quads.length === 0) continue;
        const triples = result.quads.map(serializeConstructQuad);
        await this.store.update(
          `INSERT DATA { GRAPH <${GRAPH.inferred}> { ${triples.join('\n')} } }`,
        );
        total += result.quads.length;
      } catch (err: any) {
        console.error(`[ontology] rule ${rule.id} failed to materialize: ${err?.message ?? err}`);
      }
    }

    return total;
  }
}
