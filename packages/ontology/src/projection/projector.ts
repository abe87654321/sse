import type { GraphStore } from '../graph/types';
import { entityUri, projectRow, type MappedTable } from './entity-mapper';

export interface QueryResultLike {
  rows: any[];
  rowCount?: number | null;
}

export interface ProjectorClient {
  query(sql: string, params?: any[]): Promise<QueryResultLike>;
  release(): void;
}

export interface ProjectorPool {
  connect(): Promise<ProjectorClient>;
  query(sql: string, params?: any[]): Promise<QueryResultLike>;
}

export interface ProjectorOptions {
  batchSize?: number;
  maxAttempts?: number;
}

export interface DrainResult {
  processed: number;
  failed: number;
  deadLettered: number;
}

export class GraphProjector {
  private readonly batchSize: number;
  private readonly maxAttempts: number;

  constructor(
    private readonly store: GraphStore,
    private readonly pool: ProjectorPool,
    opts: ProjectorOptions = {},
  ) {
    this.batchSize = opts.batchSize ?? 200;
    this.maxAttempts = opts.maxAttempts ?? 10;
  }

  async drain(limit = this.batchSize): Promise<DrainResult> {
    const client = await this.pool.connect();
    let processed = 0;
    let failed = 0;
    let deadLettered = 0;
    let lastProcessedId = 0;

    try {
      await client.query('BEGIN');
      const lock = await client.query(`SELECT pg_try_advisory_xact_lock(728001) AS ok`);
      if (!lock.rows[0]?.ok) {
        await client.query('ROLLBACK');
        return { processed: 0, failed: 0, deadLettered: 0 };
      }

      const { rows } = await client.query(
        `SELECT id, table_name, op, row_id, old_row, new_row, attempts
           FROM ontology_outbox
          WHERE processed_at IS NULL AND dead_letter = false
          ORDER BY id
          LIMIT $1
          FOR UPDATE SKIP LOCKED`,
        [limit],
      );

      for (const row of rows) {
        try {
          if (row.op === 'DELETE') {
            const id = row.row_id ?? row.old_row?.id ?? row.new_row?.id;
            await this.store.deleteSubject(entityUri(row.table_name, String(id)));
          } else {
            const projection = projectRow(
              row.table_name as MappedTable,
              row.op,
              row.new_row,
              row.old_row,
            );
            for (const write of projection.writes) {
              await this.store.replaceEntity(write.uri, write.quads, write.ownedPredicates);
            }
            for (const relation of projection.remove) {
              await this.store.removeRelation(relation.from, relation.predicate, relation.to);
            }
            for (const relation of projection.add) {
              await this.store.addRelation(relation.from, relation.predicate, relation.to);
            }
          }

          await client.query(`UPDATE ontology_outbox SET processed_at = NOW() WHERE id = $1`, [row.id]);
          processed++;
          lastProcessedId = row.id;
        } catch (err: any) {
          failed++;
          const attempts = Number(row.attempts ?? 0) + 1;
          const dead = attempts >= this.maxAttempts;
          await client.query(
            `UPDATE ontology_outbox
                SET attempts = $2, last_error = $3, dead_letter = $4,
                    processed_at = CASE WHEN $4 THEN NOW() ELSE processed_at END
              WHERE id = $1`,
            [row.id, attempts, String(err?.message ?? err).slice(0, 1000), dead],
          );
          if (dead) {
            deadLettered++;
            lastProcessedId = row.id;
            continue;
          }
          break;
        }
      }

      if (lastProcessedId > 0) {
        await client.query(
          `UPDATE ontology_projector_state
              SET last_outbox_id = $1, updated_at = NOW()
            WHERE id = 'default' AND last_outbox_id < $1`,
          [lastProcessedId],
        );
      }

      await client.query('COMMIT');
      return { processed, failed, deadLettered };
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  }

  async purgeOldEvents(days = 7): Promise<number> {
    const { rowCount } = await this.pool.query(
      `DELETE FROM ontology_outbox
        WHERE processed_at IS NOT NULL
          AND processed_at < NOW() - ($1 || ' days')::interval`,
      [days],
    );
    return rowCount ?? 0;
  }
}
