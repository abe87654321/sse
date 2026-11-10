export interface OntologyStatusDeps {
  query: (sql: string, params?: any[]) => Promise<{ rows: any[] }>;
  counts: () => Promise<{ quads: number; subjects: number }>;
}

export interface OntologyStatus {
  engine: 'oxigraph';
  counts: { quads: number; subjects: number };
  outbox: {
    pending: number;
    deadLettered: number;
    oldestPendingAgeSeconds: number;
    lastError: string | null;
  };
  version: number;
}

export async function getOntologyStatus(deps: OntologyStatusDeps): Promise<OntologyStatus> {
  const [counts, outboxResult, versionResult] = await Promise.all([
    deps.counts(),
    deps.query(
      `SELECT
         COUNT(*) FILTER (WHERE processed_at IS NULL AND dead_letter = false)::int AS pending,
         COUNT(*) FILTER (WHERE dead_letter = true)::int AS dead_lettered,
         COALESCE(
           EXTRACT(EPOCH FROM (
             NOW() - MIN(occurred_at) FILTER (WHERE processed_at IS NULL AND dead_letter = false)
           )),
           0
         ) AS oldest_pending_age_seconds,
         (SELECT last_error FROM ontology_outbox
           WHERE last_error IS NOT NULL
           ORDER BY id DESC LIMIT 1) AS last_error
       FROM ontology_outbox`,
    ),
    deps.query(`SELECT last_snapshot_version FROM ontology_projector_state WHERE id = 'default'`),
  ]);

  const row = outboxResult.rows[0] ?? {};
  return {
    engine: 'oxigraph',
    counts,
    outbox: {
      pending: Number(row.pending ?? 0),
      deadLettered: Number(row.dead_lettered ?? 0),
      oldestPendingAgeSeconds: Number(row.oldest_pending_age_seconds ?? 0),
      lastError: row.last_error ?? null,
    },
    version: Number(versionResult.rows[0]?.last_snapshot_version ?? 0),
  };
}
