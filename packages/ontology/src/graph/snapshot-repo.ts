import { canonicalChecksum } from './checksum';

export interface GraphSnapshot {
  version: number;
  checksum: string;
  nquads: string;
  graphNames: string[];
  lastOutboxId: number;
  createdAt: Date;
}

export class SnapshotRepo {
  constructor(private pool: { query: (sql: string, params?: any[]) => Promise<{ rows: any[] }> }) {}

  async save(graphNames: string[], nquads: string, lastOutboxId: number): Promise<GraphSnapshot> {
    const checksum = canonicalChecksum(nquads);
    const version = await this.nextVersion();
    await this.pool.query(
      `INSERT INTO ontology_graph_snapshots (version, checksum, nquads, graph_names, last_outbox_id)
       VALUES ($1, $2, $3, $4, $5)`,
      [version, checksum, nquads, graphNames, lastOutboxId],
    );
    await this.pool.query(
      `UPDATE ontology_projector_state
          SET last_snapshot_version = $1, last_outbox_id = GREATEST(last_outbox_id, $2), updated_at = NOW()
        WHERE id = 'default'`,
      [version, lastOutboxId],
    );
    await this.prune(5);
    return { version, checksum, nquads, graphNames, lastOutboxId, createdAt: new Date() };
  }

  async latest(): Promise<GraphSnapshot | null> {
    const { rows } = await this.pool.query(
      `SELECT version, checksum, nquads, graph_names, last_outbox_id, created_at
         FROM ontology_graph_snapshots
        ORDER BY version DESC LIMIT 1`,
    );
    if (rows.length === 0) return null;
    const row = rows[0];
    const checksum = canonicalChecksum(row.nquads);
    if (checksum !== row.checksum) {
      throw new Error(
        `Snapshot version ${row.version} checksum mismatch: expected ${row.checksum}, got ${checksum}`,
      );
    }
    return {
      version: Number(row.version),
      checksum: row.checksum,
      nquads: row.nquads,
      graphNames: row.graph_names,
      lastOutboxId: Number(row.last_outbox_id),
      createdAt: row.created_at,
    };
  }

  async prune(keep = 5): Promise<void> {
    await this.pool.query(
      `DELETE FROM ontology_graph_snapshots
        WHERE version NOT IN (SELECT version FROM ontology_graph_snapshots ORDER BY version DESC LIMIT $1)`,
      [keep],
    );
  }

  private async nextVersion(): Promise<number> {
    const { rows } = await this.pool.query(
      `SELECT nextval('ontology_snapshot_version_seq') AS version`,
    );
    return Number(rows[0].version);
  }
}
